import { prisma } from "../libs/prisma";
import { RETURN_TIME_WINDOW_MS } from "./constants";
import polyline from "@mapbox/polyline";
import NodeCache from "node-cache";

// ✅ إنشاء كاش لتخزين المسارات (Polyline) مؤقتًا لتقليل طلبات Google API
const cache = new NodeCache({ stdTTL: 3600 }); // يحتفظ بالبيانات لمدة ساعة واحدة

// ================================================================
// 📍 دالة لحساب الاتجاه بين نقطتين (Bearing)
// ================================================================
function calculateBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {
  // نحول القيم من درجات إلى راديان
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLon = toRad(lon2 - lon1);

  // حساب مركبتي الاتجاه
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);

  // حساب الاتجاه بالنسبة للشمال (من 0 إلى 360 درجة)
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360; // تحويل أي زاوية سالبة إلى موجبة (0–360)
}

// ================================================================
// 🚗 دالة: تتحقق إذا كانت نقطة معينة تقع على نفس مسار رحلة ما
// ================================================================
async function isPointNearRoute(
  point: { lat: number; lng: number }, // النقطة اللي بنفحصها (زي مدينة الراكب)
  trip: { fromLat: number; fromLng: number; toLat: number; toLng: number }, // مسار الرحلة المفتوحة
  toleranceMeters = 25000 // أقصى مسافة مسموحة من الطريق (افتراضي 25 كم)
) {
  const cacheKey = `poly_${trip.fromLat}_${trip.fromLng}_${trip.toLat}_${trip.toLng}`;
  // نجرب نجيب المسار من الكاش لو متخزن مسبقًا
  let points: { lat: number; lng: number }[] = cache.get(cacheKey) || [];

  // لو المسار مش موجود في الكاش، نجيبه من Google Maps Directions API
  if (!points || points.length === 0) {
    try {
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${trip.fromLat},${trip.fromLng}&destination=${trip.toLat},${trip.toLng}&mode=driving&key=${process.env.GOOGLE_MAPS_API_KEY}`;
      const res = await fetch(url);
      const data = await res.json();

      // لو الـ API ما رجعش مسار صالح نرجع false
      if (!data.routes?.[0]?.overview_polyline?.points)
        return { onRoute: false };

      // نفك الـ polyline اللي جوجل بيرجعه إلى مصفوفة إحداثيات
      const decoded = polyline.decode(data.routes[0].overview_polyline.points);
      points = decoded.map(([lat, lng]) => ({ lat, lng }));

      // نخزن النتيجة في الكاش
      cache.set(cacheKey, points);
    } catch (err) {
      console.error("Polyline fetch failed:", err);
      return { onRoute: false };
    }
  }

  // 🧮 نحسب المسافة الكلية للرحلة المفتوحة
  const totalDistance = haversine(
    { lat: trip.fromLat, lng: trip.fromLng },
    { lat: trip.toLat, lng: trip.toLng }
  );

  // 📏 نضبط الـ tolerance تلقائيًا حسب طول الرحلة
  if (totalDistance > 200000) {
    toleranceMeters = 80000; // > 200 كم → 80 كم
  } else if (totalDistance > 100000) {
    toleranceMeters = 60000; // 100-200 كم → 60 كم
  } else {
    toleranceMeters = 40000; // < 100 كم → 40 كم
  }
  // 🔍 نبدأ نحسب أقرب نقطة على المسار للنقطة اللي بنفحصها
  let minDist = Infinity; // أقل مسافة بين النقطة والمسار
  let t = 0; // موقع النقطة على المسار كنسبة (من 0 إلى 1)
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];

    // نحسب أقرب نقطة على الجزء (a→b) بالنسبة للنقطة الحالية
    const proj = closestPointOnSegment(point, a, b);

    // نحتفظ بأقرب مسافة فقط
    if (proj.distance < minDist) {
      minDist = proj.distance;
      t = i / (points.length - 1) + proj.t / (points.length - 1);
    }
  }

  // 🧭 نتحقق كمان من اتجاه النقطة مقارنة بالاتجاه العام للطريق
  const roadBearing = calculateBearing(
    trip.fromLat,
    trip.fromLng,
    trip.toLat,
    trip.toLng
  );
  const pointBearing = calculateBearing(
    trip.fromLat,
    trip.fromLng,
    point.lat,
    point.lng
  );
  let diff = Math.abs(roadBearing - pointBearing);
  if (diff > 180) diff = 360 - diff; // نخلي الفرق بين 0 و180 فقط

  // ✅ تحديد ما إذا كانت النقطة "على الطريق"
  let onRoute = minDist <= toleranceMeters;
  if (diff <= 20) onRoute = true; // لو الاتجاه قريب جدًا (±20 درجة)، نعتبرها على الطريق حتى لو بعيدة شوية

  return { onRoute, distance: minDist, t }; // نرجع النتيجة والمسافة والموقع النسبي
}

// ================================================================
// 🔹 دالة مساعدة: تحسب أقرب نقطة من نقطة خارج الطريق إلى قطعة من المسار (Segment)
// ================================================================
function closestPointOnSegment(p: any, a: any, b: any) {
  // نحول النقط إلى متجهات (vectors)
  const toVector = (p1: any, p2: any) => ({
    x: p2.lng - p1.lng,
    y: p2.lat - p1.lat,
  });

  // عمليات رياضية للـ projection على الخط
  const dot = (v1: any, v2: any) => v1.x * v2.x + v1.y * v2.y;
  const lengthSq = (v: any) => v.x * v.x + v.y * v.y;

  const v = toVector(a, b);
  const w = toVector(a, p);
  const c = dot(w, v) / lengthSq(v);
  const clamped = Math.max(0, Math.min(1, c)); // نضمن أن النقطة بين a و b

  // نحسب الإحداثيات الإسقاطية للنقطة على الخط
  const projLat = a.lat + clamped * (b.lat - a.lat);
  const projLng = a.lng + clamped * (b.lng - a.lng);

  // نحسب المسافة الفعلية بين النقطة والإسقاط
  const dist = haversine(p, { lat: projLat, lng: projLng });
  return { distance: dist, t: clamped };
}

// ================================================================
// 🌍 دالة Haversine لحساب المسافة بين نقطتين على الأرض بدقة
// ================================================================
function haversine(p1: any, p2: any): number {
  const toRad = (n: number) => (n * Math.PI) / 180;
  const R = 6371000; // نصف قطر الأرض بالمتر
  const dLat = toRad(p2.lat - p1.lat);
  const dLng = toRad(p2.lng - p1.lng);

  // معادلة haversine
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ================================================================
// 🚘 الدالة الرئيسية: البحث عن رحلات قريبة على نفس الطريق والاتجاه
// ================================================================
export async function findNearbyTrips(
  tripData: {
    fromLat: number;
    fromLng: number;
    toLat: number;
    toLng: number;
    seatsRequested: number;
    startTime: string;
  },
  skip = 0,
  pageSize = 10
) {
  const { fromLat, fromLng, toLat, toLng, seatsRequested, startTime } =
    tripData;

  // نحسب نطاق الوقت المسموح بالبحث فيه (مثلاً ±12 ساعة)
const searchDate = new Date(startTime);
const THIRTY_MINUTES = 30 * 60 * 1000;
const timeWindowStart = new Date(searchDate.getTime() - THIRTY_MINUTES).toISOString();
const timeWindowEnd = new Date(searchDate.getTime() + THIRTY_MINUTES).toISOString();


  const openTrips = await prisma.trip.findMany({
    where: {
      status: "OPEN",
      startTime: { gte: timeWindowStart, lte: timeWindowEnd },
    },
    include: { members: true }, // نجيب الركاب اللي حاجزين فعليًا
  });

  const matching: any[] = []; // هنا هنجمع الرحلات المطابقة

  for (const trip of openTrips) {
    // نحسب عدد المقاعد الفاضية
    const booked = trip.members.reduce(
      (sum: number, m: any) => sum + m.seatsBooked,
      0
    );
    const available = 3 - booked;
    if (available < seatsRequested) continue; // لو مفيش مقاعد كفاية نعدي الرحلة

    // 🧭 تحقق من أن الاتجاهين متقاربين (مثلاً الاتنين شمال)
    const bearingMain = calculateBearing(
      trip.fromLat,
      trip.fromLng,
      trip.toLat,
      trip.toLng
    );
    const bearingNew = calculateBearing(fromLat, fromLng, toLat, toLng);
    const directionDiff = Math.abs(bearingMain - bearingNew);

    // لو الفرق في الاتجاه أكتر من 25 درجة، نتجاهل الرحلة (يعني مش في نفس الطريق)
    if (directionDiff > 25 && directionDiff < 335) continue;

    // 📍 نتحقق إن نقطتي البداية والنهاية للراكب موجودتين على طريق الرحلة المفتوحة
    const routeMatchStart = await isPointNearRoute(
      { lat: fromLat, lng: fromLng },
      {
        fromLat: trip.fromLat,
        fromLng: trip.fromLng,
        toLat: trip.toLat,
        toLng: trip.toLng,
      },
      25000
    );

    const routeMatchEnd = await isPointNearRoute(
      { lat: toLat, lng: toLng },
      {
        fromLat: trip.fromLat,
        fromLng: trip.fromLng,
        toLat: trip.toLat,
        toLng: trip.toLng,
      },
      25000
    );

    // لو واحدة من النقطتين مش على الطريق، نتجاهل الرحلة
    if (!routeMatchStart.onRoute || !routeMatchEnd.onRoute) continue;

    // 🔁 تأكد إن ترتيب النقاط صحيح (البداية قبل النهاية على نفس المسار)
    if (
      routeMatchStart.t !== undefined &&
      routeMatchEnd.t !== undefined &&
      routeMatchStart.t >= routeMatchEnd.t
    ) {
      continue;
    }

    // ✅ لو كل الشروط اتحققت → الرحلتين متطابقتين من حيث الطريق والاتجاه
    matching.push({
      ...trip,
      available,
      pickupDistance: routeMatchStart.distance, // المسافة بين نقطة الركوب والطريق
      dropoffDistance: routeMatchEnd.distance, // المسافة بين نقطة النزول والطريق
      segmentStartT: routeMatchStart.t, // موقع بداية الراكب على المسار (0–1)
      segmentEndT: routeMatchEnd.t, // موقع نهاية الراكب على المسار
    });
  }

  // نرتب الرحلات القريبة حسب أقرب نقطة انطلاق
  const sorted = matching.sort((a, b) => a.pickupDistance - b.pickupDistance);

  // نرجع النتائج بالصفحة المطلوبة
  return sorted.slice(skip, skip + pageSize);
}

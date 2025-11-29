import { addHours, differenceInMinutes } from "date-fns";
import { prisma } from "../libs/prisma";
import { sendNotificationWithDelay } from "../utils/sendNotification";

export async function checkPendingTripPayments() {
  const now = new Date();

  // نجيب كل الرحلات اللي لسه ما اتدفعتش ولسه ما بدأتش
  const trips = await prisma.trip.findMany({
    where: {
      userHasEnoughMoney: false,
      status: { in: ["OPEN", "FULL"] },
      startTime: { gt: now.toISOString() },
    },
    include: {
      creator: { select: { id: true, balance: true } },
    },
  });

  for (const trip of trips) {
    const userId = trip.creator.id;
    const balance = trip.creator.balance ?? 0;
    const required = trip.totalFare ?? 0;
    const tripStart = new Date(trip.startTime);

    // ✅ لو المستخدم دفع خلاص قبل أي حاجة
    if (balance >= required) {
      await prisma.trip.update({
        where: { id: trip.id },
        data: { userHasEnoughMoney: true },
      });

      await sendNotificationWithDelay(
        userId,
        "تم تأكيد الدفع ✅",
        `تم تأكيد الدفع لرحلتك من ${trip.from} إلى ${trip.to}.`
      );
      continue;
    }

    const hoursLeft = (tripStart.getTime() - now.getTime()) / (1000 * 60 * 60);

    // 🧩 الحالة الأولى: لسه ما اتبعتش إشعار الـ8 ساعات
    if (!trip.notified8hAt) {
      if (hoursLeft <= 8) {
        // فاضل أقل من 8 ساعات → نبدأ العد التنازلي فورًا
        await prisma.trip.update({
          where: { id: trip.id },
          data: { notified8hAt: new Date() },
        });

        await sendNotificationWithDelay(
          userId,
          "تنبيه بالدفع 💰",
          `رحلتك من ${trip.from} إلى ${trip.to} بعد ${Math.floor(
            hoursLeft
          )} ساعات تقريبًا. لديك ساعة واحدة لإتمام الدفع وإلا سيتم إلغاء الرحلة.`
        );

        continue; // ننتظر الكرون الجاية تتابع الإشعارات
      }
      // باقي أكتر من 8 ساعات → مفيش إشعار دلوقتي
      continue;
    }

    // 🧭 الحالة الثانية: تم إرسال إشعار الـ8 ساعات — نتابع تقدم المهلة
    const notifiedAt = new Date(trip.notified8hAt);
    const deadline = addHours(notifiedAt, 1); // نهاية المهلة
    const minutesLeft = differenceInMinutes(deadline, now);

    // 🕒 فاضل نص ساعة
    if (minutesLeft <= 30 && minutesLeft > 15 && !trip.notified30mPayment) {
      await sendNotificationWithDelay(
        userId,
        "تذكير بالدفع ⏰",
        `متبقي نصف ساعة على نهاية مهلة الدفع لرحلتك من ${trip.from} إلى ${trip.to}.`
      );

      await prisma.trip.update({
        where: { id: trip.id },
        data: { notified30mPayment: true },
      });

      continue;
    }

    // ⚠️ فاضل ربع ساعة
    if (minutesLeft <= 15 && minutesLeft > 0 && !trip.notified15mPayment) {
      await sendNotificationWithDelay(
        userId,
        "تحذير أخير ⚠️",
        `متبقي ربع ساعة فقط على نهاية مهلة الدفع لرحلتك من ${trip.from} إلى ${trip.to}.`
      );

      await prisma.trip.update({
        where: { id: trip.id },
        data: { notified15mPayment: true },
      });

      continue;
    }

    // 🚫 انتهت المهلة → إلغاء الرحلة
    if (minutesLeft <= 0 && !trip.paymentDeadlineMet) {
      await prisma.trip.update({
        where: { id: trip.id },
        data: {
          status: "CANCELLED",
          paymentDeadlineMet: true,
        },
      });

      await sendNotificationWithDelay(
        userId,
        "تم إلغاء الرحلة ❌",
        `تم إلغاء رحلتك من ${trip.from} إلى ${trip.to} لعدم الدفع في الوقت المحدد.`
      );

      continue;
    }
  }
}

import { Response } from "express";
import { FullRequest } from "../types/request";
import { checkUserHasConflictingTrip } from "../utils/checkUserHasConflictingTrip";
import {
  getJoinSchema,
  getTripFareSchema,
  getTripSchema,
} from "../validations/trip.zod";
import { t } from "../utils/i18n";
import { calculateDistance } from "../utils/distanceBetween";
import { calculateFarePerPassenger } from "../utils/calculate price-trip";
import { createTrip } from "../utils/createTrip";
import { findNearbyTrips } from "../utils/findNearbyTrips";

import { combineDateAndTime } from "../utils/combineDateAndTime";
import { prisma } from "../libs/prisma";
import { TripStatus } from "@prisma/client";
import { differenceInMinutes, format } from "date-fns";
import z from "zod";
import { sendNotificationWithDelay } from "../utils/sendNotification";
import { tr } from "zod/v4/locales";

export async function requestTrip(req: FullRequest, res: Response) {
  const lang = req.lang || "ar";
  try {
    const schema = getTripSchema(lang);
    const result = schema.safeParse(req.body);
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 10;
    const skip = (page - 1) * pageSize;

    if (!result.success) {
      return res.status(400).json({
        error: t(lang, "errors.validation_failed"),
        details: z.flattenError(result.error),
      });
    }

    let data = result.data;
    const user = req.user;
    const userId = req.user?.id as string;
    if (!user || !userId) {
      return res.status(404).json({ error: t(lang, "auth.user_notfound") });
    }

    // FIX: For ONE_WAY trips, set endTime to startTime to avoid validation issues
    if (data.type === "ONE_WAY" && !data.endTime) {
      data = {
        ...data,
        endTime: data.startTime, // Set endTime equal to startTime for ONE_WAY
      };
    }

    const createdTitle = t(lang, "notifications.trip_created_success_title");
    const createdBody = t(lang, "notifications.trip_created_success_body");

    if (!data.tripDates || data.tripDates.length === 0) {
      return res.status(400).json({
        error: t(lang, "trip.tripDates_required"),
      });
    }

    const { fromLat, fromLng, toLat, toLng, startTime, endTime, bookingType } =
      data;
    const seats = data.seatsRequested;

    // CALCULATE DISTANCE & FARE ONCE
    const { distance, duration } = await calculateDistance({
      fromLat,
      fromLng,
      toLat,
      toLng,
    });

    const fareBreakdown = await calculateFarePerPassenger(
      distance,
      seats,
      bookingType
    );
    const { passengerFare, driverShare, appCommission } = fareBreakdown;
    // const outboundFare = passengerFare; // old

    const settings = await prisma.setting.findFirst({
      select: { minimumFare: true },
    });
    if (!settings) throw new Error(t(lang, "errors.app_settings_not_found"));
    const { minimumFare } = settings;

    // ---------- NEW: apply minimum fare instead of rejecting ----------
    let appliedFare = passengerFare;
    let minimumFareWarning = "";
    if (passengerFare < minimumFare) {
      appliedFare = minimumFare;
      minimumFareWarning =
        lang === "ar"
          ? `تنبيه: سعر الرحلة أقل من الحد الأدنى (${minimumFare} جنيه). سيتم احتساب ${minimumFare} جنيه كحد أدنى.`
          : `Warning: The trip fare is below the minimum (${minimumFare} EGP). A minimum fare of ${minimumFare} EGP will be applied.`;
    }
    // ------------------------------------------------------------------

    // === 20 EGP FIXED DISCOUNT LOGIC ===
    let displayFare = appliedFare;
    let discountApplied = 0;
    let finalPassengerFare = appliedFare;
    let bonusUsed = false;

    const DISCOUNT_AMOUNT = 20;

    const userWithBonus = await prisma.user.findUnique({
      where: { id: userId },
      select: { userBonus: true, balance: true },
    });

    const userBonus = userWithBonus?.userBonus ?? 0;
    const userBalance = userWithBonus?.balance ?? 0;

    if (userBonus >= DISCOUNT_AMOUNT) {
      displayFare = appliedFare + DISCOUNT_AMOUNT;
      discountApplied = DISCOUNT_AMOUNT;
      finalPassengerFare = appliedFare;
      bonusUsed = true;
    }
    // === END DISCOUNT ===

    // === CALCULATE TOTAL COST (after discount) ===
    const perTripFinalFare = finalPassengerFare;
    const roundTripFinalFare =
      data.type === "ROUND_TRIP" && data.endTime
        ? perTripFinalFare * 2
        : perTripFinalFare;

    const totalTripCost = roundTripFinalFare * data.tripDates.length;

    // === CHECK USER HAS ENOUGH BALANCE (overall) ===
    const hasEnoughMoney = userBalance >= totalTripCost;

    // === calculate how many actual one-way trips the user can afford (since each DB trip is ONE_WAY) ===
    const maxTripsAffordable = Math.floor(userBalance / perTripFinalFare);

    // === sort tripDates by nearest date (so closest dates are processed first) ===
    const sortedTripDates = data.tripDates.slice().sort((a, b) => {
      const dateA = combineDateAndTime(a, startTime).getTime();
      const dateB = combineDateAndTime(b, startTime).getTime();
      return dateA - dateB;
    });

    const trips: any[] = [];
    const nearbyTrips: any[] = [];

    // track actual created (one-way) paid trip count for allocating balance to earliest trips
    let paidTripCount = 0;

    for (const dateStr of sortedTripDates) {
      const startDate = combineDateAndTime(dateStr, startTime);

      // CONFLICT CHECK
      const hasConflict = await checkUserHasConflictingTrip(userId, startDate);
      if (hasConflict) {
        return res
          .status(400)
          .json({ error: t(lang, "trip.conflicting_trip") });
      }

      // FIX: Only check return trip conflict for ROUND_TRIP
      if (data.type === "ROUND_TRIP" && data.endTime) {
        const returnStart = combineDateAndTime(dateStr, data.endTime);
        const hasReturnConflict = await checkUserHasConflictingTrip(
          userId,
          returnStart
        );
        if (hasReturnConflict) {
          return res
            .status(400)
            .json({ error: t(lang, "trip.conflicting_trip") });
        }
      }

      const tripStatus =
        bookingType === "SINGLE" ||
        (bookingType === "TRIPLE" && seats === 3) ||
        (bookingType === "DOUBLE" && seats === 2)
          ? "FULL"
          : "OPEN";

      // 🧩   ROUND_TRIP
      if (data.type === "ROUND_TRIP" && data.endTime) {
        // نحدد وقت الذهاب والعودة
        const returnStart = combineDateAndTime(dateStr, data.endTime);
        const returnEnd = new Date(returnStart.getTime() + duration * 1000);

        // مصفوفات لحفظ الرحلات القريبة
        let outboundNearby: any[] = [];
        let returnNearby: any[] = [];

        // نبدأ نفترض إن المستخدم هو اللي هيعمل الرحلة
        let createOutbound = true;
        let createReturn = true;

        // لو الرحلة مش Single أو Double كاملة المقاعد، هنحاول نعمل مطابقة
        if (
          bookingType !== "SINGLE" &&
          !(
            (bookingType === "TRIPLE" && seats === 3) ||
            (bookingType === "DOUBLE" && seats === 2)
          )
        ) {
          // ✅ البحث عن الرحلات القريبة للذهاب
          outboundNearby =
            (await findNearbyTrips(
              {
                startTime: startDate.toISOString(),
                fromLat: data.fromLat,
                fromLng: data.fromLng,
                seatsRequested: seats,
                toLat: data.toLat,
                toLng: data.toLng,
              },
              skip,
              pageSize
            )) || [];

          // ✅ البحث عن الرحلات القريبة للعودة
          returnNearby =
            (await findNearbyTrips(
              {
                startTime: returnStart.toISOString(),
                fromLat: data.toLat,
                fromLng: data.toLng,
                seatsRequested: seats,
                toLat: data.fromLat,
                toLng: data.fromLng,
              },
              skip,
              pageSize
            )) || [];

          // ⛔ لو لقى رحلات ذهاب، مش هينشئ واحدة جديدة
          if (outboundNearby.length > 0) {
            createOutbound = false;
          }

          // ⛔ لو لقى رحلات عودة، مش هينشئ واحدة جديدة
          if (returnNearby.length > 0) {
            createReturn = false;
          }
        }

        // 🟢 لو مفيش رحلات ذهاب قريبة → أنشئ الرحلة
        if (createOutbound) {
          const outboundEnd = new Date(startDate.getTime() + duration * 1000);

          // determine if this specific one-way trip is covered by user's balance
          const userCanPayOutbound = paidTripCount < maxTripsAffordable;
          // increment only when we actually create a paid trip
          if (userCanPayOutbound) paidTripCount += 1;

          const outboundTrip = await createTrip({
            tripData: {
              ...data,
              startTime: startDate.toISOString(),
              endTime: outboundEnd.toISOString(),
              bookingType,
              tripDates: dateStr,
            },
            userId,
            passengerFare: finalPassengerFare,
            totalFare: finalPassengerFare,
            driverShare,
            appCommission,
            pickupLat: fromLat,
            pickupLng: fromLng,
            dropLat: toLat,
            dropLng: toLng,
            distance,
            duration,
            status: tripStatus, // ← استخدم tripStatus بدلاً من "OPEN"
            userHasEnoughMoney: userCanPayOutbound,
          });

          // === SEND NOTIFICATION TO ALL DRIVERS IF TRIP IS FULL ===
          if (outboundTrip.trip.status === "FULL") {
            const driversWithTokens = await prisma.user.findMany({
              where: { role: "DRIVER", fcmTokens: { some: {} } },
              select: { id: true },
            });

            driversWithTokens.forEach((driver, index) => {
              sendNotificationWithDelay(
                driver.id,
                "رحله جديده ",
                "تم انشاء رحله جديده مكتمله بالقرب منك"
              );
            });
          }

          trips.push({ ...outboundTrip, tripDirection: "OUTBOUND" });

          // إشعار نجاح الإنشاء
          (async () => {
            try {
              await sendNotificationWithDelay(
                user.id,
                createdTitle,
                createdBody
              );
            } catch (e) {
              console.error("Notification failed:", e);
            }
          })();
        }

        // 🟢 لو مفيش رحلات عودة قريبة → أنشئ الرحلة
        if (createReturn) {
          // determine if this specific one-way trip is covered by user's balance
          const userCanPayReturn = paidTripCount < maxTripsAffordable;
          if (userCanPayReturn) paidTripCount += 1;

          const returnTrip = await createTrip({
            tripData: {
              ...data,
              from: data.to,
              to: data.from,
              fromLat: toLat,
              fromLng: toLng,
              toLat: fromLat,
              toLng: fromLng,
              startTime: returnStart.toISOString(),
              endTime: returnEnd.toISOString(),
              bookingType,
              tripDates: dateStr,
            },
            userId,
            passengerFare: finalPassengerFare,
            totalFare: finalPassengerFare,
            driverShare,
            appCommission,
            pickupLat: toLat,
            pickupLng: toLng,
            dropLat: fromLat,
            dropLng: fromLng,
            distance,
            duration,
            status: tripStatus, // ← استخدم tripStatus بدلاً من "OPEN"
            userHasEnoughMoney: userCanPayReturn,
          });

          // === SEND NOTIFICATION TO ALL DRIVERS IF TRIP IS FULL ===
          if (returnTrip.trip.status === "FULL") {
            const driversWithTokens = await prisma.user.findMany({
              where: { role: "DRIVER", fcmTokens: { some: {} } },
              select: { id: true },
            });

            driversWithTokens.forEach((driver, index) => {
              sendNotificationWithDelay(
                driver.id,
                "رحله جديده ",
                "تم انشاء رحله جديده مكتمله بالقرب منك"
              );
            });
          }

          trips.push({ ...returnTrip, tripDirection: "RETURN" });

          // إشعار نجاح الإنشاء
          (async () => {
            try {
              await sendNotificationWithDelay(
                user.id,
                createdTitle,
                createdBody
              );
            } catch (e) {
              console.error("Notification failed:", e);
            }
          })();
        }

        // لو لقى أي رحلات قريبة — نحفظها علشان نرجعها للفرونت
        if (outboundNearby.length > 0 || returnNearby.length > 0) {
          nearbyTrips.push({
            date: dateStr,
            outboundTrips: outboundNearby,
            returnTrips: returnNearby,
          });
        }
      } else {
        // ONE-WAY LOGIC
        let existing: any[] = [];
        let doCreate =
          bookingType === "SINGLE" ||
          (bookingType === "TRIPLE" && seats === 3) ||
          (bookingType === "DOUBLE" && seats === 2);

        if (!doCreate) {
          existing =
            (await findNearbyTrips(
              {
                startTime: startDate.toISOString(),
                fromLat: data.fromLat,
                fromLng: data.fromLng,
                seatsRequested: seats,
                toLat: data.toLat,
                toLng: data.toLng,
              },
              skip,
              pageSize
            )) || [];
          doCreate = existing.length === 0;
        }

        if (doCreate) {
          const endDate = new Date(startDate.getTime() + duration * 1000);

          // determine if this one-way trip is covered by user's balance
          const userCanPay = paidTripCount < maxTripsAffordable;
          if (userCanPay) paidTripCount += 1;

          const newTrip = await createTrip({
            tripData: {
              ...data,
              startTime: startDate.toISOString(),
              endTime: endDate.toISOString(),
              bookingType,
              tripDates: dateStr,
            },
            userId,
            passengerFare: finalPassengerFare,
            totalFare: finalPassengerFare,
            driverShare,
            appCommission,
            pickupLat: fromLat,
            pickupLng: fromLng,
            dropLat: toLat,
            dropLng: toLng,
            distance,
            duration,
            status: tripStatus, // ← استخدم tripStatus بدلاً من المتغير المحلي
            userHasEnoughMoney: userCanPay,
          });
          trips.push(newTrip);

          // === SEND NOTIFICATION TO ALL DRIVERS IF TRIP IS FULL ===
          if (newTrip.trip.status === "FULL") {
            const driversWithTokens = await prisma.user.findMany({
              where: { role: "DRIVER", fcmTokens: { some: {} } },
              select: { id: true },
            });

            driversWithTokens.forEach((driver, index) => {
              sendNotificationWithDelay(
                driver.id,
                "رحله جديده ",
                "تم انشاء رحله جديده مكتمله بالقرب منك"
              );
            });
          }

          (async () => {
            try {
              await sendNotificationWithDelay(
                user.id,
                createdTitle,
                createdBody
              );
            } catch (e) {
              console.error("Notification failed:", e);
            }
          })();
        } else {
          nearbyTrips.push({ date: dateStr, nearby: existing });
        }
      }
    }

    // === DEDUCT BONUS ONCE (after success) ===
    if (bonusUsed && trips.length > 0) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          userBonus: { decrement: discountApplied },
        },
      });
    }

    // === SEND LOW BALANCE WARNING (Arabic) ===
    // paidTripCount is how many one-way trips we've marked as covered by balance
    const totalOneWayTripsExpected =
      data.type === "ROUND_TRIP" && data.endTime
        ? data.tripDates.length * 2
        : data.tripDates.length;

    if (paidTripCount < totalOneWayTripsExpected && trips.length > 0) {
      await sendNotificationWithDelay(
        user.id,
        "رصيدك غير كافٍ",
        "تم تأكيد الرحلات الأقرب فقط. يرجى الشحن لتأكيد الباقي."
      );
    }

    // === FINAL RESPONSE ===
    const finalRoundTripFare =
      data.type === "ROUND_TRIP" && data.endTime
        ? finalPassengerFare * 2
        : undefined;

    const finalTotalTripCost =
      finalPassengerFare *
      (data.type === "ROUND_TRIP" && data.endTime ? 2 : 1) *
      data.tripDates.length;

    return res.status(201).json({
      success: true,
      data: {
        createdTrips: trips.map(
          (
            t // keep your mapping for direction
          ) => ({
            ...t,
            tripDirection:
              t.trip?.from === data.from && t.trip?.to === data.to
                ? "OUTBOUND"
                : "RETURN",
          })
        ),
        nearbyTrips: {
          outboundTrips: nearbyTrips.flatMap(
            (n) => n.outboundTrips || n.nearby || []
          ),
          returnTrips: nearbyTrips.flatMap((n) => n.returnTrips || []),
        },
        perTripFare: finalPassengerFare,
        originalFare:
          displayFare > finalPassengerFare ? displayFare : undefined,
        discount: discountApplied > 0 ? discountApplied : undefined,
        roundTripFare: finalRoundTripFare,
        totalTripCost: finalTotalTripCost,
        bonusUsed,
        userHasEnoughMoney: hasEnoughMoney,
        maxTripsAffordable,
        warning: minimumFareWarning || undefined,
      },
    });
  } catch (error) {
    console.error(`Error in requestTrip: ${error}`);
    return res.status(500).json({
      error: t(lang, "errors.server_error"),
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function joinTrip(req: FullRequest, res: Response) {
  const lang = req.lang || "ar";
  try {
    const schema = getJoinSchema(lang);
    const result = schema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        error: t(lang, "errors.validation_failed"),
        details: result.error.flatten(),
      });
    }
    //
    const data = result.data;
    const user = req.user;
    const userId = user?.id as string;
    if (!user || !userId) {
      return res.status(404).json({ error: t(lang, "auth.user_notfound") });
    }

    const trip = await prisma.trip.findUnique({
      where: { id: data.tripId },
      include: { members: true },
    });

    if (!trip || trip.status !== "OPEN") {
      return res.status(404).json({ error: t(lang, "trip.not_found") });
    }

    // Check if user is already a member
    const isMember = trip.members.some((member) => member.userId === userId);
    if (isMember) {
      return res.status(400).json({
        error: t(lang, "trip.already_joined"),
        details: t(lang, "trip.already_joined_details"),
      });
    }

    // Calculate available seats
    const maxSeats = trip.bookingType === "DOUBLE" ? 2 : 3;
    const totalBooked = trip.members.reduce(
      (sum, member) => sum + member.seatsBooked,
      0
    );
    const availableSeats = maxSeats - totalBooked;

    if (availableSeats < data.seatsRequested) {
      return res.status(400).json({ error: t(lang, "trip.not_enough_seats") });
    }

    // Overlapping trips check
    if (await checkUserHasConflictingTrip(userId, new Date(trip.startTime))) {
      return res.status(400).json({
        error: t(lang, "trip.overlapping_trip"),
      });
    }

    // Calculate fare for the passenger based on their own route
    const { distance, duration } = await calculateDistance({
      fromLat: data.pickupLat,
      fromLng: data.pickupLng,
      toLat: data.dropLat,
      toLng: data.dropLng,
    });

    const fareBreakdown = await calculateFarePerPassenger(
      distance,
      data.seatsRequested,
      trip.bookingType
    );
    const { passengerFare, driverShare, appCommission } = fareBreakdown;

    // Check user's balance without deducting
    if (user.balance < passengerFare) {
      return res.status(400).json({
        error: t(lang, "wallet.insufficient_balance", passengerFare),
        details: t(
          lang,
          "wallet.insufficient_balance_details",
          user.balance,
          passengerFare
        ),
      });
    }

    // Calculate new totals for the trip
    const currentTotalFare = trip.totalFare || 0;
    const currentDriverShare = trip.driverShare || 0;
    const currentAppCommission = trip.appCommission || 0;

    const newTotalFare = currentTotalFare + passengerFare;
    const newDriverShare = currentDriverShare + driverShare;
    const newAppCommission = currentAppCommission + appCommission;
    const newSeatsBooked = totalBooked + data.seatsRequested;
    const newStatus = newSeatsBooked >= maxSeats ? "FULL" : "OPEN";

    // Current distance between start and end
    const currentFromToToDistance = await calculateDistance({
      fromLat: trip.fromLat,
      fromLng: trip.fromLng,
      toLat: trip.toLat,
      toLng: trip.toLng,
    });

    // Distance from new passenger's pickup to current drop-off
    const pickupToCurrentToDistance = await calculateDistance({
      fromLat: data.pickupLat,
      fromLng: data.pickupLng,
      toLat: trip.toLat,
      toLng: trip.toLng,
    });

    // Distance from current pickup to new passenger's drop-off
    const currentFromToDropDistance = await calculateDistance({
      fromLat: trip.fromLat,
      fromLng: trip.fromLng,
      toLat: data.dropLat,
      toLng: data.dropLng,
    });

    const newFromLat =
      pickupToCurrentToDistance > currentFromToToDistance
        ? data.pickupLat
        : trip.fromLat;
    const newFromLng =
      pickupToCurrentToDistance > currentFromToToDistance
        ? data.pickupLng
        : trip.fromLng;
    const newToLat =
      currentFromToDropDistance > currentFromToToDistance
        ? data.dropLat
        : trip.toLat;
    const newToLng =
      currentFromToDropDistance > currentFromToToDistance
        ? data.dropLng
        : trip.toLng;

    const updatedTrip = await prisma.$transaction(async (tx) => {
      // Create TripMember entry
      const newMember = await tx.tripMember.create({
        data: {
          tripId: trip.id,
          userId,
          passengerFare,
          pickupLat: data.pickupLat,
          pickupLng: data.pickupLng,
          dropLat: data.dropLat,
          dropLng: data.dropLng,
          seatsBooked: data.seatsRequested,
        },
      });

      // Update Trip with new from/to coordinates if needed
      const updated = await tx.trip.update({
        where: { id: trip.id },
        data: {
          totalFare: newTotalFare,
          driverShare: newDriverShare,
          appCommission: newAppCommission,
          status: newStatus,
          fromLat: newFromLat,
          fromLng: newFromLng,
          toLat: newToLat,
          toLng: newToLng,
        },

        include: { members: true },
      });

      return { trip: updated, member: newMember, fareBreakdown, passengerFare };
    });

    // Notification logic
    const joinedTitle = t(lang, "notifications.trip_joined_title");
    const joinedBody = t(lang, "notifications.trip_joined_body", trip.id);
    const memberJoinedTitle = t(lang, "notifications.member_joined_title");
    const memberJoinedBody = t(
      lang,
      "notifications.member_joined_body",
      trip.id
    );

    // Notify the user who joined
    (async () => {
      try {
        await sendNotificationWithDelay(userId, joinedTitle, joinedBody);
      } catch (notifError) {
        console.error(
          `Failed to send notification to user ${userId}:`,
          notifError
        );
      }
    })();

    // Notify all trip members (including creator, assuming creator is a member)
    for (const member of updatedTrip.trip.members) {
      if (member.userId !== userId) {
        (async () => {
          try {
            await sendNotificationWithDelay(
              member.userId,
              memberJoinedTitle,
              memberJoinedBody
            );
          } catch (notifError) {
            console.error(
              `Failed to send notification to user ${member.userId}:`,
              notifError
            );
          }
        })();
      }
    }

    // === SEND NOTIFICATION TO ALL DRIVERS IF TRIP IS FULL ===
    if (updatedTrip.trip.status === "FULL") {
      const driversWithTokens = await prisma.user.findMany({
        where: { role: "DRIVER", fcmTokens: { some: {} } },
        select: { id: true },
      });

      driversWithTokens.forEach((driver, index) => {
        sendNotificationWithDelay(
          driver.id,
          "رحله جديده ",
          "تم انشاء رحله جديده مكتمله بالقرب منك",
          index * 500
        );
      });
    }

    return res.status(201).json({
      success: true,
      data: {
        trip: updatedTrip.trip,
        member: updatedTrip.member,
        fareBreakdown,
        perTripFare: updatedTrip.passengerFare, // Fare for this trip, e.g., 150
        totalTripCost: updatedTrip.passengerFare, // Total cost (same as perTripFare for single trip)
      },
    });
  } catch (error) {
    console.error(`Error in joinTrip: ${error}`);
    return res.status(500).json({
      error: t(lang, "errors.server_error"),
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function getUserTrips(req: FullRequest, res: Response) {
  try {
    const { userId } = req.params;
    const lang = req.lang || "ar";

    if (!userId) {
      return res.status(400).json({
        error: t(lang, "trip.missing_user_id"),
      });
    }

    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 10;
    const skip = (page - 1) * pageSize;
    const status = (req.query.status as TripStatus) || "OPEN";

    if (!Object.values(TripStatus).includes(status)) {
      return res.status(400).json({
        error: t(lang, "trip.invalid_status"),
      });
    }

    const trips = await prisma.trip.findMany({
      where: {
        status,
        OR: [{ driverId: userId }, { members: { some: { userId } } }],
      },
      skip,
      take: pageSize,
      select: {
        id: true,
        from: true,
        to: true,
        userHasEnoughMoney: true,
        driverShare: true,
        startTime: true,
        distance: true,
        status: true,
        driverId: true,
        members: {
          where: {
            userId,
          },
          select: {
            passengerFare: true,
          },
        },
      },

      orderBy: { startTime: "asc" },
    });

    const tripsWithUserFare = trips.map((trip) => {
      const userMember = trip.members[0];
      return {
        id: trip.id,
        from: trip.from,
        to: trip.to,
        startTime: trip.startTime,
        distance: trip.distance,
        status: trip.status,
        passengerFare: userMember?.passengerFare ?? null,
        userHasEnoughMoney: trip.userHasEnoughMoney,
        driverShare: trip.driverShare,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        trips: tripsWithUserFare,
        page,
        pageSize,
        totalCount: trips.length,
        totalPages: Math.ceil(trips.length / pageSize),
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: t(req.headers["accept-language"] || "ar", "errors.server_error"),
    });
  }
}

export async function getTripDetails(req: FullRequest, res: Response) {
  const lang = req.lang || "ar";
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        error: t(req.lang || "ar", "auth.unauthorized"),
      });
    }

    const tripId = req.params.tripId as string;
    if (!tripId) {
      return res.json({
        error: t(lang, "trip.trip_id_required"),
      });
    }

    const trip = await prisma.trip.findUnique({
      where: { id: tripId },

      include: {
        members: {
          select: {
            id: true,
            tripId: true,
            userId: true,
            pickupLat: true,
            pickupLng: true,
            dropLat: true,
            dropLng: true,
            passengerFare: true,
            seatsBooked: true,
            createdAt: true,
            updatedAt: true,

            user: {
              select: {
                id: true,
                name: true,
                phone: true,
                gender: true,
                averageRating: true,
                image: true,
              },
            },
          },
        },
        driver: {
          select: {
            name: true,
            phone: true,
            id: true,
            gender: true,
            image: true,
            car: true,
            averageRating: true,
          },
        },
      },
    });

    if (!trip) {
      return res.status(404).json({
        error: t(lang, "trip.not_found"),
      });
    }
    const formattedMembers = trip.members.map((m) => ({
      ...m,
      user: {
        ...m.user,
        averageRating: m.user.averageRating
          ? parseFloat(Number(m.user.averageRating).toFixed(1))
          : 0.0,
      },
    }));

    const formattedDriver = {
      ...trip.driver,
      averageRating: trip.driver?.averageRating
        ? parseFloat(Number(trip.driver.averageRating).toFixed(1))
        : 0.0,
    };

    return res.json({
      success: true,
      data: {
        ...trip,
        members: formattedMembers,
        driver: formattedDriver,
      },
    });
  } catch (error) {
    console.error("Error fetching trip details:", error);
    return res.status(500).json({
      error: t(lang, "errors.server_error"),
    });
  }
}

import { toZonedTime } from "date-fns-tz";
import { startOfDay, addDays } from "date-fns";

export async function getTodayTrips(req: FullRequest, res: Response) {
  const lang = req.lang || "ar";

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        error: t(lang, "auth.unauthorized"),
      });
    }

    const userTimezone = "Africa/Cairo";

    const now = new Date();

    const localNow = toZonedTime(now, userTimezone);


    const todayLocal = startOfDay(localNow);

 
    const tomorrowLocal = addDays(todayLocal, 1);
    const todayUTC = new Date(todayLocal).toISOString();
    const tomorrowUTC = new Date(tomorrowLocal).toISOString();

    console.log("Today UTC:", todayUTC);
    console.log("Tomorrow UTC:", tomorrowUTC);

    const trips = await prisma.trip.findMany({
      where: {
        OR: [{ members: { some: { userId } } }, { driverId: userId }],
        startTime: {
          gte: todayUTC,
          lt: tomorrowUTC,
        },
        status: { notIn: ["CANCELLED"] },
      },
      include: {
        members: {
          where: { userId },
          select: { passengerFare: true },
        },
      },
      orderBy: { startTime: "asc" },
    });

    const tripsWithUserFare = trips.map((trip) => {
      const userMember = trip.members?.[0];
      return {
        id: trip.id,
        from: trip.from,
        to: trip.to,
        startTime: trip.startTime,
        endTime: trip.endTime,
        distance: Number(trip.distance) ?? 0,
        status: trip.status,
        userHasEnoughMoney: trip.userHasEnoughMoney ?? false,
        passengerFare: Number(userMember?.passengerFare) || 0,
        appCommission: Number(trip.appCommission) || 0,
        totalFare: Number(trip.totalFare) || 0,
        driverShare: Number(trip.driverShare) || 0,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        trips: tripsWithUserFare,
        totalCount: trips.length,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: t(lang, "errors.server_error"),
    });
  }
}

export async function getTripFare(req: FullRequest, res: Response) {
  const lang = req.lang || "ar";
  try {
    const schema = getTripFareSchema(lang);
    const result = schema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        error: t(lang, "errors.validation_failed"),
        details: z.flattenError(result.error),
      });
    }

    const { fromLat, fromLng, toLat, toLng, seatsRequested, bookingType } =
      result.data;

    // --- Calculate distance & duration ---
    const { distance, duration } = await calculateDistance({
      fromLat,
      fromLng,
      toLat,
      toLng,
    });

    const fareBreakdown = await calculateFarePerPassenger(
      distance,
      seatsRequested,
      bookingType
    );

    const { passengerFare } = fareBreakdown;

    // --- Get app settings ---
    const settings = await prisma.setting.findFirst({
      select: { minimumFare: true },
    });

    if (!settings) {
      throw new Error("App settings not found");
    }

    const { minimumFare } = settings;

    // --- Check if user has bonus ---
    let hasBonus = false;
    let originalFare = passengerFare;
    let finalFare = passengerFare;
    let discount = 0;
    let discountMessage = "";

    const userId = req.user?.id;
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { userBonus: true },
      });

      hasBonus = (user?.userBonus as number) >= 20 ? true : false;

      if (hasBonus) {
        discount = 20;
        originalFare = passengerFare + 20;
        finalFare = passengerFare;
        discountMessage =
          lang === "ar"
            ? "تم خصم 20 جنيه بونص من سعر الرحلة."
            : "A 20 EGP bonus has been applied to your trip.";
      }
    }

    let warningMessage: string | undefined = undefined;

    if (passengerFare < minimumFare) {
      finalFare = minimumFare;
      warningMessage =
        lang === "ar"
          ? `تنبيه: سعر الرحلة أقل من الحد الأدنى (${minimumFare} جنيه). في حال الموافقة، سيتم احتساب ${minimumFare} جنيه كحد أدنى للرحلة.`
          : `Warning: The trip fare is below the minimum (${minimumFare} EGP). If you proceed, the minimum fare of ${minimumFare} EGP will be applied.`;
    }

    return res.status(200).json({
      success: true,
      data: {
        distance,
        duration,
        originalFare,
        discount: hasBonus ? discount : 0,
        finalFare,
        discountMessage: hasBonus ? discountMessage : undefined,
        hasBonus,
        warning: warningMessage,
      },
    });
  } catch (error) {
    console.error("Error in getTripFare:", error);
    return res.status(500).json({
      error: t(lang, "errors.server_error"),
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function leaveTrip(req: FullRequest, res: Response) {
  const lang = req.lang || "ar";
  try {
    const schema = z.object({
      tripId: z.string({ message: t(lang, "trip.trip_id_required") }),
    });
    const result = schema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        error: t(lang, "errors.validation_failed"),
        details: result.error.flatten(),
      });
    }

    const { tripId } = result.data;
    const user = req.user;
    const userId = user?.id as string;

    if (!user || !userId) {
      return res.status(404).json({ error: t(lang, "auth.user_notfound") });
    }

    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: { members: true },
    });

    if (!trip) {
      return res.status(404).json({ error: t(lang, "trip.not_found") });
    }

    const member = trip.members.find((m) => m.userId === userId);
    if (!member) {
      return res.status(400).json({
        error: t(lang, "trip.not_member"),
        details: t(lang, "trip.not_member_details"),
      });
    }

    // === EGYPT LOCAL TIME CALCULATION (UTC+2) ===
    let tripStartDate: Date;
    try {
      const rawDate = trip.tripDates.trim();

      // Parse tripDates: 2025-11-8 or 8-11-2025
      const datePatterns = [
        /^\d{4}-\d{1,2}-\d{1,2}$/,
        /^\d{1,2}-\d{1,2}-\d{4}$/,
      ];
      const dateMatched = datePatterns.find((p) => p.test(rawDate));
      if (!dateMatched) {
        throw new Error(
          `تنسيق التاريخ غير صالح: "${rawDate}". استخدم: yyyy-M-d أو d-M-yyyy`
        );
      }

      let year: number, month: number, day: number;
      const parts = rawDate.split("-").map(Number);

      if (parts[0] >= 1000) {
        [year, month, day] = parts;
      } else {
        [day, month, year] = parts;
      }

      // Local date from tripDates
      const localDate = new Date(year, month - 1, day);

      // Convert startTime (UTC) to Egypt time (UTC+2)
      const utcDate = new Date(trip.startTime);
      const egyptTime = new Date(utcDate.getTime() + 2 * 60 * 60 * 1000); // +2 hours

      // Combine: local date + Egypt time
      tripStartDate = new Date(
        localDate.getFullYear(),
        localDate.getMonth(),
        localDate.getDate(),
        egyptTime.getHours(),
        egyptTime.getMinutes(),
        0,
        0
      );
    } catch (err) {
      return res.status(400).json({
        error: t(lang, "trip.invalid_date_time"),
        details: err instanceof Error ? err.message : "خطأ غير معروف",
      });
    }
    // === END TIME PARSING ===

    const now = new Date();
    const minutesUntilStart = differenceInMinutes(tripStartDate, now);
    const hoursUntilStart = minutesUntilStart / 60;

    // --- TIME RULES ---
    if (hoursUntilStart < 6) {
      return res.status(400).json({
        error: t(lang, "trip.cannot_leave_too_late"),
        details: t(lang, "trip.cannot_leave_too_late_details", {
          hours: 6,
        }),
      });
    }

    const penalty = hoursUntilStart < 12 ? 30 : 0;
    const outboundFare = member.passengerFare;
    const totalTripCost = outboundFare;

    const updatedTrip = await prisma.$transaction(async (tx) => {
      // Apply penalty
      if (penalty > 0) {
        await tx.user.update({
          where: { id: userId },
          data: { balance: { decrement: penalty } },
        });
      }

      // Remove member
      await tx.tripMember.delete({ where: { id: member.id } });

      const remainingMembers = await tx.tripMember.findMany({
        where: { tripId },
      });
      const seatsBookedByMember = member.seatsBooked || 1;

      let shouldCancelTrip = false;
      let newStatus = trip.status;

      if (remainingMembers.length === 0) {
        shouldCancelTrip = true;
      } else {
        switch (trip.bookingType) {
          case "SINGLE":
            shouldCancelTrip = true;
            break;
          case "DOUBLE":
            if (seatsBookedByMember === 2) shouldCancelTrip = true;
            else
              newStatus =
                trip.status === "FULL" || trip.status === "ASSIGNED"
                  ? "OPEN"
                  : trip.status;
            break;
          case "TRIPLE":
            if (seatsBookedByMember === 3) shouldCancelTrip = true;
            else
              newStatus =
                trip.status === "FULL" || trip.status === "ASSIGNED"
                  ? "OPEN"
                  : trip.status;
            break;
        }
      }

      if (shouldCancelTrip) {
        const cancelled = await tx.trip.update({
          where: { id: tripId },
          data: {
            status: "CANCELLED",
            totalFare: 0,
            driverShare: 0,
            appCommission: 0,
          },
          include: { members: true },
        });
        return {
          deleted: false,
          trip: cancelled,
          penalty,
          outboundFare,
          totalTripCost,
        };
      }

      const updated = await tx.trip.update({
        where: { id: tripId },
        data: {
          totalFare: (trip.totalFare ?? 0) - member.passengerFare,
          driverShare: (trip.driverShare ?? 0) - member.passengerFare,
          appCommission: trip.appCommission ?? 0,
          status: newStatus,
        },
        include: { members: true },
      });

      return {
        deleted: false,
        trip: updated,
        penalty,
        outboundFare,
        totalTripCost,
      };
    });

    // --- NOTIFICATIONS ---
    const leftTitle = t(lang, "notifications.passenger_left_title");
    const leftBody = t(lang, "notifications.passenger_left_body", {
      tripId,
      penalty:
        penalty > 0
          ? `${penalty} ${t(lang, "currency")}`
          : t(lang, "no_penalty"),
    });

    const memberLeftTitle = t(lang, "notifications.member_left_title");
    const memberLeftBody = t(lang, "notifications.member_left_body", tripId);

    // Notify leaving user
    (async () => {
      try {
        await sendNotificationWithDelay(userId, leftTitle, leftBody);
      } catch (err) {
        console.error(`Notification failed for user ${userId}:`, err);
      }
    })();

    // Notify remaining members
    for (const m of updatedTrip.trip.members) {
      if (m.userId !== userId) {
        (async () => {
          try {
            await sendNotificationWithDelay(
              m.userId,
              memberLeftTitle,
              memberLeftBody
            );
          } catch (err) {
            console.error(`Notification failed for member ${m.userId}:`, err);
          }
        })();
      }
    }

    // --- SUCCESS RESPONSE ---
    return res.status(200).json({
      success: true,
      data: {
        deleted: updatedTrip.deleted,
        trip: updatedTrip.trip,
        penaltyApplied: penalty,
        penaltyMessage:
          penalty > 0
            ? `تم خصم ${penalty} جنيه من رصيدك كعقوبة للخروج قبل أقل من 8 ساعات من بدء الرحلة.`
            : "لا توجد عقوبة – لقد خرجت قبل أكثر من 8 ساعات من بدء الرحلة.",
        perTripFare: updatedTrip.outboundFare,
        totalTripCost: updatedTrip.totalTripCost,
      },
    });
  } catch (error) {
    console.error(`Error in leaveTrip: ${error}`);
    return res.status(500).json({
      error: t(lang, "errors.server_error"),
      details: error instanceof Error ? error.message : "خطأ غير معروف",
    });
  }
}

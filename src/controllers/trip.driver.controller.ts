import { Response } from "express";
import { FullRequest } from "../types/request";
import { t } from "../utils/i18n";
import { prisma } from "../libs/prisma";
import { TripStatus } from "@prisma/client";
import { checkDriverHasConflictingTrip } from "../utils/checkDriverHasConflictingTrip";
import { firebaseDB } from "../libs/firebase";
import { sendNotificationWithDelay } from "../utils/sendNotification";
import z, { set } from "zod";
import { differenceInHours } from "date-fns/differenceInHours";
import {
  combineDateAndTime,
  formatToISODate,
} from "../utils/combineDateAndTime";

export async function driverGetNearbyTrips(req: FullRequest, res: Response) {
  const lang = req.lang || "ar";
  try {
    const driverId = req.user?.id as string;
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 10;
    const skip = (page - 1) * pageSize;
    const to = req.query.to as string;
    const from = req.query.from as string;

    if (!driverId) {
      return res.status(404).json({ error: t(lang, "auth.user_notfound") });
    }

    const filters = {
      ...(from && { from: { contains: from, mode: "insensitive" as const } }),
      ...(to && { to: { contains: to, mode: "insensitive" as const } }),
      status: "FULL" as TripStatus,
      userHasEnoughMoney: true,
      startTime: { gte: new Date().toISOString() }, //
    };

    const [trips, tripCount] = await prisma.$transaction([
      prisma.trip.findMany({
        skip,
        take: pageSize,
        where: filters,
        include: {
          members: {
            select: {
              userId: true,
              user: {
                select: {
                  name: true,
                  phone: true,
                },
              },
              seatsBooked: true,
              passengerFare: true,
              pickupLat: true,
              pickupLng: true,
              dropLat: true,
              dropLng: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
        orderBy: { startTime: "asc" }, //
      }),
      prisma.trip.count({ where: filters }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        trips,
        page,
        pageSize,
        totalCount: tripCount,
        totalPages: Math.ceil(tripCount / pageSize),
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: t(lang, "errors.server_error"),
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function driverJoinsATrip(req: FullRequest, res: Response) {
  const lang = req.lang || "ar";
  try {
    const driverId = req.user?.id as string;

    if (!driverId) {
      return res
        .status(404)
        .json({ success: false, error: t(lang, "auth.user_notfound") });
    }

    const tripId = req.params.tripId as string;
    if (!tripId) {
      return res.status(400).json({
        success: false,
        error: t(lang, "trip.trip_id_required"),
      });
    }

    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        members: {
          include: { user: true },
        },
      },
    });

    if (!trip) {
      return res.status(404).json({
        success: false,
        error: t(lang, "trip.not_found"),
      });
    }
    if (
    
      trip.status === "CANCELLED" ||
      trip.status === "COMPLETED" ||
      !trip.userHasEnoughMoney
    ) {
      return res.status(400).json({
        success: false,
        error: t(lang, "trip.cannot_join_trip"),
      });
    }

    const hasConflict = await checkDriverHasConflictingTrip(
      driverId,
      new Date(trip.startTime)
    );

    if (hasConflict) {
      return res.status(400).json({
        success: false,
        error: t(lang, "trip.driver_conflicting_trip"),
      });
    }

    const updatedTrip = await prisma.trip.update({
      where: {
        id: trip.id,
      },
      data: {
        driverId,
        status: "ASSIGNED",
      },
      include: {
        members: true,
      },
    });

    const driver = await prisma.user.findUnique({ where: { id: driverId } });
    const driverName = driver?.name || t(lang, "trip.unknown_driver");

    // Notification logic
   // Notification logic
const driverNotificationTitle = t(
  lang,
  "notifications.driver_trip_join_success_title"
);
const driverNotificationBody = t(
  lang,
  "notifications.driver_trip_join_success_body",
  trip.from,
  trip.to
);

const memberNotificationTitle = t(
  lang,
  "notifications.driver_joined_title"
);
const memberNotificationBody = t(
  lang,
  "notifications.driver_joined_body",
  driverName,
  trip.from,
  trip.to
);


    // Notify the driver
    try {
      await sendNotificationWithDelay(
        driverId,
        driverNotificationTitle,
        driverNotificationBody
      );
    } catch (notifError) {
      console.error(
        "Failed to send driver trip join notification:",
        notifError
      );
    }

    // Notify all trip members (including the creator)
    for (const member of updatedTrip.members) {
      try {
        await sendNotificationWithDelay(
          member.userId,
          memberNotificationTitle,
          memberNotificationBody
        );
      } catch (notifError) {
        console.error(
          `Failed to send notification to user ${member.userId}:`,
          notifError
        );
      }
    }

    return res.status(200).json({
      success: true,
      data: updatedTrip,
    });
  } catch (error) {
    console.error(`error comes from server...... : ${error}`);
    return res.status(500).json({
      success: false,
      error: t(lang, "errors.server_error"),
    });
  }
}


export async function driverStartTrip(req: FullRequest, res: Response) {
  const lang = req.lang || "ar";

  try {
    const driverId = req.user?.id as string;
    const tripId = req.params.tripId as string;

    if (!driverId)
      return res.status(404).json({ error: t(lang, "auth.user_notfound") });

    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: { members: { include: { user: true } } },
    });

    if (!trip)
      return res.status(404).json({ error: t(lang, "trip.not_found") });

    if (trip.driverId !== driverId)
      return res.status(403).json({ error: t(lang, "trip.not_your_trip") });

    if (trip.status !== "ASSIGNED")
      return res.status(400).json({ error: t(lang, "trip.cannot_start_now") });

  
    const now = new Date();
    const tripTime = new Date(trip.startTime);
const oneHourBefore = new Date(tripTime.getTime() - (60 * 60 * 1000));   // 1 hour before
const halfHourAfter = new Date(tripTime.getTime() + (30 * 60 * 1000));   // 30 min after


if (now < oneHourBefore) {
  return res.status(400).json({
    error: t(lang, "trip.cannot_start_early"),
    details: t(lang, "trip.can_start_from", oneHourBefore.toLocaleString(lang)),
  });
}
if (now > halfHourAfter) {
  return res.status(400).json({
    error: t(lang, "trip.cannot_start_late"),
    details: t(lang, "trip.expired_at", halfHourAfter.toLocaleString(lang)),
  });
}
    const updatedTrip = await prisma.trip.update({
      where: { id: tripId },
      data: { status: TripStatus.STARTED },
      include: { members: { include: { user: true } } },
    });

    await firebaseDB.ref(`trips/${tripId}`).set({
      status: "STARTED",
      driverId,
      driverLocation: {
        lat: trip.fromLat,
        lng: trip.fromLng,
      },
      startedAt: Date.now(),
    });

    const driver = await prisma.user.findUnique({ where: { id: driverId } });

    const driverTitle = t(lang, "notifications.trip_started_driver_title");
    const driverBody = t(
      lang,
      "notifications.trip_started_driver_body",
      updatedTrip.from,
      updatedTrip.to
    );

    const memberTitle = t(lang, "notifications.trip_started_member_title");
    const memberBody = t(
      lang,
      "notifications.trip_started_member_body",
      driver?.name || "",
      updatedTrip.from,
      updatedTrip.to
    );

    await sendNotificationWithDelay(driverId, driverTitle, driverBody);

    for (const member of updatedTrip.members) {
      await sendNotificationWithDelay(member.userId, memberTitle, memberBody);
    }

    return res.status(200).json({
      success: true,
      message: "Trip started successfully and tracking initialized.",
      data: updatedTrip,
    });
  } catch (error) {
    console.error("Error starting trip:", error);
    return res.status(500).json({ error: t(lang, "errors.server_error") });
  }
}

export async function updateDriverLocation(req: FullRequest, res: Response) {
  try {
    const { lat, lng } = req.body;
    const tripId = req.params.tripId;
    const driverId = req.user?.id;

    if (!lat || !lng) {
      return res.status(400).json({ error: "Missing lat or lng" });
    }

    if (!tripId || !driverId) {
      return res.status(400).json({ error: "Missing tripId or driverId" });
    }

    await firebaseDB.ref(`trips/${tripId}`).update({
      driverLocation: { lat, lng },
      driverId,
      updatedAt: Date.now(),
    });

    return res.status(200).json({
      success: true,
      message: "Driver location updated successfully",
    });
  } catch (error) {
    console.error("Error updating driver location:", error);
    return res.status(500).json({ error: "Server error" });
  }
}

export async function getDriverLocation(req: FullRequest, res: Response) {
  try {
    const { tripId } = req.params;

    if (!tripId) {
      return res.status(400).json({ error: "Missing tripId" });
    }

    const snapshot = await firebaseDB
      .ref(`trips/${tripId}/driverLocation`)
      .once("value");

    if (!snapshot.exists()) {
      return res.status(404).json({ error: "Driver location not found" });
    }

    return res.status(200).json({
      success: true,
      driverLocation: snapshot.val(),
    });
  } catch (error) {
    console.error("Error fetching driver location:", error);
    return res.status(500).json({ error: "Server error" });
  }
}

export async function driverEndTrip(req: FullRequest, res: Response) {
  const lang = req.lang || "ar";
  try {
    const driverId = req.user?.id as string;
    const tripId = req.params.tripId as string;

    if (!driverId) {
      return res.status(404).json({ error: t(lang, "auth.user_notfound") });
    }

    const result = await prisma.$transaction(async (tx) => {
      const trip = await tx.trip.findUnique({
        where: { id: tripId },
        include: {
          members: {
            include: {
              user: { select: { id: true, balance: true, phone: true } },
            },
          },
          driver: { select: { id: true } },
        },
      });

      if (!trip) {
        throw new Error(t(lang, "trip.not_found"));
      }
      if (trip.driverId !== driverId) {
        throw new Error(t(lang, "trip.not_your_trip"));
      }
      if (trip.status !== "STARTED") {
        throw new Error(t(lang, "trip.not_started_yet"));
      }

      // Deduct from each passenger
      for (const member of trip.members) {
        const user = member.user;
        const fare = member.passengerFare;

        await tx.user.update({
          where: { id: user.id },
          data: { balance: { decrement: fare } },
        });

        await tx.moneyTransaction.create({
          data: {
            screen: "Trip Fare Deduction",
            phone: user.phone,
            reference: `Trip-${trip.id}`,
            status: "SUCCESS",
            userId: user.id,
            shippingPrice: fare,
          },
        });
      }

      // Add driverShare to driver

      await tx.user.update({
        where: { id: driverId },
        data: { balance: { increment: trip.driverShare as number } },
      });

      // Mark trip as completed and paid
      const updatedTrip = await tx.trip.update({
        where: { id: tripId },
        data: { status: "COMPLETED", isPaid: true },
        include: { members: true },
      });

      return updatedTrip;
    });

    // Notifications
    const driverTitle = t(lang, "notifications.trip_ended_driver_title");
    const driverBody = t(
      lang,
      "notifications.trip_ended_driver_body",
      result.from,
      result.to
    );

    const memberTitle = t(lang, "notifications.trip_ended_member_title");
    const memberBody = t(
      lang,
      "notifications.trip_ended_member_body",
      result.from,
      result.to
    );

    await sendNotificationWithDelay(driverId, driverTitle, driverBody);
    await Promise.all(
      result.members.map((m) =>
        sendNotificationWithDelay(m.userId, memberTitle, memberBody)
      )
    );

    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    console.error("Error ending trip:", error);
    const message = error?.message || t(lang, "errors.server_error");

    if (message.includes("not_found"))
      return res.status(404).json({ error: message });
    if (message.includes("not_your_trip"))
      return res.status(403).json({ error: message });
    if (
      message.includes("not_started_yet") ||
      message.includes("insufficient_balance")
    )
      return res.status(400).json({ error: message });

    return res.status(500).json({ error: t(lang, "errors.server_error") });
  }
}
export async function driverLeaveTrip(req: FullRequest, res: Response) {
  const lang = req.lang || "ar";
  try {
    // Validate tripId
    const schema = z.object({
      tripId: z.string({ message: t(lang, "trip.trip_id_required") }),
    });
    const parseResult = schema.safeParse({ tripId: req.body.tripId });
    if (!parseResult.success) {
      return res.status(400).json({
        error: t(lang, "errors.validation_failed"),
        details: parseResult.error.flatten(),
      });
    }

    const { tripId } = parseResult.data;
    const driverId = req.user?.id as string;

    if (!driverId) {
      return res.status(404).json({ error: t(lang, "auth.user_notfound") });
    }

    // --- Get trip info ---
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
    });

    if (!trip) {
      return res.status(404).json({ error: t(lang, "trip.not_found") });
    }

    if (trip.driverId !== driverId) {
      return res.status(403).json({
        error: t(lang, "trip.not_your_trip"),
        details: t(lang, "trip.not_driver_details"),
      });
    }

    // --- Combine date & time in Egypt local time ---
    let tripStartDate: Date;
    try {
      const rawDate = trip.tripDates.trim();

      // Parse tripDates: yyyy-MM-dd or dd-MM-yyyy
      let year: number, month: number, day: number;
      const parts = rawDate.split("-").map(Number);
      if (parts[0] >= 1000) [year, month, day] = parts;
      else [day, month, year] = parts;

      const localDate = new Date(year, month - 1, day);

      // Convert ISO startTime to Egypt time (UTC+2)
      const utcDate = new Date(trip.startTime);
      const egyptTime = new Date(utcDate.getTime() + 2 * 60 * 60 * 1000);

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
        details: err instanceof Error ? err.message : "Unknown error",
      });
    }

    const now = new Date();
    const hoursUntilStart = differenceInHours(tripStartDate, now);

    // --- TIME RULES ---
    if (hoursUntilStart < 6) {
      return res.status(400).json({
        error: t(lang, "driver.cannot_leave_too_late"),
        details: t(lang, "driver.cannot_leave_too_late_details", { hours: 6 }),
      });
    }

    const penalty = hoursUntilStart < 12 ? 30 : 0;

    // --- TRANSACTION ---
    const result = await prisma.$transaction(async (tx) => {
      if (penalty > 0) {
        await tx.user.update({
          where: { id: driverId },
          data: { balance: { decrement: penalty } },
        });
      }

      const updatedTrip = await tx.trip.update({
        where: { id: tripId },
        data: {
          driverId: null,
          status: "COMPLETED",
        },
      });

      return { trip: updatedTrip, penalty };
    });

    // --- NOTIFICATIONS ---
    const driverTitle = t(lang, "notifications.driver_left_trip_title");
    const driverBody = t(lang, "notifications.driver_left_trip_body", {
      tripId,
      penalty:
        penalty > 0
          ? `${penalty} ${t(lang, "currency")}`
          : t(lang, "no_penalty"),
    });

    const members = await prisma.tripMember.findMany({
      where: { tripId },
      select: { userId: true },
    });

    const memberTitle = t(lang, "notifications.driver_left_trip_member_title");
    const memberBody = t(lang, "notifications.driver_left_trip_member_body", {
      tripId,
    });

    for (const member of members) {
      if (member.userId !== driverId) {
        (async () => {
          try {
            await sendNotificationWithDelay(
              member.userId,
              memberTitle,
              memberBody
            );
          } catch (err) {
            console.error(`Failed to notify member ${member.userId}:`, err);
          }
        })();
      }
    }

    (async () => {
      try {
        await sendNotificationWithDelay(driverId, driverTitle, driverBody);
      } catch (err) {
        console.error(`Failed to notify driver ${driverId}:`, err);
      }
    })();

    // --- RESPONSE ---
    return res.status(200).json({
      success: true,
      data: {
        trip: result.trip,
        penaltyApplied: penalty,
        penaltyMessage:
          penalty > 0
            ? `تم خصم ${penalty} جنيه من رصيدك كعقوبة على مغادرة الرحلة قبل أقل من 12 ساعة من موعدها.`
            : "لا توجد عقوبة – لقد غادرت الرحلة قبل أكثر من 12 ساعة من موعدها.",
      },
    });
  } catch (error) {
    console.error("Error in driverLeaveTrip:", error);
    return res.status(500).json({
      error: t(lang, "errors.server_error"),
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}


export async function getFullTrips(req: FullRequest, res: Response) {
  const lang = req.lang || "ar";

  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 10;
    const skip = (page - 1) * pageSize;

    const now = new Date();

 const filters = {
  status: "FULL" as TripStatus,
  userHasEnoughMoney: true,
  startTime: { gte: now.toISOString() },
};


    const [trips, tripCount] = await prisma.$transaction([
      prisma.trip.findMany({
        skip,
        take: pageSize,
        where: filters,
        include: {
          members: {
            select: {
              userId: true,
              user: { select: { name: true, phone: true } },
              seatsBooked: true,
              passengerFare: true,
              pickupLat: true,
              pickupLng: true,
              dropLat: true,
              dropLng: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
        orderBy: { startTime: "asc" },
      }),
      prisma.trip.count({ where: filters }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        trips,
        page,
        pageSize,
        totalCount: tripCount,
        totalPages: Math.ceil(tripCount / pageSize),
      },
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: t(lang, "errors.server_error"),
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

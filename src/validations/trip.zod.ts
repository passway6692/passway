import { z } from "zod";
import { t } from "../utils/i18n";
import { compareTimes } from "../utils/compareTimes";

export function getTripSchema(lang: string) {
  const today = new Date().toISOString().split("T")[0]; // "2025-11-04"
  return z
    .object({
      from: z.string({ error: t(lang, "trip.from_required") }),
      to: z.string({ error: t(lang, "trip.to_required") }),

      fromLat: z
        .number({ error: t(lang, "trip.fromLat_required") })
        .min(-90, t(lang, "trip.invalid_lat"))
        .max(90, t(lang, "trip.invalid_lat")),
      fromLng: z
        .number({ error: t(lang, "trip.fromLng_required") })
        .min(-180, t(lang, "trip.invalid_lng"))
        .max(180, t(lang, "trip.invalid_lng")),

      toLat: z
        .number({ error: t(lang, "trip.toLat_required") })
        .min(-90, t(lang, "trip.invalid_lat"))
        .max(90, t(lang, "trip.invalid_lat")),
      toLng: z
        .number({ error: t(lang, "trip.toLng_required") })
        .min(-180, t(lang, "trip.invalid_lng"))
        .max(180, t(lang, "trip.invalid_lng")),

      startTime: z.string({ error: t(lang, "trip.startTime_required") }),
      endTime: z.string().optional(), // Make it completely optional

      type: z.enum(["ONE_WAY", "ROUND_TRIP"], t(lang, "trip.invalid_type")),
      bookingType: z.enum(
        ["SINGLE", "DOUBLE", "TRIPLE"],
        t(lang, "trip.invalid_booking_type")
      ),

      seatsRequested: z
        .number({ error: t(lang, "trip.seats_required") })
        .min(1, t(lang, "trip.min_seats"))
        .max(3, t(lang, "trip.max_seats")),

      tripDates: z
        .array(z.string())
        .min(1, t(lang, "trip.tripDates_required"))
        .refine((dates) => dates.every((d) => d >= today), {
          message: t(lang, "trip.date_cannot_be_in_past"),
          path: [], // applies to whole array
        }),
    })
    .refine((data) => data.type !== "ROUND_TRIP" || !!data.endTime, {
      message: t(lang, "trip.endTime_required"),
      path: ["endTime"],
    })
    .refine(
      (data) => {
        if (data.type === "ROUND_TRIP" && data.endTime) {
          return compareTimes(data.startTime, data.endTime) < 0;
        }
        return true;
      },
      {
        message: t(lang, "trip.endTime_after_startTime"),
        path: ["endTime"],
      }
    )
    .superRefine((data, ctx) => {
      const { bookingType, seatsRequested } = data;

      if (bookingType === "SINGLE" && seatsRequested !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t(lang, "trip.invalid_seats_single"), //
          path: ["seatsRequested"],
        });
      }

      if (bookingType === "DOUBLE" && ![1, 2].includes(seatsRequested)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t(lang, "trip.invalid_seats_double"), //
          path: ["seatsRequested"],
        });
      }

      if (bookingType === "TRIPLE" && ![1, 2, 3].includes(seatsRequested)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t(lang, "trip.invalid_seats_triple"), //
          path: ["seatsRequested"],
        });
      }
    });
}

export function getJoinSchema(lang: string) {
  return z.object({
    tripId: z.string({ error: t(lang, "trip.tripId_required") }),
    seatsRequested: z
      .number({ error: t(lang, "trip.seats_required") })
      .min(1, t(lang, "trip.min_seats"))
      .max(3, t(lang, "trip.max_seats")),
    pickupLat: z
      .number({ error: t(lang, "trip.fromLat_required") })
      .min(-90, t(lang, "trip.invalid_lat"))
      .max(90, t(lang, "trip.invalid_lat")),
    pickupLng: z
      .number({ error: t(lang, "trip.fromLng_required") })
      .min(-180, t(lang, "trip.invalid_lng"))
      .max(180, t(lang, "trip.invalid_lng")),

    dropLat: z
      .number({ error: t(lang, "trip.toLat_required") })
      .min(-90, t(lang, "trip.invalid_lat"))
      .max(90, t(lang, "trip.invalid_lat")),
    dropLng: z
      .number({ error: t(lang, "trip.toLng_required") })
      .min(-180, t(lang, "trip.invalid_lng"))
      .max(180, t(lang, "trip.invalid_lng")),
  });
}

export const getTripFareSchema = (lang: string) =>
  z
    .object({
      fromLat: z
        .number({ error: t(lang, "trip.fromLat_required") })
        .min(-90, t(lang, "trip.invalid_lat"))
        .max(90, t(lang, "trip.invalid_lat")),
      fromLng: z
        .number({ error: t(lang, "trip.fromLng_required") })
        .min(-180, t(lang, "trip.invalid_lng"))
        .max(180, t(lang, "trip.invalid_lng")),

      toLat: z
        .number({ error: t(lang, "trip.toLat_required") })
        .min(-90, t(lang, "trip.invalid_lat"))
        .max(90, t(lang, "trip.invalid_lat")),
      toLng: z
        .number({ error: t(lang, "trip.toLng_required") })
        .min(-180, t(lang, "trip.invalid_lng"))
        .max(180, t(lang, "trip.invalid_lng")),
      seatsRequested: z
        .number({ error: t(lang, "trip.seats_required") })
        .min(1, t(lang, "trip.min_seats"))
        .max(3, t(lang, "trip.max_seats")),

      bookingType: z.enum(
        ["SINGLE", "DOUBLE", "TRIPLE"],
        t(lang, "trip.invalid_booking_type")
      ),
    })
    .superRefine((data, ctx) => {
      const { bookingType, seatsRequested } = data;

      if (bookingType === "SINGLE" && seatsRequested !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t(lang, "trip.invalid_seats_single"), 
          path: ["seatsRequested"],
        });
      }

      if (bookingType === "DOUBLE" && ![1, 2].includes(seatsRequested)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t(lang, "trip.invalid_seats_double"), 
          path: ["seatsRequested"],
        });
      }

      if (bookingType === "TRIPLE" && ![1, 2, 3].includes(seatsRequested)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t(lang, "trip.invalid_seats_triple"), 
          path: ["seatsRequested"],
        });
      }
    });
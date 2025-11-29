import { z } from "zod";
import { t } from "../utils/i18n";

export const getSignupSchema = (lang: string) =>
  z
    .object({
      phone: z
        .string({ error: t(lang, "zod.phone_required") })
        .min(11, t(lang, "zod.phone_required")),
      password: z
        .string({ error: t(lang, "zod.password_min") })
        .min(8, t(lang, "zod.password_min")),
      name: z
        .string({ error: t(lang, "zod.name_required") })
        .min(1, t(lang, "zod.name_required"))
        .max(100, t(lang, "zod.name_max")),
        gender :z.enum(["MALE","FEMALE"],t(lang,"zod.gender_invalid")),
      image: z.url(t(lang, "zod.image_url")).optional(),
      role: z.enum(["USER", "DRIVER"], t(lang, "zod.role_invalid")),


      location: z.string().optional(),
      lat: z
        .number({ error: t(lang, "driver.lat_required") })
        .min(-90, t(lang, "trip.invalid_lat"))
        .max(90, t(lang, "trip.invalid_lat"))
        .optional(),
      lng: z
        .number({ error: t(lang, "driver.lng_required") })
        .min(-180, t(lang, "trip.invalid_lng"))
        .max(180, t(lang, "trip.invalid_lng"))
        .optional(),
    })
    .superRefine((data, ctx) => {
      if (data.role === "DRIVER") {
        //    location
        if (!data.location) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t(lang, "driver.location_required"),
            path: ["location"],
          });
        }

        // drive image
        if (!data.image) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t(lang, "driver.image_required"),
            path: ["image"],
          });
        }

        //اat
        if (data.lat === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t(lang, "driver.lat_required"),
            path: ["lat"],
          });
        } else if (data.lat < -90 || data.lat > 90) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t(lang, "trip.invalid_lat"),
            path: ["lat"],
          });
        }

        //
        if (data.lng === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t(lang, "driver.lng_required"),
            path: ["lng"],
          });
        } else if (data.lng < -180 || data.lng > 180) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t(lang, "trip.invalid_lng"),
            path: ["lng"],
          });
        }
      }
    });
export const getLoginSchema = (lang: string) =>
  z.object({
    phone: z
      .string({ error: t(lang, "zod.phone_required") })
      .min(11, t(lang, "zod.phone_required")),

    password: z
      .string({ error: t(lang, "zod.password_min") })
      .min(8, t(lang, "zod.password_min")),
  });

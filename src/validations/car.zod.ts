import z from "zod";
import { t } from "../utils/i18n";

export const getCarSchema = (lang: string) =>
  z.object({
    driverLicenseExpiryDate: z
      .string({ error: t(lang, "car.invalid_driver_license_expiry_date") })
      .refine((val) => !isNaN(Date.parse(val)), {
        error: t(lang, "car.invalid_driver_license_expiry_date"),
      }),

    carPlate: z.string({ error: t(lang, "car.car_plate_required") }),

    carPhotoFront: z.url({ error: t(lang, "car.car_photo_front_required") }),

    driverLicensePhotoFront: z.url({
      error: t(lang, "car.driver_license_photo_front_required"),
    }),
    driverLicensePhotoBack: z.url({
      error: t(lang, "car.driver_license_photo_back_required"),
    }),

    carLicensePhotoFront: z.url({
      error: t(lang, "car.car_license_photo_front_required"),
    }),
    carLicensePhotoBack: z.url({
      error: t(lang, "car.car_license_photo_back_required"),
    }),

    idCardPhotoFront: z.url({
      error: t(lang, "car.id_card_photo_front_required"),
    }),
    idCardPhotoBack: z.url({
      error: t(lang, "car.id_card_photo_back_required"),
    }),
      brand: z.string({ 
      error: t(lang, "car.brand_required"),
    }).min(1, t(lang, "car.brand_required")),
    
    model: z.string({ 
      error: t(lang, "car.model_required"),
    }).min(1, t(lang, "car.model_required")),
    
    year: z.number({
      error: t(lang, "car.year_required"),
    }).min(1980, t(lang, "car.year_min")).max(new Date().getFullYear() + 1, t(lang, "car.year_max")),
    
    color: z.string({ 
      error: t(lang, "car.color_required"),

    }).min(1, t(lang, "car.color_required")),

  });

export const getAcceptRejectCarSchema = (lang: string) =>
  z.object({
    approved: z.boolean({
      error: t(lang, "car.approved_required"),
    }),
    reason: z.string().optional(),
  });

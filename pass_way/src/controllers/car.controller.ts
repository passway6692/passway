import { Response } from "express";
import { prisma } from "../libs/prisma";
import { getCarSchema } from "../validations/car.zod";
import { FullRequest } from "../types/request";
import { t } from "../utils/i18n";
import { sendNotificationWithDelay } from "../utils/sendNotification";
export const addCar = async (req: FullRequest, res: Response) => {
  try {
    const lang = req.lang || "ar";
    const CarSchema = getCarSchema(lang);
    const result = CarSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: t(lang, "errors.validation_failed"),
        details: result.error.flatten(),
      });
    }

    const {
      brand,
      model,
      year,
      color,
      driverLicenseExpiryDate,
      carPlate,
      carPhotoFront,
      carLicensePhotoBack,
      driverLicensePhotoFront,
      driverLicensePhotoBack,
      carLicensePhotoFront,
      idCardPhotoFront,
      idCardPhotoBack,
    } = result.data;

    const driverId = req.user!.id;
    const driverName = req.user!.name;
    const currentYear = new Date().getFullYear();
    if (year < 1980 || year > currentYear + 1) {
      return res.status(400).json({
        success: false,
        error: t(lang, "car.invalid_year"),
      });
    }

    const expiryDate = new Date(driverLicenseExpiryDate);
    if (expiryDate < new Date()) {
      return res.status(400).json({
        success: false,
        error: t(lang, "car.driver_license_expired"),
      });
    }

    const existingCar = await prisma.car.findUnique({
      where: { driverId },
    });

    if (existingCar) {
      return res.status(400).json({
        success: false,
        error: t(lang, "car.driver_already_has_car"),
      });
    }

    const car = await prisma.car.create({
      data: {
        driverId,
        brand,
        model,
        year,
        color,
        carPlate,
        driverLicenseExpiryDate: new Date(driverLicenseExpiryDate),
        carPhotoFront,
        carLicensePhotoBack,
        driverLicensePhotoFront,
        driverLicensePhotoBack,
        carLicensePhotoFront,
        idCardPhotoFront,
        idCardPhotoBack,
        status: "PENDING",
      },
    });

    const driverTitle = t(lang, "notifications.car_pending_title");
    const driverBody = t(lang, "notifications.car_pending_body");
    await sendNotificationWithDelay(driverId, driverTitle, driverBody);

    const admins = await prisma.user.findMany({
      where: { role: "ADMIN" },
      select: { id: true },
    });

    const adminTitle = t(lang, "notifications.new_car_added_title").replace(
      "${name}",
      driverName
    );
    const adminBody = t(lang, "notifications.new_car_added_body");

    await Promise.all(
      admins.map((admin) =>
        sendNotificationWithDelay(admin.id, adminTitle, adminBody)
      )
    );

    return res.status(200).json({
      success: true,
      data: { car },
    });
  } catch (error: any) {
    console.error("Add car error:", error);
    return res.status(500).json({
      success: false,
      error: t(req.lang || "ar", "errors.server_error"),
    });
  }
};

export const updateCar = async (req: FullRequest, res: Response) => {
  try {
    const lang = req.lang || "ar";
    const CarSchema = getCarSchema(lang).partial();
    const result = CarSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: t(lang, "errors.validation_failed"),
        details: result.error.flatten(),
      });
    }

    const carId = req.params.id;
    const driverId = req.user!.id;
    const driverName = req.user!.name;

    const car = await prisma.car.findUnique({ where: { id: carId } });
    if (!car) {
      return res.status(404).json({
        success: false,
        error: t(lang, "car.car_not_found"),
      });
    }

    if (car.driverId !== driverId) {
      return res.status(403).json({
        success: false,
        error: t(lang, "car.not_authorized"),
      });
    }

    if (result.data.year) {
      const currentYear = new Date().getFullYear();
      if (result.data.year < 1980 || result.data.year > currentYear + 1) {
        return res.status(400).json({
          success: false,
          error: t(lang, "car.invalid_year"),
        });
      }
    }

    if (result.data.driverLicenseExpiryDate) {
      const expiryDate = new Date(result.data.driverLicenseExpiryDate);
      if (expiryDate < new Date()) {
        return res.status(400).json({
          success: false,
          error: t(lang, "car.driver_license_expired"),
        });
      }
    }

    const updatedCar = await prisma.car.update({
      where: { id: carId },
      data: {
        ...result.data,
        driverLicenseExpiryDate: result.data.driverLicenseExpiryDate
          ? new Date(result.data.driverLicenseExpiryDate)
          : undefined,
        status: "PENDING",
      },
    });

    const driverTitle = t(lang, "notifications.car_update_pending_title");
    const driverBody = t(lang, "notifications.car_update_pending_body");
    await sendNotificationWithDelay(driverId, driverTitle, driverBody);

    const admins = await prisma.user.findMany({
      where: { role: "ADMIN" },
      select: { id: true },
    });

    const adminTitle = t(
      lang,
      "notifications.car_updated_by_driver_title"
    ).replace("${name}", driverName);
    const adminBody = t(lang, "notifications.car_updated_by_driver_body");

    await Promise.all(
      admins.map((admin) =>
        sendNotificationWithDelay(admin.id, adminTitle, adminBody)
      )
    );

    return res.json({
      success: true,
      message: t(lang, "car.car_updated"),
      car: updatedCar,
    });
  } catch (error: any) {
    console.error("Update car error:", error);
    return res.status(500).json({
      success: false,
      error: t(req.lang || "ar", "errors.server_error"),
    });
  }
};

export const getLoggedCar = async (req: FullRequest, res: Response) => {
  try {
    const lang = req.lang || "ar";
    const driverId = req.user!.id;

    const car = await prisma.car.findUnique({
      where: { driverId },
    });

    if (!car) {
      return res.status(404).json({
        success: false,
        error: t(lang, "car.car_not_found"),
      });
    }

    res.json({
      success: true,
      car,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: t(req.lang || "en", "errors.server_error"),
    });
  }
};

export const getLoggedCarStatus = async (req: FullRequest, res: Response) => {
  try {
    const lang = req.lang || "ar";
    const driverId = req.user!.id;

    const car = await prisma.car.findUnique({
      where: { driverId },
      select: {
        id: true,
        status: true,
        brand: true,
        model: true,
        year: true,
        color: true,
      },
    });

    if (!car) {
      return res.status(404).json({
        success: false,
        error: t(lang, "car.car_not_found"),
      });
    }

    res.json({
      success: true,
      car,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: t(req.lang || "en", "errors.server_error"),
    });
  }
};

export const getCarDetails = async (req: FullRequest, res: Response) => {
  try {
    const lang = req.lang || "ar";
    const carId = req.params.carId;

    const car = await prisma.car.findUnique({
      where: { id: carId },
      select: {
        id: true,
        brand: true,
        model: true,
        year: true,
        color: true,
        carPlate: true,
        carPhotoFront: true,
        driver: {
          select: {
            id: true,
            name: true,
            image: true,
            averageRating: true,
          },
        },
      },
    });

    if (!car) {
      return res.status(404).json({
        success: false,
        error: t(lang, "car.car_not_found"),
      });
    }

    res.json({
      success: true,
      car,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: t(req.lang || "en", "errors.server_error"),
    });
  }
};

import { Response } from "express";
import { prisma } from "../libs/prisma";
import { FullRequest } from "../types/request";
import { CarStatus } from "@prisma/client";
import { getAcceptRejectCarSchema } from "../validations/car.zod";
import z from "zod";
import { t } from "../utils/i18n";
import { sendNotificationWithDelay } from "../utils/sendNotification";
import { MoneyTransactionStatus } from "@prisma/client";

export async function getAllCars(req: FullRequest, res: Response) {
  try {
    const page = Number(req.query.carPage) > 0 ? Number(req.query.carPage) : 1;
    const pageSize =
      Number(req.query.carPageSize) > 0 ? Number(req.query.carPageSize) : 10;

    const statusParam = req.query.status as string;
    const validStatuses = ["PENDING", "APPROVED", "REJECTED"];
    const status = validStatuses.includes(statusParam?.toUpperCase())
      ? (statusParam.toUpperCase() as CarStatus)
      : undefined;

    const skip = (page - 1) * pageSize;

    const [cars, carsCount] = await Promise.all([
      prisma.car.findMany({
        where: status ? { status } : {},
        take: pageSize,
        skip,
        select: {
          id: true,
          status: true,
          carPlate: true,
          driverLicenseExpiryDate: true,
          carPhotoFront: true,
          driverLicensePhotoFront: true,
          driverLicensePhotoBack: true,
          carLicensePhotoFront: true,
          carLicensePhotoBack: true,
          idCardPhotoFront: true,
          idCardPhotoBack: true,
          createdAt: true,
          updatedAt: true,
          driver: {
            select: {
              id: true,
              role: true,
              image: true,
              name: true,
              phone: true,
              createdAt: true,
            },
          },
        },
      }),
      prisma.car.count({ where: status ? { status } : {} }),
    ]);

    res.json({
      success: true,
      data: {
        items: cars,
        pagination: {
          page,
          pageSize,
          total: carsCount,
          totalPages: Math.ceil(carsCount / pageSize),
        },
      },
    });
  } catch (error: any) {
    console.error("Error fetching cars:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get cars",
      error: error.message,
    });
  }
}

export async function getAllUsers(req: FullRequest, res: Response) {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 10;
    const skip = (page - 1) * pageSize;

    const [allUsers, usersCount] = await Promise.all([
      prisma.user.findMany({
        where: { role: "USER" },
        skip,
        take: pageSize,
        select: {
          id: true,
          _count: true,
          image: true,
          name: true,
          phone: true,
          role: true,
          createdAt: true,
        },
      }),

      //total users
      prisma.user.count({ where: { role: "USER" } }),
    ]);

    const response = {
      success: true,
      data: {
        items: allUsers,
        pagination: {
          page,
          pageSize,
          total: usersCount,
          totalPages: Math.ceil(usersCount / pageSize),
        },
      },
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: "Failed to get All users" });
  }
}

export async function getDashboardCounts(req: FullRequest, res: Response) {
  try {
    const [usersCount, activeDriversCount, PendingCarsCount, tripsCount] =
      await Promise.all([
        prisma.user.count({ where: { role: "USER" } }),
        prisma.car.count({ where: { status: "APPROVED" } }),
        prisma.car.count({ where: { status: "PENDING" } }),
        //TODO: trips count
        prisma.trip.count(),
      ]);

    const response = {
      success: true,
      data: {
        usersCount: usersCount,
        activeDriversCount: activeDriversCount,
        PendingCarsCount: PendingCarsCount,
        tripsCount,
      },
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: "Failed to get Dashboard Counts" });
  }
}



export async function AcceptOrRejectCar(req: FullRequest, res: Response) {
  try {
    const lang = req.lang || "ar";
    const schema = getAcceptRejectCarSchema(lang);
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: t(lang, "errors.validation_failed"),
        details: result.error.flatten(),
      });
    }

    const { approved, reason } = result.data;
    const { carId } = req.params;
    const adminId = req.user?.id;

    if (!adminId) {
      return res
        .status(403)
        .json({ error: t(lang, "auth.admin_auth_required") });
    }

    const car = await prisma.car.findUnique({
      where: { id: carId },
      include: {
        driver: {
          select: {
            id: true,
            image: true,
            name: true,
            phone: true,
            role: true,
            createdAt: true,
          },
        },
      },
    });

    if (!car) {
      return res.status(404).json({ error: t(lang, "car.car_not_found") });
    }

    if (car.status !== "PENDING") {
      return res.status(400).json({ error: t(lang, "car.car_not_pending") });
    }

    const newStatus = approved ? "APPROVED" : "REJECTED";

    await prisma.$transaction(async (tx) => {
      await tx.car.update({
        where: { id: carId },
        data: { status: newStatus },
      });
      await tx.carApproval.create({
        data: {
          carId,
          adminId,
          approved,
          reason: reason || null,
        },
      });
    });

    const message = approved
      ? t(lang, "car.approved_success")
      : `${t(lang, "car.rejected_reason").replace(
          "{{reason}}",
          reason || t(lang, "car.reason_unspecified")
        )}`;

    try {
      await sendNotificationWithDelay(
        car.driver.id,
        approved
          ? t(lang, "notifications.car_approved_title")
          : t(lang, "notifications.car_rejected_title"),
        message
      );
    } catch (notifError) {
      console.error("Failed to send car approval notification:", notifError);
    }

    res.json({
      success: true,
      message,
    });
  } catch (error) {
    console.error("AcceptOrRejectCar error:", error);
    res.status(500).json({ error: t(req.lang || "ar", "errors.server_error") });
  }
}

export async function adminGetCarDetailsById(req: FullRequest, res: Response) {
  try {
    const lang = req.lang || "ar";
    const { carId } = req.params;
    if (!carId) {
      return res.status(400).json({
        success: false,
        message: lang === "ar" ? "مطلوب رقم العربية" : "Car ID is required",
      });
    }

    const car = await prisma.car.findUnique({
      where: { id: carId },
      include: {
        driver: {
          select: {
            id: true,
            name: true,
            phone: true,
            image: true,
            location: true,
            balance: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!car) {
      return res.status(404).json({
        success: false,
        message: lang === "ar" ? "العربية غير موجودة" : "Car not found",
      });
    }
    return res.status(200).json({
      success: true,
      message: lang === "ar" ? "تم جلب بيانات العربية" : "Car details fetched",
      data: car,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: res
        .status(500)
        .json({ error: t(req.lang || "ar", "errors.server_error") }),
    });
  }
}

export const updateSettingSchema = z.object({
  minimumFare: z.number().min(0, "minimumFare must be >= 0"),
  appCommission: z
    .number()
    .min(0, "appCommission must be >= 0")
    .max(1, "appCommission must be <= 1"),
  userBonus: z.number().min(0),
});

export async function getSetting(req: FullRequest, res: Response) {
  try {
    if (req.user?.role !== "ADMIN") {
      return res
        .status(403)
        .json({ error: "Access restricted to admins only" });
    }

    const setting = await prisma.setting.findFirst({
      select: {
        id: true,
        minimumFare: true,
        userBonus: true,
        appCommission: true,
      },
    });

    if (!setting) {
      return res.status(404).json({
        success: false,
        message: "Setting not found",
      });
    }

    return res.json({
      success: true,
      data: setting,
    });
  } catch (error) {
    console.error("getSetting error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch setting",
    });
  }
}

export async function updateSetting(req: FullRequest, res: Response) {
  try {
    if (req.user?.role !== "ADMIN") {
      return res
        .status(403)
        .json({ error: "Access restricted to admins only" });
    }

    const parsed = updateSettingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "Validation failed",
        details: parsed.error.format(),
      });
    }

    const { minimumFare, appCommission, userBonus } = parsed.data;

    const existingSetting = await prisma.setting.findFirst();
    if (!existingSetting) {
      return res.status(404).json({
        success: false,
        message: "Setting not found",
      });
    }

    const [updatedSetting, updatedUsers] = await prisma.$transaction([
      prisma.setting.update({
        where: { id: existingSetting.id },
        data: {  minimumFare, appCommission, userBonus },
        select: {
          id: true,
          minimumFare: true,
          appCommission: true,
          userBonus: true,
        },
      }),
      prisma.user.updateMany({
        where: { role: "USER" },
        data: { userBonus },
      }),
    ]);

    return res.json({
      success: true,
      message: "Setting and all users updated successfully",
      data: {
        setting: updatedSetting,
        usersUpdated: updatedUsers.count,
      },
    });
  } catch (error) {
    console.error("updateSetting error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update setting",
    });
  }
}





const updateBookingTypeSchema = z.array(
  z.object({
    bookingType: z.enum(["SINGLE", "DOUBLE", "TRIPLE"]),
    baseFare: z.number().positive(),
    perKmRate: z.number().positive(),
  })
);


export async function getBookingTypeSettings(req: FullRequest, res: Response) {
  try {
    if (req.user?.role !== "ADMIN") {
      return res.status(403).json({ error: "Access restricted to admins only" });
    }

    const settings = await prisma.bookingTypeSetting.findMany({
      select: {
        id: true,
        bookingType: true,
        baseFare: true,
        perKmRate: true

      },
    });

    return res.json({
      success: true,
      data: settings,
    });
  } catch (error) {
    console.error("getBookingTypeSettings error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch booking type settings",
    });
  }
}


export async function updateBookingTypeSettings(req: FullRequest, res: Response) {
  try {
    if (req.user?.role !== "ADMIN") {
      return res.status(403).json({ error: "Access restricted to admins only" });
    }

    const parsed = updateBookingTypeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "Validation failed",
        details: parsed.error.format(),
      });
    }

    const updates = parsed.data; 

    const updatePromises = updates.map((item) =>
      prisma.bookingTypeSetting.upsert({
        where: { bookingType: item.bookingType },
        update: {
          baseFare: item.baseFare,
          perKmRate: item.perKmRate,
        },
        create: {
          bookingType: item.bookingType,
          baseFare: item.baseFare,
          perKmRate: item.perKmRate,
        },
        select: { id: true, bookingType: true, baseFare: true, perKmRate: true },
      })
    );

    const updatedSettings = await prisma.$transaction(updatePromises);

    return res.json({
      success: true,
      message: "Booking type settings updated successfully",
      data: updatedSettings,
    });
  } catch (error) {
    console.error("updateBookingTypeSettings error:", error);
    return res.status(500).json({ success: false, message: "Failed to update booking type settings" });
  }
}




export const adminGetAllTransactions = async (
  req: FullRequest,
  res: Response
) => {
  const lang = req.lang || "en";

  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({
      success: false,
      message: t(lang, "auth.admin_auth_required"),
    });
  }

  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 10;
    const skip = (page - 1) * pageSize;

    const statusQuery = req.query.status as string;
    let statusFilter: MoneyTransactionStatus | undefined;
    if (statusQuery && ["PENDING", "SUCCESS", "FAILED"].includes(statusQuery)) {
      statusFilter = statusQuery as MoneyTransactionStatus;
    }

    const [transactions, totalCount] = await Promise.all([
      prisma.moneyTransaction.findMany({
        where: statusFilter ? { status: statusFilter } : {},
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: { id: true, name: true, phone: true, image: true },
          },
        },
      }),
      prisma.moneyTransaction.count({
        where: statusFilter ? { status: statusFilter } : {},
      }),
    ]);

    return res.json({
      success: true,
      data: {
        items: transactions,
        pagination: {
          page,
          pageSize,
          total: totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        },
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: t(lang, "moneyTransaction.failed_to_fetch"),
      error: err.message,
    });
  }
};

const acceptRejectTransactionSchema = (lang: string) =>
  z
    .object({
      approved: z.boolean({
        error: () => ({
          message: t(lang, "moneyTransaction.approved_required"),
        }),
      }),
      reason: z.string().optional(),
      shippingPrice: z.number().optional(),
    })
    .refine(
      (data) => {
        if (data.approved) {
          return (
            typeof data.shippingPrice === "number" && data.shippingPrice > 0
          );
        }
        return true;
      },
      {
        message: t(lang, "moneyTransaction.shipping_price_required"),
        path: ["shippingPrice"],
      }
    );

export const adminAcceptRejectTransaction = async (
  req: FullRequest,
  res: Response
) => {
  const lang = req.lang || "en";
  const { transactionId } = req.params;

  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({
      success: false,
      message: t(lang, "auth.admin_auth_required"),
    });
  }

  const transactionIdNumber = Number(transactionId);
  if (isNaN(transactionIdNumber)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid transaction ID" });
  }

  try {
    const schema = acceptRejectTransactionSchema(lang);
    const result = schema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: t(lang, "errors.validation_failed"),
        details: result.error.flatten(),
      });
    }

    const { approved, reason, shippingPrice } = result.data;

    // ✅ جلب الـ transaction مع المستخدم
    const transaction = await prisma.moneyTransaction.findUnique({
      where: { id: transactionIdNumber },
      include: { user: true },
    });

    if (!transaction || !transaction.user) {
      return res.status(404).json({
        success: false,
        message: t(lang, "moneyTransaction.transaction_not_found"),
      });
    }

    if (transaction.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: t(lang, "moneyTransaction.transaction_not_pending"),
      });
    }

    const newStatus = approved ? "SUCCESS" : "FAILED";

    // ✅ نوع الرحلات مع أجرة الراكب فقط
    type TripWithFare = {
      id: string;
      from: string;
      to: string;
      startTime: string;
      tripDates: string;
      members: { passengerFare: number }[];
    };

    const updatedTransaction = await prisma.$transaction(async (tx) => {
      const updated = await tx.moneyTransaction.update({
        where: { id: transactionIdNumber },
        data: {
          status: newStatus,
          updatedAt: new Date(),
          shippingPrice: approved ? shippingPrice! : transaction.shippingPrice,
        },
      });

      if (approved && shippingPrice) {
        // ✅ 1. زوّد رصيد المستخدم
        const updatedUser = await tx.user.update({
          where: { id: transaction.userId },
          data: { balance: { increment: shippingPrice } },
        });

        // ✅ 2. جيب كل الرحلات اللي userHasEnoughMoney = false
        const inactiveTrips: TripWithFare[] = await tx.trip.findMany({
          where: {
            creatorId: transaction.userId,
            userHasEnoughMoney: false,
            status: { in: ["OPEN", "FULL", "ASSIGNED", "STARTED"] },
          },
          orderBy: [{ tripDates: "asc" }, { startTime: "asc" }],
          select: {
            id: true,
            tripDates: true,
            startTime: true,
            from: true,
            to: true,
            members: {
              where: { userId: transaction.userId },
              select: { passengerFare: true },
            },
          },
        });

        let remainingBalance = updatedUser.balance;
        const activatedTrips: string[] = [];

        for (const trip of inactiveTrips) {
          const passengerFare = trip.members[0]?.passengerFare || 0;

          // ✅ لو الرصيد كافي لأجرة المستخدم → فعّل الرحلة
          if (remainingBalance >= passengerFare) {
            await tx.trip.update({
              where: { id: trip.id },
              data: { userHasEnoughMoney: true },
            });

            activatedTrips.push(trip.id);

            const time = new Date(trip.startTime).toLocaleTimeString("ar-EG", {
              hour: "2-digit",
              minute: "2-digit",
            });

            const notifTitle = "رحلتك اتفعلت 🚗";
            const notifBody = `تم تفعيل رحلتك من ${trip.from} إلى ${trip.to} بتاريخ ${trip.tripDates} الساعة ${time}. جاري انتظار الركاب والسائق.`;

            await sendNotificationWithDelay(
              transaction.user.id,
              notifTitle,
              notifBody
            );

            // خصم افتراضي فقط من الرصيد المقارن (مش فعلي)
            remainingBalance -= passengerFare;
          } else {
            break;
          }
        }

        // Log بسيط لتوضيح اللي اتفعل
        if (activatedTrips.length > 0) {
          console.log(
            `✅ تم تفعيل ${activatedTrips.length} رحلة للمستخدم ${transaction.user.id}`
          );
        }
      }

      return updated;
    });

    // ✅ إرسال إشعار بالموافقة أو الرفض
    const notificationTitle = approved
      ? t(lang, "moneyTransaction.approved_title")
      : t(lang, "moneyTransaction.rejected_title");

    const notificationBody = approved
      ? t(lang, "moneyTransaction.approved_body").replace(
          "${reference}",
          transaction.reference
        )
      : t(lang, "moneyTransaction.rejected_body")
          .replace("${reference}", transaction.reference)
          .replace(
            "${reason}",
            reason || t(lang, "moneyTransaction.reason_unspecified")
          );

    await sendNotificationWithDelay(
      transaction.user.id,
      notificationTitle,
      notificationBody
    );

    return res.json({
      success: true,
      message: approved
        ? t(lang, "moneyTransaction.transaction_approved")
        : t(lang, "moneyTransaction.transaction_rejected"),
      data: updatedTransaction,
    });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: t(lang, "moneyTransaction.failed_to_update"),
      error: err.message,
    });
  }
};

export const adminGetTransactionById = async (
  req: FullRequest,
  res: Response
) => {
  const lang = req.lang || "en";

  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({
      success: false,
      message: t(lang, "auth.admin_auth_required"),
    });
  }

  try {
    const transactionId = req.params.id;

    if (!transactionId) {
      return res.status(400).json({
        success: false,
        message: t(lang, "moneyTransaction.id_required"),
      });
    }

    const transaction = await prisma.moneyTransaction.findUnique({
      where: { id: Number(transactionId) },
      include: {
        user: {
          select: { id: true, name: true, phone: true, image: true },
        },
      },
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: t(lang, "moneyTransaction.not_found"),
      });
    }

    return res.json({
      success: true,
      data: transaction,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: t(lang, "moneyTransaction.failed_to_fetch"),
      error: err.message,
    });
  }
};

// ✅ Admin get all withdraw requests
export const adminGetAllWithdraws = async (req: FullRequest, res: Response) => {
  const lang = req.lang || "en";

  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({
      success: false,
      message: t(lang, "auth.admin_auth_required"),
    });
  }

  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 10;
    const skip = (page - 1) * pageSize;

    const statusQuery = req.query.status as string;
    let statusFilter: MoneyTransactionStatus | undefined;
    if (statusQuery && ["PENDING", "SUCCESS", "FAILED"].includes(statusQuery)) {
      statusFilter = statusQuery as MoneyTransactionStatus;
    }

    const [withdraws, totalCount] = await Promise.all([
      prisma.withdrawTransaction.findMany({
        where: statusFilter ? { status: statusFilter } : {},
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: { id: true, name: true, phone: true, image: true },
          },
        },
      }),
      prisma.withdrawTransaction.count({
        where: statusFilter ? { status: statusFilter } : {},
      }),
    ]);

    return res.json({
      success: true,
      data: {
        items: withdraws,
        pagination: {
          page,
          pageSize,
          total: totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        },
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: t(lang, "withdraw.failed_to_fetch"),
      error: err.message,
    });
  }
};

const acceptRejectWithdrawSchema = (lang: string) =>
  z.object({
    approved: z.boolean({
      error: () => ({ message: t(lang, "withdraw.approved_required") }),
    }),
    reason: z.string().nullable().optional(), // Allow null
    screen: z.string().nullable().optional(), // Allow null
  });

export const adminAcceptRejectWithdraw = async (
  req: FullRequest,
  res: Response
) => {
  const lang = req.lang || "en";
  const { withdrawId } = req.params;

  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({
      success: false,
      message: t(lang, "auth.admin_auth_required"),
    });
  }

  const withdrawIdNumber = Number(withdrawId);
  if (isNaN(withdrawIdNumber)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid withdraw ID" });
  }

  try {
    const schema = acceptRejectWithdrawSchema(lang);
    const result = schema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: t(lang, "errors.validation_failed"),
        details: result.error.flatten(),
      });
    }

    const { approved, reason, screen } = result.data;

    const withdraw = await prisma.withdrawTransaction.findUnique({
      where: { id: withdrawIdNumber },
      include: { user: true },
    });

    if (!withdraw || !withdraw.user) {
      return res.status(404).json({
        success: false,
        message: t(lang, "withdraw.not_found"),
      });
    }

    if (withdraw.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: t(lang, "withdraw.not_pending"),
      });
    }

    const newStatus = approved ? "SUCCESS" : "FAILED";

    const updatedWithdraw = await prisma.$transaction(async (tx) => {
      const updated = await tx.withdrawTransaction.update({
        where: { id: withdrawIdNumber },
        data: {
          status: newStatus,
          screen: screen || null, 
          updatedAt: new Date(),
        },
      });

      if (approved) {
        const user = await tx.user.findUnique({
          where: { id: withdraw.userId },
          select: { balance: true },
        });

        if (!user || user.balance < withdraw.amount) {
          throw new Error("Insufficient balance for withdrawal approval");
        }

        await tx.user.update({
          where: { id: withdraw.userId },
          data: { balance: { decrement: withdraw.amount } },
        });
      }

      return updated;
    });

    const notificationTitle = approved
      ? t(lang, "withdraw.approved_title")
      : t(lang, "withdraw.rejected_title");

    const notificationBody = approved
      ? t(lang, "withdraw.approved_body").replace(
          "${reference}",
          withdraw.reference
        )
      : t(lang, "withdraw.rejected_body")
          .replace("${reference}", withdraw.reference)
          .replace(
            "${reason}",
            reason || t(lang, "withdraw.reason_unspecified")
          );

    const notificationData = {
      type: "WITHDRAW_UPDATE",
      withdrawId: withdrawId.toString(),
      status: newStatus,
      screen: screen || null,
      reference: withdraw.reference,
    };

    await sendNotificationWithDelay(
      withdraw.user.id,
      notificationTitle,
      notificationBody
    );

    return res.json({
      success: true,
      message: approved
        ? t(lang, "withdraw.approved_successfully")
        : t(lang, "withdraw.rejected_successfully"),
      data: updatedWithdraw,
    });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: t(lang, "withdraw.failed_to_update"),
      error: err.message,
    });
  }
};

export const adminGetWithdrawById = async (req: FullRequest, res: Response) => {
  const lang = req.lang || "en";
  const { id } = req.params;

  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({
      success: false,
      message: t(lang, "auth.admin_auth_required"),
    });
  }

  const withdrawId = Number(id);
  if (isNaN(withdrawId)) {
    return res.status(400).json({
      success: false,
      message: t(lang, "withdraw.invalid_id"),
    });
  }

  try {
    const withdraw = await prisma.withdrawTransaction.findUnique({
      where: { id: withdrawId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            phone: true,
            image: true,
            balance: true,
          },
        },
      },
    });

    if (!withdraw) {
      return res.status(404).json({
        success: false,
        message: t(lang, "withdraw.not_found"),
      });
    }

    return res.json({
      success: true,
      data: withdraw,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: t(lang, "withdraw.failed_to_fetch"),
      error: err.message,
    });
  }
};

// TODO
// GET ALL TRIPS
/**
 * fILTER BY:

 */

//

// اليوم الاسبوع او الشهر
//* Day
//* Week
//* Month
// => get trips profits

export async function adminGetAllTrips(req: FullRequest, res: Response) {
  const lang = req.lang || "en";

  const filter = (req.query.filter as string)?.toLowerCase(); // day | week | month
  const page = parseInt(req.query.page as string, 10) || 1;
  const pageSize = parseInt(req.query.pageSize as string, 10) || 10;

  // Validate pagination params
  if (page < 1 || pageSize < 1) {
    return res.status(400).json({
      success: false,
      message: t(lang, "errors.invalid_pagination"),
    });
  }

  const skip = (page - 1) * pageSize;

  let whereClause: any = {};

  if (filter) {
    const now = new Date();
    let startDate: Date;

    switch (filter) {
      case "day":
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case "week":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "month":
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
    }

    whereClause = {
      createdAt: { gte: startDate, lte: now },
    };
  }

  try {
    const [trips, totalCount] = await Promise.all([
      prisma.trip.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.trip.count({ where: whereClause }),
    ]);

    const totalPages = Math.ceil(totalCount / pageSize);

    return res.json({
      success: true,
      data: {
        trips,
        pagination: {
          page,
          pageSize,
          totalCount,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      },
    });
  } catch (error) {
    console.error("adminGetAllTrips error:", error);
    return res.status(500).json({
      success: false,
      message: t(lang, "errors.server_error"),
    });
  }
}

export async function adminGetHisProfits(req: FullRequest, res: Response) {
  const lang = req.lang || "en";

  const filter = (req.query.filter as string)?.toLowerCase(); // day | week | month | custom
  const startDate = req.query.startDate as string;
  const endDate = req.query.endDate as string;

  let whereClause: any = { isPaid: true };

  try {
    if (filter === "custom" && startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      whereClause.createdAt = { gte: start, lte: end };
    } else {
      // Fixed filters (day, week, month)
      const now = new Date();
      let start: Date;

      switch (filter) {
        case "day":
          start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case "week":
          const weekStart = new Date(now);
          weekStart.setDate(now.getDate() - now.getDay());
          weekStart.setHours(0, 0, 0, 0);
          start = weekStart;
          break;
        case "month":
          start = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        default:
          start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
      }

      whereClause.createdAt = { gte: start, lte: now };
    }

    const trips = await prisma.trip.findMany({
      where: whereClause,
      select: {
        appCommission: true,
      },
    });

    const totalProfit = trips.reduce(
      (sum, trip) => (trip.appCommission as number) + sum,
      0
    );

    return res.json({
      success: true,
      data: {
        totalProfit,
        startDate: whereClause.createdAt?.gte,
        endDate: whereClause.createdAt?.lte,
      },
    });
  } catch (error) {
    console.error("Error fetching profits:", error);
    return res.status(500).json({
      success: false,
      message: t(lang, "errors.server_error"),
    });
  }
}

export async function adminUpdateUserBonus(req: FullRequest, res: Response) {
  const lang = req.lang || "ar";

  try {
    if (req.user?.role !== "ADMIN") {
      return res.status(403).json({
        error: t(lang, "auth.forbidden"),
      });
    }

    const { userBonus } = req.body;

    if (typeof userBonus !== "number") {
      return res.status(400).json({
        error: t(lang, "errors.invalid_bonus"),
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.updateMany({
        where: {
          role: "USER",
        },

        data: {
          userBonus: Number(userBonus) || 0,
        },
      });

      await tx.setting.updateMany({
        data: {
          userBonus,
        },
      });
    });

    // Update ALL users

    return res.status(200).json({
      success: true,
      data: {
        newBonus: userBonus,
      },
    });
  } catch (error) {
    console.error("Error in adminUpdateUserBonus:", error);
    return res.status(500).json({
      error: t(lang, "errors.server_error"),
    });
  }
}

export async function adminGetUserBonus(req: FullRequest, res: Response) {
  const lang = req.lang || "ar";

  try {
    if (req.user?.role !== "ADMIN") {
      return res.status(403).json({
        error: t(lang, "auth.forbidden"),
      });
    }

    const settings = await prisma.setting.findFirst({
      select: {
        userBonus: true,
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        bonus: settings!.userBonus || 0,
      },
    });
  } catch (error) {
    console.error("Error in adminGetUserBonus:", error);
    return res.status(500).json({
      error: t(lang, "errors.server_error"),
    });
  }
}

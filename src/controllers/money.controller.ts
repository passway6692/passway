import { PrismaClient, MoneyTransactionStatus } from "@prisma/client";
import { getSendMoneySchema } from "../validations/sendMoney.zod";
import { t } from "../utils/i18n";
import { sendNotificationWithDelay } from "../utils/sendNotification";
import { Response } from "express";
import { FullRequest } from "../types/request";

const prisma = new PrismaClient();

export const sendMoney = async (req: FullRequest, res: Response) => {
  const lang = req.lang || "en";

  try {
    const schema = getSendMoneySchema(lang);
    const { screen, phone, reference, status } = schema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: t(lang, "moneyTransaction.user_not_found"),
      });
    }

const transaction = await prisma.moneyTransaction.create({
  data: {
    screen,
    phone,
    reference: reference ?? "",
    status: status ?? MoneyTransactionStatus.PENDING,
    userId: user.id,
  },
});

  (async () => {
  const userTitle = t(lang, "moneyTransaction.notification_title_user");
  const userBody = t(
    lang,
    "moneyTransaction.notification_body_user"
  ).replace("${reference}", reference ?? "");

  await sendNotificationWithDelay(user.id, userTitle, userBody);

  const admins = await prisma.user.findMany({
    where: { role: "ADMIN" },
    select: { id: true },
  });

  const adminTitle = t(lang, "moneyTransaction.notification_title_admin");
  const adminBody = t(
    lang,
    "moneyTransaction.notification_body_admin"
  ).replace("${reference}", reference ?? "");

  for (const admin of admins) {
    await sendNotificationWithDelay(admin.id, adminTitle, adminBody);
  }
})();

    return res.json({
      success: true,
      message: t(lang, "moneyTransaction.transaction_created"),
      data: transaction,
    });
  } catch (err: any) {
    if (err?.issues) {
      return res.status(400).json({ success: false, errors: err.issues });
    }

    return res.status(500).json({
      success: false,
      message: t(lang, "moneyTransaction.transaction_failed"),
      error: err.message,
    });
  }
};

export const getUserTransactions = async (req: FullRequest, res: Response) => {
  const lang = req.lang || "en";
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: t(lang, "moneyTransaction.user_not_authenticated"),
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

    const whereClause = statusFilter
      ? { userId, status: statusFilter }
      : { userId };

    const [transactions, totalCount] = await Promise.all([
      prisma.moneyTransaction.findMany({
        where: whereClause,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
      prisma.moneyTransaction.count({
        where: whereClause,
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

export const getUserBalance = async (req: FullRequest, res: Response) => {
  const lang = req.lang || "en";
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: t(lang, "moneyTransaction.user_not_authenticated"),
    });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        phone: true,
        balance: true,
        userBonus: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: t(lang, "moneyTransaction.user_not_found"),
      });
    }

    return res.json({
      success: true,
      data: {
        id: user.id,
        userBonus: user.userBonus,
        balance: user.balance,
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: t(lang, "moneyTransaction.failed_to_fetch_balance"),
      error: err.message,
    });
  }
};

export const withdrawMoney = async (req: FullRequest, res: Response) => {
  const lang = req.lang || "en";
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: t(lang, "moneyTransaction.user_not_authenticated"),
    });
  }

  try {
    const { paymentMethod, receiverPhone, receiverName, amount } = req.body;

    if (!paymentMethod || typeof paymentMethod !== "string") {
      return res.status(400).json({
        success: false,
        message: t(lang, "moneyTransaction.invalid_payment_method"),
      });
    }

    if (!receiverPhone || typeof receiverPhone !== "string") {
      return res.status(400).json({
        success: false,
        message: t(lang, "moneyTransaction.invalid_receiver_phone"),
      });
    }

    if (!receiverName || typeof receiverName !== "string") {
      return res.status(400).json({
        success: false,
        message: t(lang, "moneyTransaction.invalid_receiver_name"),
      });
    }

    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: t(lang, "moneyTransaction.invalid_amount"),
      });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: t(lang, "moneyTransaction.user_not_found"),
      });
    }

    // ✅ احسب مجموع الرحلات النشطة اللي المستخدم فيها
    const activeTrips = await prisma.tripMember.findMany({
      where: {
        userId: userId,
        trip: {
          status: { in: ["OPEN", "FULL", "ASSIGNED", "STARTED"] },
        },
      },
      select: { passengerFare: true },
    });

    const activeAmount = activeTrips.reduce(
      (sum, t) => sum + t.passengerFare,
      0
    );
    const availableBalance = user.balance - activeAmount;

    // ✅ لو المستخدم داخل في رحلات بقيمة كل رصيده أو أكتر
    if (availableBalance <= 0) {
      return res.status(400).json({
        success: false,
        message: `أنت مشترك في رحلات قيمتها ${activeAmount} جنيه. لا يمكنك السحب في الوقت الحالي.`,
        data: {
          totalBalance: user.balance,
          activeTripsValue: activeAmount,
          requestedAmount: amount,
          availableToWithdraw: 0,
        },
      });
    }

    // ✅ لو المبلغ المطلوب أكتر من المتاح
    if (amount > availableBalance) {
      const msg = `رصيدك الإجمالي ${user.balance} جنيه، منهم ${activeAmount} جنيه محجوزة في رحلات نشطة. يمكنك سحب بحد أقصى ${availableBalance} جنيه فقط.`;

      return res.status(400).json({
        success: false,
        message: msg,
        data: {
          totalBalance: user.balance,
          activeTripsValue: activeAmount,
          requestedAmount: amount,
          availableToWithdraw: availableBalance,
        },
      });
    }

    // ✅ لو الرصيد الفعلي أقل (تحقق أمان إضافي)
    if (user.balance < amount) {
      return res.status(400).json({
        success: false,
        message: t(lang, "moneyTransaction.insufficient_balance"),
        data: {
          totalBalance: user.balance,
          activeTripsValue: activeAmount,
          requestedAmount: amount,
          availableToWithdraw: availableBalance,
        },
      });
    }

    // ✅ إنشاء طلب السحب
    const transaction = await prisma.withdrawTransaction.create({
      data: {
        screen: "withdraw",
        paymentMethod,
        receiverPhone,
        receiverName,
        reference: `${paymentMethod}_${Date.now()}`,
        status: MoneyTransactionStatus.PENDING,
        amount,
        userId: user.id,
      },
    });

    // ✅ إشعارات
    (async () => {
      const userTitle = t(lang, "moneyTransaction.withdraw_request_title_user");
      const userBody = t(lang, "moneyTransaction.withdraw_request_body_user")
        .replace("${amount}", amount)
        .replace("${method}", paymentMethod);

      await sendNotificationWithDelay(user.id, userTitle, userBody);

      const admins = await prisma.user.findMany({
        where: { role: "ADMIN" },
        select: { id: true },
      });

      const adminTitle = t(
        lang,
        "moneyTransaction.withdraw_request_title_admin"
      );
      const adminBody = t(lang, "moneyTransaction.withdraw_request_body_admin")
        .replace("${user}", user.name || user.phone)
        .replace("${amount}", amount)
        .replace("${method}", paymentMethod)
        .replace("${receiver}", receiverName);

      for (const admin of admins) {
        await sendNotificationWithDelay(admin.id, adminTitle, adminBody);
      }
    })();

    // ✅ الرد النهائي
    return res.json({
      success: true,
      message: t(lang, "moneyTransaction.withdraw_request_created"),
      data: {
        transaction,
        totalBalance: user.balance,
        activeTripsValue: activeAmount,
        requestedAmount: amount,
        availableToWithdraw: availableBalance,
      },
    });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: t(lang, "moneyTransaction.withdraw_failed"),
      error: err.message,
    });
  }
};

export const getWithdraws = async (req: FullRequest, res: Response) => {
  const lang = req.lang || "en";
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: t(lang, "moneyTransaction.user_not_authenticated"),
    });
  }

  try {
    // Pagination
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 10;
    const skip = (page - 1) * pageSize;

    // Filter by status (optional)
    const statusQuery = req.query.status as string;
    let statusFilter: MoneyTransactionStatus | undefined;
    if (statusQuery && ["PENDING", "SUCCESS", "FAILED"].includes(statusQuery)) {
      statusFilter = statusQuery as MoneyTransactionStatus;
    }

    // Build where clause
    const whereClause = statusFilter
      ? { userId, status: statusFilter }
      : { userId };

    // Fetch data
    const [withdraws, totalCount] = await Promise.all([
      prisma.withdrawTransaction.findMany({
        where: whereClause,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          paymentMethod: true,
          receiverPhone: true,
          receiverName: true,
          reference: true,
          status: true,
          amount: true,
          createdAt: true,
        },
      }),
      prisma.withdrawTransaction.count({
        where: whereClause,
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
    console.error(err);
    return res.status(500).json({
      success: false,
      message: t(lang, "moneyTransaction.fetch_withdraws_failed"),
      error: err.message,
    });
  }
};

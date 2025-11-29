// controllers/notification.controller.ts
import { Request, Response } from "express";
import {
  saveFcmToken,
  sendNotificationToUser,
  removeFcmToken,
} from "../services/fcmService";
import { prisma } from "../libs/prisma";
import z from "zod";
import { t } from "../utils/i18n";
import { FullRequest } from "../types/request";
import { sendNotificationWithDelay } from "../utils/sendNotification";
import { TripStatus } from "@prisma/client";
export const registerToken = async (req: Request, res: Response) => {
  const { userId, token, device } = req.body;
  if (!userId || !token)
    return res.status(400).json({ error: "userId and token required" });

  await saveFcmToken(userId, token, device);
  res.json({ success: true });
};

export const unregisterToken = async (req: Request, res: Response) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "token required" });

  await removeFcmToken(token);
  res.json({ success: true });
};

export const sendNotification = async (req: Request, res: Response) => {
  const { userId, title, body } = req.body;
  if (!userId || !title || !body)
    return res.status(400).json({ error: "Missing fields" });

  try {
    await sendNotificationToUser(userId, title, body);
    res.json({ success: true });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};


export const sendPassengerNotification = async (req: Request, res: Response) => {
  const { userId, title, body } = req.body;
  if (!userId || !title || !body)
    return res.status(400).json({ error: "Missing fields" });

  try {
    await sendNotificationWithDelay(userId, title, body);
    res.json({ success: true });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};


export const sendNotificationToAll = async (
  req: FullRequest,
  res: Response
) => {
  const lang = req.lang || "ar";

  try {
    const sendNotificationSchema = z.object({
      title: z.string().min(1, "Title is required"),
      message: z.string().min(1, "Message is required"),
      target: z.enum(["DRIVER", "USER"]),
    });

    const result = sendNotificationSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: t(lang, "errors.validation_failed"),
        details: z.flattenError(result.error),
      });
    }

    const { message, target, title } = result.data;

    const usersWithTokens = await prisma.user.findMany({
      where: { role: target, fcmTokens: { some: {} } },
      select: { id: true },
    }); 

    if (usersWithTokens.length === 0) {
      return res
        .status(404)
        .json({ message: `No ${target.toLowerCase()}s found` });
    }

    usersWithTokens.forEach((user, index) => {
      sendNotificationWithDelay(user.id, title, message, index * 500);
    });

    const responseMessage = `تم ارسال الرسائل بنجاح ل ${
      target === "USER" ? "المستخدمين" : "السائقين"
    }`;

    return res.status(200).json({
      message: responseMessage,
      count: usersWithTokens.length,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ errors: z.flattenError(error) });
    }

    console.error("Error sending notifications:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};


export async function getPublicFullTripsCount(req: Request, res: Response) {
  const lang = (req as any).lang || "ar";

  try {
    const now = new Date();

    const filters = {
      status: "FULL" as TripStatus,
      userHasEnoughMoney: true,
      startTime: { gte: now.toISOString() },
    };

    const totalCount = await prisma.trip.count({
      where: filters
    });

    return res.status(200).json({
      success: true,
      data: {
        totalCount,
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

import { Response } from "express";
import { FullRequest } from "../types/request";
import { getUpdateUserSchema } from "../validations/user.zod";
import { t } from "../utils/i18n";
import z from "zod";
import { prisma } from "../libs/prisma";

export async function updateUser(req: FullRequest, res: Response) {
  try {
    const lang = req.lang || "ar";
    const updateUserSchema = getUpdateUserSchema(lang);
    const result = updateUserSchema.safeParse(req.body);
    if (!result.success)
      return res.status(400).json({
        error: t(lang, "errors.validation_failed"),
        details: z.flattenError(result.error),
      });
    const { name, phone, image } = result.data;

    const userId = req.user?.id as string;
    if (!userId) {
      return res.status(404).json({ error: t(lang, "auth.user_notfound") });
    }

    if (phone) {
      const existingUser = await prisma.user.findUnique({
        where: { phone },
        select: { id: true },
      });
      if (existingUser && existingUser.id !== userId) {
        return res.status(409).json({
          error: t(lang, "errors.phone_exists"),
        });
      }
    }
    // Update the user
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        name,
        phone,
        image: image ?? undefined,
      },
      select: {
        id: true,
        image: true,
        name: true,
        phone: true,
        role: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: t(lang, "user.updated_success"),
      data: updatedUser,
    });
  } catch (error) {
    return res.status(500).json({
      error: t(req.lang || "ar", "errors.server_error"),
    });
  }
}

export async function getCurrentUser(req: FullRequest, res: Response) {
  try {
    const lang = req.lang || "ar";
    const userId = req.user?.id as string;
    if (!userId) {
      return res.status(404).json({ error: t(lang, "auth.user_notfound") });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        name: true,
        image: true,
      },
    });
    return res.status(200).json({
      success: true,
      message: t(lang, "user.updated_success"),
      data: user,
    });
  } catch (error) {
    return res.status(500).json({
      error: t(req.lang || "ar", "errors.server_error"),
    });
  }
}

export async function deleteAccount(req: FullRequest, res: Response) {
  try {
    const lang = req.lang || "ar";
    const userId = req.user?.id as string;
    if (!userId) {
      return res.status(404).json({ error: t(lang, "auth.user_notfound") });
    }

    await prisma.user.delete({
      where: { id: userId },
    });
    return res.status(200).json({
      success: true,
      message: t(lang, "user.deleted_success"),
    });
  } catch (error) {
    return res.status(500).json({
      error: t(req.lang || "ar", "errors.server_error"),
    });
  }
}

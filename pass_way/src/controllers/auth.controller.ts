import { Request, Response } from "express";
// import admin from "../libs/firebase";
import { prisma } from "../libs/prisma";
import { getLoginSchema, getSignupSchema } from "../validations/auth.zod";
import { parsePhoneNumberWithError } from "libphonenumber-js";
import {
  cleanupExpiredTokensOncePerDay,
  generateTokens,
} from "../utils/tokens";
import bcrypt from "bcrypt";
import z from "zod";
import { LanguageRequest } from "../middlewares/language.middleware";
import { t } from "../utils/i18n";
import { getUserForToken } from "../types/user.types";
import { sendNotificationWithDelay } from "../utils/sendNotification";
const validatePhoneNumber = (phone: string) => {
  try {
    const phoneNumber = parsePhoneNumberWithError(phone, "EG");
    if (!phoneNumber.isValid()) {
      throw new Error("Invalid phone number format");
    }
    if (phoneNumber.country !== "EG") {
      throw new Error("Phone number must be an Egyptian number");
    }
    return true;
  } catch (error: any) {
    throw new Error(error.message || "Invalid phone number");
  }
};
const SALT_ROUNDS = 10;

export const signup = async (req: LanguageRequest, res: Response) => {
  try {
    const lang = req.lang || "ar";
    const SignupSchema = getSignupSchema(lang);
    const result = SignupSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: t(lang, "errors.validation_failed"),
        details: z.flattenError(result.error),
      });
    }

    const { password, phone, name, image, role, lat, lng, location, gender } =
      result.data;
    // Validate phone number
    try {
      validatePhoneNumber(phone);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { phone },
    });

    if (existingUser) {
      return res.status(400).json({ error: t(lang, "errors.phone_exists") });
    }

    const hashedPassword = bcrypt.hashSync(password, SALT_ROUNDS);

    // Create new user
    const user = await prisma.user.create({
      data: {
        password: hashedPassword,
        phone,
        name,
        image,
        role,
        lat,
        lng,
        location,
        gender,
      },
      select: {
        id: true,
        image: true,
        name: true,
        phone: true,
        role: true,
        balance: true,
        location: true,
        gender: true,
        lat: true,
        lng: true,
        createdAt: true,
        updatedAt: true,
        car: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    const { accessToken, refreshToken, refreshTokenExpiresAt } =
      generateTokens(user);

    // Store refresh token in database
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: refreshTokenExpiresAt,
      },
    });

    res.json({
      success: true,
      message: t(lang, "auth.signup_success"),
      accessToken,
      refreshToken,
      user,
    });

    (async () => {
      try {
        const signupTitle = t(
          lang,
          "notifications.signup_success_title"
        ).replace("${name}", user.name);
        const signupBody = t(lang, "notifications.signup_success_body");

        await sendNotificationWithDelay(user.id, signupTitle, signupBody);
      } catch (error) {
        console.error("⚠️ Error preparing signup notification:", error);
      }
    })();
  } catch (error: any) {
    console.error("Signup error:", error);
    res.status(500).json({ error: "Signup failed, please try again later." });
  }
};
export const login = async (req: LanguageRequest, res: Response) => {
  try {
    const lang = req.lang || "ar";
    const LoginSchema = getLoginSchema(lang);
    const result = LoginSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: t(lang, "errors.validation_failed"),
        details: z.flattenError(result.error),
      });
    }

    const { password, phone } = result.data;
    try {
      validatePhoneNumber(phone);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }

    const user = await prisma.user.findUnique({
      where: { phone },
      select: {
        id: true,
        image: true,
        name: true,
        phone: true,
        role: true,
        balance: true,
        location: true,
        lat: true,
        lng: true,
        createdAt: true,
        updatedAt: true,
        password: true,
        gender: true,
        car: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: t(lang, "auth.user_notfound") });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ error: t(lang, "auth.invalid_login") });
    }

    const { accessToken, refreshToken, refreshTokenExpiresAt } =
      generateTokens(user);

    // Store refresh token in database
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: refreshTokenExpiresAt,
      },
    });

    res.json({
      success: true,
      accessToken,
      refreshToken,
      message: t(lang, "auth.login_success"),
      user,
    });

    (async () => {
      const loginTitle = t(lang, "notifications.login_success_title").replace(
        "${name}",
        user.name
      );
      const loginBody = t(lang, "notifications.login_success_body");

      await sendNotificationWithDelay(user.id, loginTitle, loginBody);
    })();
  } catch (error: any) {
    console.error("Login error:", error);

    res.status(500).json({ error: "Login failed" });
  }
};

export const logout = async (req: LanguageRequest, res: Response) => {
  try {
    const { refreshToken } = req.body;
    const lang = req.lang || "ar";

    if (!refreshToken) {
      return res.status(400).json({ error: "Refresh token required" });
    }

    await prisma.refreshToken.deleteMany({
      where: { token: refreshToken },
    });

    res.json({
      success: true,
      message: t(lang, "auth.loggedout_successfully"),
    });
  } catch (error: any) {
    console.error("Logout error:", error);
    res.status(500).json({ error: "Logout failed" });
  }
};

export const refresh = async (req: Request, res: Response) => {
  try {
    await cleanupExpiredTokensOncePerDay();
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: "Refresh token required" });
    }

    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: {
        user: {
          select: {
            id: true,
            image: true,
            name: true,
            phone: true,
            role: true,
            balance: true,
            location: true,
            lat: true,
            lng: true,
            createdAt: true,
            updatedAt: true,
            gender: true,
            car: {
              select: {
                id: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (
      !storedToken ||
      !storedToken.expiresAt ||
      storedToken.expiresAt < new Date()
    ) {
      return res
        .status(401)
        .json({ error: "Invalid or expired refresh token" });
    }

    try {
      await prisma.refreshToken.delete({
        where: { token: refreshToken },
      });
    } catch {
      console.warn(" Tried to delete refresh token but it was already removed");
    }

    const user = await getUserForToken(storedToken.userId);
    if (!user) {
      return res
        .status(404)
        .json({ error: "User not found for refresh token" });
    }

    const {
      accessToken,
      refreshToken: newRefreshToken,
      refreshTokenExpiresAt,
    } = generateTokens(user);

    if (!newRefreshToken || !refreshTokenExpiresAt) {
      console.error("generateTokens returned invalid data:", {
        accessToken,
        newRefreshToken,
        refreshTokenExpiresAt,
      });
      return res.status(500).json({ error: "Token generation failed" });
    }

    await prisma.refreshToken.create({
      data: {
        token: newRefreshToken,
        userId: storedToken.userId,
        expiresAt: refreshTokenExpiresAt,
      },
    });

    res.json({ success: true, accessToken, refreshToken: newRefreshToken });
  } catch (error: any) {
    console.error("Refresh token error:", error);
    res.status(500).json({ error: "Token refresh failed" });
  }
};

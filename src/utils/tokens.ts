import { randomBytes } from "crypto";
import jwt from "jsonwebtoken";
import { config } from "../libs/env";
import { UserToken } from "../types/user.types";
import { prisma } from "../libs/prisma";
import NodeCache from "node-cache";
export function generateTokens(user: UserToken) {
  const accessToken = jwt.sign(user, config.JWT_SECRET, {
    expiresIn: "1h",
  });

  const refreshToken = randomBytes(32).toString("hex");

  const refreshTokenExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90days

  return { accessToken, refreshToken, refreshTokenExpiresAt };
}

// الكاش لتتبع آخر وقت تم فيه التنظيف
const cleanupCache = new NodeCache({ stdTTL: 86400 }); // يوم كامل = 24 ساعة

export async function cleanupExpiredTokensOncePerDay() {
  const lastCleanup = cleanupCache.get("lastCleanup");

  if (!lastCleanup) {
    console.log("🧹 Running daily cleanup for expired refresh tokens...");
    await prisma.refreshToken.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });

    cleanupCache.set("lastCleanup", new Date().toISOString());
    console.log("✅ Cleanup done successfully");
  } else {
    // console.log("⏩ Cleanup already done today, skipping...");
  }
}

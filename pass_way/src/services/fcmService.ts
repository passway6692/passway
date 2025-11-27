// src/services/fcmService.ts
import admin from "../libs/firebase";
import { prisma } from "../libs/prisma";
import { Role } from "@prisma/client";

const defaultImageUrl = "https://res.cloudinary.com/dmx1xwl2j/image/upload/v1764041999/send_cmq9y8.jpg";
const defaultSoundAndroid = "sound"; // ملف في android/app/src/main/res/raw/ring.mp3
const defaultSoundIOS = "sound.caf"; // ملف في iOS project

export async function saveFcmToken(userId: string, token: string, device?: string) {
  return await prisma.fcmToken.upsert({
    where: { token },
    update: { userId, device, updatedAt: new Date() },
    create: { userId, token, device },
  });
}

export async function removeFcmToken(token: string) {
  return await prisma.fcmToken.deleteMany({ where: { token } });
}

export async function getTokensByUser(userId: string) {
  const tokens = await prisma.fcmToken.findMany({ where: { userId } });
  return tokens.map(t => t.token);
}

export async function getTokensByRole(role: Role) {
  const users = await prisma.user.findMany({
    where: { role },
    include: { fcmTokens: { select: { token: true } } },
  });
  return users.flatMap(user => user.fcmTokens.map(t => t.token));
}

export async function sendNotificationToUser(
  userId: string,
  title: string,
  body: string,
  data: Record<string, string> = {},
  imageUrl: string = defaultImageUrl
) {
  const tokens = await getTokensByUser(userId);
  if (!tokens.length) return console.log("⚠️ No tokens for user:", userId);

  const message: any = {
    notification: { title, body },
    data,
    tokens,
    android: {
      notification: {
        sound: defaultSoundAndroid,
        imageUrl,
      },
    },
    apns: {
      payload: {
        aps: {
          sound: defaultSoundIOS,
          "mutable-content": 1,
        },
      },
      fcm_options: { image: imageUrl },
    },
  };

  const response = await admin.messaging().sendEachForMulticast(message);
  console.log(`✅ Notifications sent to user ${userId}: ${response.successCount}`);
}

export async function sendNotificationToRole(
  role: Role,
  title: string,
  body: string,
  imageUrl: string = defaultImageUrl
) {
  const tokens = await getTokensByRole(role);
  if (!tokens.length) return console.log(`⚠️ No tokens for role: ${role}`);

  const message: any = {
    notification: { title, body },
    tokens,
    android: { notification: { sound: defaultSoundAndroid, imageUrl } },
    apns: { fcm_options: { image: imageUrl } },
  };

  const response = await admin.messaging().sendEachForMulticast(message);
  console.log(`✅ Notifications sent to role ${role}: ${response.successCount}`);
}


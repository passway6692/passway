import admin from "../libs/firebase";
import { prisma } from "../libs/prisma";
import { Role } from "@prisma/client";

export async function saveFcmToken(
  userId: string,
  token: string,
  device?: string
) {
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
  return tokens.map((t) => t.token);
}

export async function getTokensByRole(role: Role) {
  const users = await prisma.user.findMany({
    where: { role },
    include: {
      fcmTokens: {
        select: { token: true },
      },
    },
  });

  return users.flatMap((user) => user.fcmTokens.map((t) => t.token));
}

export async function sendNotificationToUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>
) {
  const tokens = await getTokensByUser(userId);
  if (tokens.length === 0)
    return console.log("⚠️ No tokens found for user:", userId);

  const multicastMessage = {
    notification: { title, body },
    android: {
      notification: {
        sound: "ring", 
      },
    },
    apns: {
      payload: {
        aps: {
          sound: "ring.caf"
        },
      },
    },
    data: data || {},
    tokens,
  };

  const response = await admin.messaging().sendEachForMulticast(multicastMessage);
  console.log(`✅ Notifications sent to user ${userId}: ${response.successCount}`);
}


export async function sendNotificationToRole(
  role: Role,
  title: string,
  body: string
) {
  const tokens = await getTokensByRole(role);
  if (tokens.length === 0) return console.log(`⚠️ No tokens for role: ${role}`);

  const multicastMessage = { notification: { title, body }, tokens };
  const response = await admin
    .messaging()
    .sendEachForMulticast(multicastMessage);

  console.log(
    `✅ Notifications sent to role ${role}: ${response.successCount}`
  );
}

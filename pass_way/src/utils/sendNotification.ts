import { sendNotificationToUser } from "../services/fcmService";

const defaultImageUrl = "https://res.cloudinary.com/dmx1xwl2j/image/upload/v1764041999/send_cmq9y8.jpg";

export async function sendNotificationWithDelay(
  userId: string,
  title: string,
  body: string,
  delay: number = 2000,
  data: Record<string, string> = {},
  imageUrl: string = defaultImageUrl
) {
  setTimeout(async () => {
    try {
      await sendNotificationToUser(userId, title, body, data, imageUrl);
      console.log(`✅ Notification sent to user ${userId}: ${title}`);
    } catch (e) {
      console.error("❌ Failed to send notification:", e);
    }
  }, delay);
}
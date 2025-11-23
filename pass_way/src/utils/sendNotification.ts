import { sendNotificationToUser } from "../services/fcmService";

export async function sendNotificationWithDelay(
  userId: string,
  title: string,
  body: string,

  delay: number = 2000,
  data: Record<string, string> = {}
): Promise<void> {
  try {
    setTimeout(async () => {
      try {
        await sendNotificationToUser(userId, title, body, data);
        console.log(`✅ Notification sent to user ${userId}: ${title}`);
      } catch (notifyError) {
        console.error("❌ Failed to send notification:", notifyError);
      }
    }, delay);
  } catch (error) {
    console.error("⚠️ Error preparing notification:", error);
  }
}

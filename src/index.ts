import express from "express";
import dotenv from "dotenv";
import helmet from "helmet";
import cors from "cors";
import authRoutes from "./routes/auth.route";
import carRoutes from "./routes/car.route";
import tripRoute from "./routes/trip.user.route";
import rateLimit from "express-rate-limit";
import cron from "node-cron";
import { languageMiddleware } from "./middlewares/language.middleware";
import adminRoute from "./routes/admin.route";
import {
  requiredAdmin,
  requiredDriver,
  requiredUser,
  requiredUserOrDriver,
} from "./middlewares/auth.middleware";
import driverTripRoutes from "./routes/trip.driver.route";
import notificationRoutes from "./routes/notification.route";
import userRoute from "./routes/user.route";
import moneyRoute from "./routes/money.routes";
import reviewsRoute from "./routes/reviews.route";
import { cancelTrips } from "./cron/cancelTrips";
import { checkPendingTripPayments } from "./cron/checkPendingTrips";
import { deletedCancelledTrips } from "./cron/deleteCancelledTrips";
import tripLocationRoutes from "./routes/trip.location.route";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.set("trust proxy", 1);
app.use(express.json());
app.use(helmet());

app.use(cors());
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
});

cron.schedule("0 1 * * *", cancelTrips); // 1:00 AM
cron.schedule("*/10 * * * *", async () => {
  console.log("Running pending trip payment check...");
  try {
    await checkPendingTripPayments();
  } catch (error) {
    console.error("Cron job failed:", error);
  }
});

// (async () => {
//   await prisma.trip.deleteMany();
// })();

cron.schedule("0 0 * * *", deletedCancelledTrips);

app.use(limiter);
app.use(languageMiddleware);
app.use("/auth", authRoutes);
app.use("/cars", requiredUser, requiredDriver, carRoutes);
app.use("/dashboard", requiredUser, requiredAdmin, adminRoute);

app.use("/user/trips", requiredUser, tripRoute);
app.use("/driver/trips", requiredUser, requiredDriver, driverTripRoutes);
app.use("/trips", requiredUser, requiredUserOrDriver, tripLocationRoutes);
app.use("/user", requiredUser, userRoute);
app.use("/notifications", notificationRoutes);
app.use("/money", requiredUser, requiredUserOrDriver, moneyRoute);
app.use("/reviews", requiredUser, requiredUserOrDriver, reviewsRoute);
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});

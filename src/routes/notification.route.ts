// routes/notification.routes.ts
import express from "express";
import {
  registerToken,
  unregisterToken,
  sendNotification,
  sendNotificationToAll,
  sendPassengerNotification,
  getPublicFullTripsCount
} from "../controllers/notification.controller";
import { requiredAdmin, requiredUser } from "../middlewares/auth.middleware";
import { r } from "@upstash/redis/zmscore-Cq_Bzgy4";

const router = express.Router();

router.post("/register", registerToken);
router.post("/unregister", unregisterToken);
router.post("/send", sendNotification);
router.post("/sendPassenger", sendPassengerNotification);
router.get("/publicFullTripsCount", getPublicFullTripsCount);
router.post("/send-all-users", requiredUser, requiredAdmin, (req, res) => {
  req.body.target = "USER";
  sendNotificationToAll(req, res);
});


router.post("/send-all-drivers", requiredUser, requiredAdmin, (req, res) => {
  req.body.target = "DRIVER";
  sendNotificationToAll(req, res);
});

export default router;

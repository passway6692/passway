// routes/notification.routes.ts
import express from "express";
import {
  registerToken,
  unregisterToken,
  sendNotification,
  sendNotificationToAll,
  sendPassengerNotification
} from "../controllers/notification.controller";
import { requiredAdmin, requiredUser } from "../middlewares/auth.middleware";

const router = express.Router();

router.post("/register", registerToken);
router.post("/unregister", unregisterToken);
router.post("/send", sendNotification);
router.post("/sendPassenger", sendPassengerNotification);

router.post("/send-all-users", requiredUser, requiredAdmin, (req, res) => {
  req.body.target = "USER";
  sendNotificationToAll(req, res);
});


router.post("/send-all-drivers", requiredUser, requiredAdmin, (req, res) => {
  req.body.target = "DRIVER";
  sendNotificationToAll(req, res);
});

export default router;

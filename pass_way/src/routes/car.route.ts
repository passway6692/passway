import express from "express";
import rateLimit from "express-rate-limit";
import {
  addCar,
  getLoggedCar,
  updateCar,
  getLoggedCarStatus,
} from "../controllers/car.controller";

const router = express.Router();

const carLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 m
  max: 10,
});

router.post(
  "/",
  carLimiter,

  addCar
);
router.patch(
  "/:id",

  carLimiter,
  updateCar
);
router.get("/getLoggedCar", getLoggedCar);
router.get("/getLoggedCarStatus", getLoggedCarStatus);

export default router;

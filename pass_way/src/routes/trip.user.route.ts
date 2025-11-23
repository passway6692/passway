import { Router } from "express";
import {
  getTodayTrips,
  getTripDetails,
  getTripFare,
  getUserTrips,
  joinTrip,
  leaveTrip,
  requestTrip,
} from "../controllers/trip.user.controller";

const router = Router();

// POST /user/trips/request?page=1&pageSize=10
router.post("/request", requestTrip);

// POST /user/trips/join
router.post("/join", joinTrip);

// POST /user/trips/tripFare
router.post("/tripFare", getTripFare);

// GET /user/trip/getUserTrips/6fa0712e-7d2b-497f-9d94-cebbbfd07907?page=1&pageSize=10&status=OPEN
router.get("/getUserTrips/:userId", getUserTrips);

// GET /user/trip/getTripDetails:6fa0712e-7d2b-497f-9d94-cebbbfd07907
router.get("/getTripDetails/:tripId", getTripDetails);

// GET /user/trip/getTodayTrips
router.get("/getTodayTrips", getTodayTrips);

// PATCH /user/trip/leaveTrip
router.patch("/leaveTrip", leaveTrip);

export default router;

import { Router } from "express";
import {
  driverGetNearbyTrips,
  driverJoinsATrip,
  driverStartTrip,
  updateDriverLocation,
  driverEndTrip,
  getDriverLocation,
  driverLeaveTrip,
  getFullTrips
} from "../controllers/trip.driver.controller";
import { requiredUser, requiredDriver,requiredUserOrDriver } from "../middlewares/auth.middleware";

const router = Router();

router.get("/nearbyTrips", requiredUser, requiredDriver, driverGetNearbyTrips);
router.get("/getFullTrips", requiredUser, requiredDriver, getFullTrips);
router.patch("/:tripId/join", requiredUser, requiredDriver, driverJoinsATrip);

router.post("/:tripId/start", requiredUser, requiredDriver, driverStartTrip);
router.patch("/:tripId/driver/location", requiredDriver, updateDriverLocation);


router.get("/:tripId/driver/location", requiredUserOrDriver, getDriverLocation);
router.post("/:tripId/end", requiredUser, requiredDriver, driverEndTrip);

router.patch("/leaveTrip", driverLeaveTrip);
export default router;

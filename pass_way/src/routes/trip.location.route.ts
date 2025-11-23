import { Router } from "express";
import {   updateDriverLocation,
  getDriverLocation,
  updatePassengerLocation,
  getPassengersLocations,
  updatePassengerStatus,
  getPassengerStatuses
 } from "../controllers/trip.location.controller";
import { requiredDriver, requiredUserOrDriver } from "../middlewares/auth.middleware";

const router = Router();

router.patch('/:tripId/driver/location', updateDriverLocation);
router.get('/:tripId/driver/location', getDriverLocation);
router.patch('/:tripId/passenger/location', updatePassengerLocation);
router.get('/:tripId/passengers/locations', getPassengersLocations);

router.patch('/:tripId/passenger/status', requiredDriver, updatePassengerStatus);
router.get('/:tripId/passengers/statuses', requiredDriver, getPassengerStatuses);


export default router;
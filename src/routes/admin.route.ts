import { Router } from "express";
import {
  getAllCars,
  AcceptOrRejectCar,
  getAllUsers,
  getDashboardCounts,
  adminGetCarDetailsById,
  getSetting,
  updateSetting,
  adminGetAllTransactions,
  adminAcceptRejectTransaction,
  adminGetTransactionById,
  adminGetAllWithdraws,
  adminAcceptRejectWithdraw,
  adminGetWithdrawById,
  adminGetAllTrips,
  adminGetHisProfits,
  adminUpdateUserBonus,
  adminGetUserBonus,
  getBookingTypeSettings,
  updateBookingTypeSettings,
} from "../controllers/admin.controller";

const router = Router();

router.get("/getAllCars", getAllCars);

router.get("/getDashboardCounts", getDashboardCounts);

router.get("/adminGetCarDetailsById/:carId", adminGetCarDetailsById);
router.get("/adminGetAllTrips", adminGetAllTrips);

router.get("/adminGetHisProfits", adminGetHisProfits);

router.patch("/acceptOrRejectCar/:carId", AcceptOrRejectCar);

router.get("/setting", getSetting);
router.put("/setting", updateSetting);

router.get("/transactions", adminGetAllTransactions);
router.get("/getAllUsers", getAllUsers);
router.patch("/transactions/:transactionId", adminAcceptRejectTransaction);
router.get("/transactions/:id", adminGetTransactionById);

router.get("/withdraws", adminGetAllWithdraws);
router.get("/withdraws/:id", adminGetWithdrawById);
router.patch("/withdraws/:withdrawId", adminAcceptRejectWithdraw);

router.patch("/update-bonus", adminUpdateUserBonus);
router.get("/get-bonus", adminGetUserBonus);

router.get("/booking-settings", getBookingTypeSettings);

router.patch("/booking-settings", updateBookingTypeSettings);


export default router;

import { Router } from "express";
import { addReview, getTripReviews, getUserReviews } from "../controllers/reviews.controller";
const router = Router();

router.post("/add", addReview);
router.get("/trips/:tripId", getTripReviews);
router.get("/users/:userId", getUserReviews);

export default router;

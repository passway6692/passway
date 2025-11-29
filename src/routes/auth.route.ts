import express from "express";
import {
  login,
  logout,
  refresh,

  signup,

} from "../controllers/auth.controller";
import { requiredUser } from "../middlewares/auth.middleware";

const router = express.Router();

router.post("/signup", signup);
router.post("/login", login);
router.post("/logout", requiredUser, logout);
router.post("/refresh", refresh);

export default router;

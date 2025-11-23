import { Router } from "express";
import {
  deleteAccount,
  getCurrentUser,
  updateUser,
} from "../controllers/user.controller";

const route = Router();

// PATCH : user/updateUser
route.patch("/updateUser", updateUser);

// GET : user/getCurrentUser
route.get("/getCurrentUser", getCurrentUser);
// DELETE:  user/delete
route.delete("/delete", deleteAccount);

export default route;

import { Request } from "express";
import { UserToken } from "./user.types";

export interface FullRequest extends Request {
  user?: UserToken;
  // user?: {
  //   userId: string;
  //   phone: string;
  //   role: string;
  // };
  lang?: string;
}

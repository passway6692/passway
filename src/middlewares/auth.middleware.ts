import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../libs/env";

// Extend Request interface to include user property
export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    phone: string;
    role: string;
  };
}

export const requiredUser = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  jwt.verify(token, config.JWT_SECRET, (err, decoded) => {
    if (err) {
      console.error("JWT Verify Error:", err.message);
      return res.status(403).json({ error: "Invalid or expired token" });
    }

    req.user = decoded as AuthenticatedRequest["user"];
    next();
  });
};

export const requiredDriver = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user || req.user.role !== "DRIVER") {
    return res.status(403).json({ error: "Access restricted to drivers only" });
  }
  next();
};

export const requiredAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user || req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Access restricted to admins only" });
  }
  next();
};


export const requiredUserOrDriver = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.user.role !== "USER" && req.user.role !== "DRIVER") {
    return res.status(403).json({ error: "Access restricted to users or drivers only" });
  }

  next();
};
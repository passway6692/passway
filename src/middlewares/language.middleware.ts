import { NextFunction, Request, Response } from "express";

export interface LanguageRequest extends Request {
  lang?: string;
}

export function languageMiddleware(
  req: LanguageRequest,
  res: Response,
  next: NextFunction
) {
  req.lang = req.headers["accept-language"]?.includes("ar") ? "ar" : "en";
  next();
}

import z from "zod";
import { t } from "../utils/i18n";

export const getSendMoneySchema = (lang: string) =>
  z.object({
    screen: z
      .string()
      .optional() 
      .or(z.literal("").transform(() => undefined)),
    phone: z
      .string({ error: t(lang, "moneyTransaction.phone_required") })
      .min(11, t(lang, "moneyTransaction.phone_required"))
      .max(15, t(lang, "moneyTransaction.phone_required")),
    reference: z
      .string()
      .optional() // Make reference optional
      .or(z.literal("").transform(() => undefined)),
    status: z
      .enum(["PENDING", "SUCCESS", "FAILED"] as const, {
        message: t(lang, "moneyTransaction.status_invalid"),
      })
      .default("PENDING"),
  });
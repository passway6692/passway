import z from "zod";
import { t } from "../utils/i18n";

export function getUpdateUserSchema(lang: string) {
  return z.object({
    phone: z
      .string({ error: t(lang, "zod.phone_required") })
      .min(11, t(lang, "zod.phone_required")),
    name: z
      .string({ error: t(lang, "zod.name_required") })
      .min(1, t(lang, "zod.name_required"))
      .max(100, t(lang, "zod.name_max")),
    image: z.url(t(lang, "zod.image_url")).optional(),
  });
}

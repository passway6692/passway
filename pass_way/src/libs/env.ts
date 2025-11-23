import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.url({ message: "DATABASE_URL must be a valid URL" }),
  PORT: z
    .string()
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val > 0 && val <= 65535, {
      message: "PORT must be a valid positive number between 1 and 65535",
    }),

  JWT_SECRET: z.string().min(32, {
    message: "JWT_SECRET must be at least 32 characters long for security",
  }),
  GOOGLE_MAPS_API_KEY: z.string().min(5, {
    message: "GOOGLE_MAPS_API_KEY is required",
  }),
});

const env = envSchema.safeParse(process.env);

// Handle validation errors
if (!env.success) {
  console.error(" Invalid environment variables:", env.error.format());
  process.exit(1);
}

export const config = env.data;

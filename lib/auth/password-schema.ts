import { z } from "zod";

/** Same rules as registration: 8+ characters, at most 72 bytes (bcrypt limit). */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .refine((p) => Buffer.byteLength(p, "utf8") <= 72, "Password is too long (72 characters max)");

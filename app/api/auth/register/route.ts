import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { sendVerificationEmail } from "@/lib/auth/email-tokens";
import { clientIp, LIMITS, sharedRateLimit } from "@/lib/security/shared-rate-limit";

const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Name is too long"),
  email: z.string().trim().toLowerCase().email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    // bcrypt only uses the first 72 bytes; hashPassword refuses longer input.
    .refine((p) => Buffer.byteLength(p, "utf8") <= 72, "Password is too long (72 characters max)"),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export async function POST(req: NextRequest) {
  try {
    const limit = await sharedRateLimit("register-ip", clientIp(req.headers), LIMITS.registerPerIp);
    if (!limit.success) {
      return NextResponse.json(
        { error: "Too many accounts created from this network. Please try again later." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? "Invalid input";
      return NextResponse.json(
        { error: firstError },
        { status: 400 }
      );
    }

    const { name, email, password } = parsed.data;

    // Check for existing user.
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Generic response to avoid account enumeration.
      return NextResponse.json(
        { error: "Registration failed. Please try a different email." },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name,
          email,
          passwordHash,
          role: "CUSTOMER",
        },
      });

      const customerProfile = await tx.customerProfile.create({
        data: { userId: user.id },
      });

      return { user, customerProfile };
    });

    // Optional email confirmation (decision 2026-11-15): never blocks sign-up.
    await sendVerificationEmail(result.user.id).catch(() => {});

    return NextResponse.json(
      {
        ok: true,
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          role: result.user.role,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    logger.error("Registration failed", {
      error: err instanceof Error ? err.message : String(err),
    });

    // Two sign-ups racing on the same email: Prisma unique violation (P2002).
    if ((err as { code?: string } | null)?.code === "P2002") {
      return NextResponse.json(
        { error: "Registration failed. Please try a different email." },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
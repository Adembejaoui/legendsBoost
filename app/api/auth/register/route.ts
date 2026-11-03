import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";

const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Name is too long"),
  email: z.string().trim().toLowerCase().email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password is too long"),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
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

    if (err instanceof Error && err.message.includes("unique constraint")) {
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
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/guards";
import { adminChangeBoosterStatus, boosterErrorResponse } from "@/lib/boosters/admin.service";

type RouteContext = { params: Promise<{ userId: string }> };

const STATUSES = ["PENDING", "UNDER_REVIEW", "NEEDS_INFO", "REJECTED", "TRIAL", "APPROVED", "ON_BREAK", "SUSPENDED", "TERMINATED"] as const;

const bodySchema = z
  .object({
    to: z.enum(STATUSES),
    note: z.string().trim().max(1000).optional(),
    /** The status the admin saw (refuses if it changed meanwhile). */
    expectedFrom: z.enum(STATUSES).optional(),
  })
  .strict();

/**
 * Admin: any legal booster status change (see lib/boosters/transitions.ts):
 * start review, request info, approve to trial/active, end trial, suspend,
 * reinstate, terminate. Illegal moves are refused.
 */
export async function POST(req: Request, { params }: RouteContext) {
  const admin = await getSessionUser();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (admin.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  try {
    const { userId } = await params;
    const profile = await adminChangeBoosterStatus(admin.id, userId, parsed.data.to, parsed.data.note, parsed.data.expectedFrom);
    return NextResponse.json({ ok: true, verificationStatus: profile.verificationStatus });
  } catch (e) {
    return boosterErrorResponse(e);
  }
}

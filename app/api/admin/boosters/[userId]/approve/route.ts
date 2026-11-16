import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/guards";
import { adminChangeBoosterStatus, boosterErrorResponse } from "@/lib/boosters/admin.service";
import type { BoosterStatus } from "@/lib/boosters/status";

type RouteContext = { params: Promise<{ userId: string }> };

const bodySchema = z.object({ to: z.enum(["TRIAL", "APPROVED"]).default("TRIAL") }).strict();

/**
 * Admin: approve an application. Default: TRIAL (config booster_trial_orders
 * orders, then an admin promotes to active); `{ "to": "APPROVED" }` skips the
 * trial. Gives the BOOSTER role and default rank ceilings (peak rank).
 */
export async function POST(req: Request, { params }: RouteContext) {
  const admin = await getSessionUser();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (admin.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  try {
    const { userId } = await params;
    const profile = await adminChangeBoosterStatus(admin.id, userId, parsed.data.to as BoosterStatus);
    return NextResponse.json({
      ok: true,
      boosterProfile: { id: profile.id, verificationStatus: profile.verificationStatus, approvedAt: profile.approvedAt, reviewedAt: profile.reviewedAt },
    });
  } catch (e) {
    return boosterErrorResponse(e);
  }
}

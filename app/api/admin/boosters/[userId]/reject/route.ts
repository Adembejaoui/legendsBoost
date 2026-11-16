import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/guards";
import { adminChangeBoosterStatus, boosterErrorResponse } from "@/lib/boosters/admin.service";

type RouteContext = { params: Promise<{ userId: string }> };

const rejectSchema = z.object({
  reason: z.string().trim().min(1, "A rejection reason is required").max(1000),
});

/** Admin: reject an application (reason shown to the applicant). */
export async function POST(req: Request, { params }: RouteContext) {
  const admin = await getSessionUser();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (admin.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = rejectSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  try {
    const { userId } = await params;
    const profile = await adminChangeBoosterStatus(admin.id, userId, "REJECTED", parsed.data.reason);
    return NextResponse.json({
      ok: true,
      boosterProfile: { id: profile.id, verificationStatus: profile.verificationStatus, rejectionReason: profile.rejectionReason, reviewedAt: profile.reviewedAt },
    });
  } catch (e) {
    return boosterErrorResponse(e);
  }
}

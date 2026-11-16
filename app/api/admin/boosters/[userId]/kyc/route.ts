import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/guards";
import { adminSetKyc, boosterErrorResponse } from "@/lib/boosters/admin.service";

type RouteContext = { params: Promise<{ userId: string }> };

const bodySchema = z.object({ status: z.enum(["VERIFIED", "REJECTED", "NOT_STARTED"]) }).strict();

/** Admin: record the identity-verification outcome (mock KYC). Audited. */
export async function POST(req: Request, { params }: RouteContext) {
  const admin = await getSessionUser();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (admin.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  try {
    const { userId } = await params;
    const profile = await adminSetKyc(admin.id, userId, parsed.data.status);
    return NextResponse.json({ kycStatus: profile.kycStatus });
  } catch (e) {
    return boosterErrorResponse(e);
  }
}

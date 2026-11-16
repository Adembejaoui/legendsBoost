import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { boosterErrorResponse, startKyc } from "@/lib/boosters/admin.service";

/** Booster: start identity verification (mock provider: an admin records the result). */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "BOOSTER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const profile = await startKyc(user.id);
    return NextResponse.json({ kycStatus: profile.kycStatus });
  } catch (e) {
    return boosterErrorResponse(e);
  }
}

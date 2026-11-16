import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { adminRemovePermission, adminSetPermission, boosterErrorResponse } from "@/lib/boosters/admin.service";

type RouteContext = { params: Promise<{ userId: string }> };

async function admin() {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (user.role !== "ADMIN") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { user };
}

/**
 * Admin: set a booster's permission for one game:
 * { gameSlug, maxTargetRank: { tierId, divisionId }, regions?, serviceSlugs? }.
 * May raise or lower the rank ceiling (a booster can only lower it).
 */
export async function PUT(req: Request, { params }: RouteContext) {
  const a = await admin();
  if ("error" in a) return a.error;
  try {
    const { userId } = await params;
    const permission = await adminSetPermission(a.user.id, userId, await req.json().catch(() => null));
    return NextResponse.json({ permission });
  } catch (e) {
    return boosterErrorResponse(e);
  }
}

/** Admin: remove a game permission (?gameSlug=...). */
export async function DELETE(req: Request, { params }: RouteContext) {
  const a = await admin();
  if ("error" in a) return a.error;
  const gameSlug = new URL(req.url).searchParams.get("gameSlug");
  if (!gameSlug) return NextResponse.json({ error: "gameSlug is required" }, { status: 400 });
  try {
    const { userId } = await params;
    await adminRemovePermission(a.user.id, userId, gameSlug);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return boosterErrorResponse(e);
  }
}

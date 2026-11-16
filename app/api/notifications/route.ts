import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { getNotifications, getUnreadCount } from "@/lib/notifications/service";

export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const unreadOnly = searchParams.get("unreadOnly") === "true";

    const [notificationsResult, unreadCount] = await Promise.all([
      getNotifications(user.id, { page, limit, unreadOnly }),
      getUnreadCount(user.id),
    ]);

    return NextResponse.json({
      notifications: notificationsResult.notifications,
      total: notificationsResult.total,
      unreadCount,
      page,
      limit,
    });
  } catch (err) {
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
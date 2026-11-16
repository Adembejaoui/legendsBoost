import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { markAllAsRead } from "@/lib/notifications/service";

export async function POST() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await markAllAsRead(user.id);

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
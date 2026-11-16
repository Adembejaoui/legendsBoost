import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { markAsRead } from "@/lib/notifications/service";
import prisma from "@/lib/prisma";

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const notification = await prisma.notification.findUnique({
      where: { id },
      select: { userId: true, read: true, orderId: true },
    });

    if (!notification || notification.userId !== user.id) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    }

    if (notification.read) {
      return NextResponse.json({ notification });
    }

    await markAsRead(id, user.id);

    return NextResponse.json({ success: true, orderId: notification.orderId });
  } catch (err) {
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { getSupportTicket, addSupportMessage, updateSupportTicketStatus, assignSupportTicket } from "@/lib/support/service";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { ticketId } = await params;

    const ticket = await getSupportTicket(ticketId, user.id, user.role ?? "CUSTOMER");
    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    return NextResponse.json({ ticket });
  } catch (err) {
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { ticketId } = await params;
    const body = await req.json();
    const { status, assign } = body;

    if (assign === true) {
      const ticket = await assignSupportTicket(ticketId, user.id);
      return NextResponse.json({ ticket });
    }

    if (status) {
      const validStatuses = ["OPEN", "IN_PROGRESS", "WAITING_FOR_CUSTOMER", "RESOLVED", "CLOSED"];
      if (!validStatuses.includes(status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }

      try {
        await updateSupportTicketStatus(ticketId, status as any, user.id);
        return NextResponse.json({ success: true });
      } catch (err: any) {
        if (err.message?.includes("Invalid ticket status transition")) {
          return NextResponse.json({ error: err.message }, { status: 400 });
        }
        throw err;
      }
    }

    return NextResponse.json({ error: "No action specified" }, { status: 400 });
  } catch (err: any) {
    if (err.message === "Ticket not found") {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err.message?.includes("Only admins can be assigned")) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
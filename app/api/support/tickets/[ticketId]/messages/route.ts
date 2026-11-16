import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { getSupportTicket, addSupportMessage } from "@/lib/support/service";
import { checkRateLimit, SUPPORT_MESSAGE_RATE_LIMIT } from "@/lib/security/sanitize";

export async function POST(
  req: NextRequest,
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

    const isAdmin = user.role === "ADMIN";
    const isCustomer = ticket.customerId === user.id;

    if (!isAdmin && !isCustomer) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Rate limiting for support messages
    const rateLimit = checkRateLimit(user.id, SUPPORT_MESSAGE_RATE_LIMIT);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: `Rate limit exceeded. Try again after ${new Date(rateLimit.resetAt).toLocaleTimeString()}` },
        { status: 429, headers: { "Retry-After": Math.ceil((rateLimit.resetAt - Date.now()) / 1000).toString() } }
      );
    }

    const body = await req.json();
    const content = body.content?.trim();

    if (!content) {
      return NextResponse.json({ error: "Message cannot be empty" }, { status: 400 });
    }

    if (content.length > 5000) {
      return NextResponse.json({ error: "Message too long (max 5000 characters)" }, { status: 400 });
    }

    const message = await addSupportMessage(ticketId, user.id, content, isAdmin);

    return NextResponse.json({ message }, { status: 201 });
  } catch (err: any) {
    if (err.message === "Message cannot be empty") {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err.message === "Message too long (max 5000 characters)") {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err.message?.includes("Rate limit exceeded")) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
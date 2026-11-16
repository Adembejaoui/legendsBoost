import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import {
  getSupportTickets,
  createSupportTicket,
  isSupportTicketCategory,
  isSupportTicketPriority,
  isSupportTicketStatus,
} from "@/lib/support/service";
import { z } from "zod";

const ticketInputSchema = z.object({
  orderId: z.string().trim().min(1).max(64).optional().nullable().transform((v) => v || undefined),
  subject: z.string().trim().min(3, "Subject is too short").max(200, "Subject is too long (200 characters max)"),
  description: z.string().trim().min(10, "Please describe the issue (10 characters min)").max(5000, "Description is too long (5000 characters max)"),
  category: z.string().min(1, "Choose a category"),
  priority: z.string().optional().nullable(),
});

export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const status = searchParams.get("status") || undefined;
    const category = searchParams.get("category") || undefined;
    const priority = searchParams.get("priority") || undefined;

    // Unknown filter values used to reach Prisma and fail as a 500.
    if (status !== undefined && !isSupportTicketStatus(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    if (category !== undefined && !isSupportTicketCategory(category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }
    if (priority !== undefined && !isSupportTicketPriority(priority)) {
      return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
    }

    const result = await getSupportTickets(user.id, user.role ?? "CUSTOMER", {
      page,
      limit,
      status,
      category,
      priority,
    });

    return NextResponse.json({
      tickets: result.tickets,
      total: result.total,
      page,
      limit,
    });
  } catch (err) {
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => null);
    const parsed = ticketInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    const { orderId, subject, description, category, priority } = parsed.data;

    // Validated against the database enum (see lib/support/service.ts).
    if (!isSupportTicketCategory(category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }

    if (priority && !isSupportTicketPriority(priority)) {
      return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
    }

    const ticket = await createSupportTicket(user.id, {
      orderId,
      subject: subject.trim(),
      description: description.trim(),
      category,
      priority: priority && isSupportTicketPriority(priority) ? priority : undefined,
    });

    return NextResponse.json({ ticket }, { status: 201 });
  } catch (e: unknown) {
    const err = { message: e instanceof Error ? e.message : "" };
    if (err.message === "Message cannot be empty") {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err.message === "Order not found") {
      return NextResponse.json({ error: "That order was not found on your account." }, { status: 404 });
    }
    if (err.message.includes("Rate limit exceeded")) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
import { NextResponse } from "next/server";
import { guardWorkspace, forbidden } from "@/lib/orders/workspace-guard";
import { setCustomerOrderPaused, type CustomerOrderControl } from "@/lib/assignments/service";

/**
 * Shared handler for POST /api/orders/:orderId/pause and /resume.
 *
 * Only the customer who owns the order may call it. Boosters (including the
 * assigned one) and admins get 403; anyone without workspace access gets 404.
 * The request body is ignored: the order, user and target state all come
 * from the server.
 */
export async function handleCustomerOrderControl(orderId: string, action: CustomerOrderControl) {
  try {
    const g = await guardWorkspace(orderId);
    if (!g.ok) return g.response;
    if (g.access.viewerRole !== "customer") {
      return forbidden(
        action === "pause" ? "Only the customer can pause this order." : "Only the customer can resume this order."
      );
    }

    const result = await setCustomerOrderPaused(orderId, g.user.id, action);
    return NextResponse.json({ status: result.status, changed: result.changed });
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "NotOrderOwnerError") {
        return NextResponse.json({ error: "Order not found" }, { status: 404 });
      }
      if (error.name === "OrderStateConflictError") {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
    }
    console.error(`[orders] customer ${action} failed`, {
      orderId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: `Could not ${action} the order.` }, { status: 500 });
  }
}

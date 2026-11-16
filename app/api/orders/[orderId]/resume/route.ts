import { handleCustomerOrderControl } from "@/lib/orders/customer-control-route";

/** Customer resumes their paused order. */
export async function POST(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  return handleCustomerOrderControl(orderId, "resume");
}

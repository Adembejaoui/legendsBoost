import { handleCustomerOrderControl } from "@/lib/orders/customer-control-route";

/** Customer pauses their in-progress order. The booster must stop playing. */
export async function POST(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  return handleCustomerOrderControl(orderId, "pause");
}

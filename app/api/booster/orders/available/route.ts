import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { getAvailableOrders, verifyBoosterEligibility } from "@/lib/assignments/service";
import prisma from "@/lib/prisma";

export async function GET(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (user.role !== "BOOSTER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await verifyBoosterEligibility(user.id);

    const { searchParams } = new URL(req.url);
    const gameSlug = searchParams.get("game") || undefined;

    const orders = await getAvailableOrders({ gameSlug });

    return NextResponse.json({ orders });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Booster")) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Failed to fetch available orders" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireRole, financeErrorResponse, readJson } from "@/lib/finance/http";
import { createServicePriceVersion } from "@/lib/pricing/admin.service";

/** Admin: all price versions (active first). */
export async function GET() {
  const g = await requireRole("ADMIN");
  if (!g.ok) return g.response;
  const prices = await prisma.servicePrice.findMany({ orderBy: [{ status: "asc" }, { gameSlug: "asc" }, { serviceSlug: "asc" }, { version: "desc" }] });
  return NextResponse.json({ prices });
}

/**
 * Admin: create a new ACTIVE price version for a service (the previous
 * active version is retired). Amounts are integers in minor units. A price
 * does not make a service purchasable on its own: the catalog must also
 * allow live ordering.
 */
export async function POST(req: Request) {
  const g = await requireRole("ADMIN");
  if (!g.ok) return g.response;
  try {
    const price = await createServicePriceVersion(g.user.id, await readJson(req));
    return NextResponse.json({ price }, { status: 201 });
  } catch (e) {
    return financeErrorResponse(e);
  }
}

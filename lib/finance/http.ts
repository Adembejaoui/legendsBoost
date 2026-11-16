/**
 * Shared helpers for financial route handlers: role checks (role re-read
 * from the database by getSessionUser) and mapping of domain errors to HTTP
 * responses without leaking internals.
 */
import { NextResponse } from "next/server";
import { getSessionUser, type SessionUser } from "@/lib/auth/guards";
import { PayoutError } from "./payouts";
import { EarningError } from "./earnings";
import { RefundError } from "./refunds";
import { PricingAdminError } from "@/lib/pricing/admin.service";
import { CheckoutError } from "@/lib/payments/checkout.service";

type Guard = { ok: true; user: SessionUser } | { ok: false; response: NextResponse };

export async function requireRole(role: "ADMIN" | "BOOSTER" | "CUSTOMER"): Promise<Guard> {
  const user = await getSessionUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (user.role !== role) return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { ok: true, user };
}

const DOMAIN_ERRORS = [PayoutError, EarningError, RefundError, PricingAdminError, CheckoutError];

export function financeErrorResponse(e: unknown, fallback = "An unexpected error occurred.") {
  for (const E of DOMAIN_ERRORS) {
    if (e instanceof E) {
      const err = e as Error & { status: number; details?: string[] };
      return NextResponse.json({ error: err.message, ...(err.details ? { details: err.details } : {}) }, { status: err.status });
    }
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}

/** Strict JSON body or null. */
export async function readJson(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}

/**
 * Cashback balance from the append-only history (2026-11-24). PURE: no I/O.
 *
 * Positive entries are credit "lots" that may expire. Every debit (spend,
 * reversal, admin removal) uses the lots that expire first; an EXPIRE entry
 * closes the unspent part of its lot. A debit larger than the live credit
 * leaves a debt (e.g. cashback reversed after a refund) that the next credit
 * pays first.
 *
 *   balance   = sum of all amounts (what the ledger says is owed);
 *   available = live (unexpired) credit minus any debt: what can be spent.
 */

export type CashbackKind = "EARN" | "SPEND" | "RELEASE" | "EXPIRE" | "REVERSE" | "RETURN" | "ADJUST";

export interface CashbackEntryLike {
  id: string;
  kind: CashbackKind;
  amount: number;
  expiresAt: Date | null;
  lotId: string | null;
  createdAt: Date;
}

export interface CashbackLot {
  id: string;
  amount: number;
  remaining: number;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface CashbackState {
  balance: number;
  available: number;
  debt: number;
  lots: CashbackLot[];
}

const live = (lot: CashbackLot, at: Date) => lot.remaining > 0 && (lot.expiresAt === null || lot.expiresAt > at);

/** Lots that expire first come first (never-expiring last), then the oldest. */
function byExpiry(a: CashbackLot, b: CashbackLot) {
  const ea = a.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const eb = b.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
  return ea - eb || a.createdAt.getTime() - b.createdAt.getTime();
}

/** Replays the history (any order: sorted here) and returns the state at `now`. */
export function cashbackState(entries: readonly CashbackEntryLike[], now: Date): CashbackState {
  const sorted = [...entries].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const lots: CashbackLot[] = [];
  const lotById = new Map<string, CashbackLot>();
  let debt = 0;
  let balance = 0;

  for (const e of sorted) {
    balance += e.amount;
    if (e.amount > 0) {
      const lot: CashbackLot = { id: e.id, amount: e.amount, remaining: e.amount, expiresAt: e.expiresAt, createdAt: e.createdAt };
      // New credit pays an outstanding debt first.
      const pay = Math.min(debt, lot.remaining);
      lot.remaining -= pay;
      debt -= pay;
      lots.push(lot);
      lotById.set(lot.id, lot);
      continue;
    }
    let owed = -e.amount;
    if (e.kind === "EXPIRE" && e.lotId) {
      const lot = lotById.get(e.lotId);
      if (lot) {
        const take = Math.min(lot.remaining, owed);
        lot.remaining -= take;
        owed -= take;
      }
      // An expiry never creates a debt.
      continue;
    }
    for (const lot of lots.filter((l) => live(l, e.createdAt)).sort(byExpiry)) {
      if (owed === 0) break;
      const take = Math.min(lot.remaining, owed);
      lot.remaining -= take;
      owed -= take;
    }
    debt += owed;
  }

  const liveCredit = lots.filter((l) => live(l, now)).reduce((s, l) => s + l.remaining, 0);
  return { balance, debt, lots, available: Math.max(0, liveCredit - debt) };
}

/** Lots past their expiry that still hold credit: what the expiry job closes. */
export function expiredLots(state: CashbackState, now: Date): CashbackLot[] {
  return state.lots.filter((l) => l.remaining > 0 && l.expiresAt !== null && l.expiresAt <= now);
}

/**
 * The latest expiry among the live lots a spend of `amount` would use
 * (null when one of them never expires). Kept on the SPEND entry so a
 * cancelled checkout gives the credit back with the same expiry.
 */
export function spendExpiry(state: CashbackState, amount: number, now: Date): Date | null {
  let left = amount;
  let latest: Date | null = new Date(0);
  for (const lot of state.lots.filter((l) => live(l, now)).sort(byExpiry)) {
    if (left <= 0) break;
    left -= lot.remaining;
    if (lot.expiresAt === null) return null;
    if (latest && lot.expiresAt > latest) latest = lot.expiresAt;
  }
  return latest && latest.getTime() > 0 ? latest : null;
}

/**
 * Cashback that can pay an order: the available balance, at most `maxOrderBps`
 * of the amount still to pay, and never more than what is left of the
 * platform fee (platform-funded: the booster share is never touched).
 */
export function cashbackForOrder(available: number, amountDue: number, maxOrderBps: number, platformFeeLeft: number): number {
  if (available <= 0 || amountDue <= 0 || maxOrderBps <= 0 || platformFeeLeft <= 0) return 0;
  const byOrder = Math.floor((amountDue * maxOrderBps) / 10_000);
  return Math.max(0, Math.min(available, byOrder, platformFeeLeft));
}

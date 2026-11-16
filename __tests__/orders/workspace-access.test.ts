import { describe, it, expect } from "vitest";
import { resolveWorkspaceAccess, type WorkspaceAccessOrder } from "@/lib/orders/workspace-access";

const CUSTOMER = { id: "cust-1", role: "CUSTOMER" };
const OTHER_CUSTOMER = { id: "cust-2", role: "CUSTOMER" };
const BOOSTER = { id: "boost-1", role: "BOOSTER" };
const OTHER_BOOSTER = { id: "boost-2", role: "BOOSTER" };
const ADMIN = { id: "admin-1", role: "ADMIN" };

function order(overrides: Partial<WorkspaceAccessOrder> = {}): WorkspaceAccessOrder {
  return {
    id: "order-1",
    userId: CUSTOMER.id,
    status: "IN_PROGRESS",
    assignments: [{ id: "as-1", boosterId: BOOSTER.id, status: "IN_PROGRESS", activeOrderId: "order-1" }],
    ...overrides,
  };
}

describe("order workspace access", () => {
  it("customer owner gets access", () => {
    const a = resolveWorkspaceAccess(CUSTOMER, order());
    expect(a?.viewerRole).toBe("customer");
    expect(a?.canChat).toBe(true);
    expect(a?.canEditRiotAccount).toBe(true);
    expect(a?.canManageAssignment).toBe(false);
    expect(a?.canManageDraft).toBe(false);
  });

  it("another customer is rejected", () => {
    expect(resolveWorkspaceAccess(OTHER_CUSTOMER, order())).toBeNull();
  });

  it("assigned booster gets access and management", () => {
    const a = resolveWorkspaceAccess(BOOSTER, order());
    expect(a?.viewerRole).toBe("booster");
    expect(a?.activeAssignment?.id).toBe("as-1");
    expect(a?.canManageAssignment).toBe(true);
    expect(a?.canEditRiotAccount).toBe(false);
    expect(a?.canManageDraft).toBe(false);
  });

  it("an unassigned booster is rejected", () => {
    expect(resolveWorkspaceAccess(OTHER_BOOSTER, order())).toBeNull();
  });

  it("a booster whose assignment was released/abandoned is rejected", () => {
    const o = order({
      status: "DRAFT",
      assignments: [{ id: "as-1", boosterId: BOOSTER.id, status: "RELEASED", activeOrderId: null }],
    });
    expect(resolveWorkspaceAccess(BOOSTER, o)).toBeNull();
  });

  it("a stale assignment row pointing at another order grants nothing", () => {
    const o = order({ assignments: [{ id: "as-1", boosterId: BOOSTER.id, status: "IN_PROGRESS", activeOrderId: "order-999" }] });
    expect(resolveWorkspaceAccess(BOOSTER, o)).toBeNull();
  });

  it("the completing booster keeps read-only history access without chat", () => {
    const o = order({
      status: "COMPLETED",
      assignments: [{ id: "as-1", boosterId: BOOSTER.id, status: "COMPLETED", activeOrderId: null }],
    });
    const a = resolveWorkspaceAccess(BOOSTER, o);
    expect(a?.readOnly).toBe(true);
    expect(a?.canChat).toBe(false);
    expect(a?.canManageAssignment).toBe(false);
  });

  it("admin gets access to any order and draft management only on DRAFT", () => {
    expect(resolveWorkspaceAccess(ADMIN, order())?.canManageDraft).toBe(false);
    expect(resolveWorkspaceAccess(ADMIN, order({ status: "DRAFT", assignments: [] }))?.canManageDraft).toBe(true);
  });

  it("customer cannot manage their own draft", () => {
    const a = resolveWorkspaceAccess(CUSTOMER, order({ status: "DRAFT", assignments: [] }));
    expect(a?.canManageDraft).toBe(false);
  });

  it("customer owner can pause an in-progress order and resume a paused one", () => {
    const running = resolveWorkspaceAccess(CUSTOMER, order());
    expect(running).toMatchObject({ canPauseOrder: true, canResumeOrder: false });
    const paused = resolveWorkspaceAccess(
      CUSTOMER,
      order({ status: "PAUSED", assignments: [{ id: "as-1", boosterId: BOOSTER.id, status: "PAUSED", activeOrderId: "order-1" }] })
    );
    expect(paused).toMatchObject({ canPauseOrder: false, canResumeOrder: true });
  });

  it("a checkout hold (unpaid) is not an order: the customer cannot open it", () => {
    expect(resolveWorkspaceAccess(CUSTOMER, order({ status: "AWAITING_PAYMENT", assignments: [] }))).toBeNull();
    // Closed checkout: cancelled, never paid, has a price snapshot.
    expect(
      resolveWorkspaceAccess(CUSTOMER, { ...order({ status: "CANCELLED", assignments: [] }), paymentVerifiedAt: null, pricingSnapshot: { id: "s" } })
    ).toBeNull();
    // A legacy order (no snapshot) and a paid-then-cancelled order stay visible.
    expect(resolveWorkspaceAccess(CUSTOMER, { ...order({ status: "CANCELLED", assignments: [] }), paymentVerifiedAt: null, pricingSnapshot: null })).not.toBeNull();
    expect(
      resolveWorkspaceAccess(CUSTOMER, { ...order({ status: "CANCELLED", assignments: [] }), paymentVerifiedAt: new Date(), pricingSnapshot: { id: "s" } })
    ).not.toBeNull();
  });

  it.each(["PENDING", "COMPLETED", "CANCELLED", "DRAFT"])(
    "customer cannot pause or resume a %s order",
    (status) => {
      const a = resolveWorkspaceAccess(CUSTOMER, order({ status, assignments: [] }));
      expect(a).toMatchObject({ canPauseOrder: false, canResumeOrder: false });
    }
  );

  it("booster only has complete / abandon, never pause / resume", () => {
    const a = resolveWorkspaceAccess(BOOSTER, order());
    expect(a).toMatchObject({ canCompleteOrder: true, canAbandonOrder: true, canPauseOrder: false, canResumeOrder: false });
  });

  it("booster cannot complete or abandon while the order is paused", () => {
    const a = resolveWorkspaceAccess(
      BOOSTER,
      order({ status: "PAUSED", assignments: [{ id: "as-1", boosterId: BOOSTER.id, status: "PAUSED", activeOrderId: "order-1" }] })
    );
    expect(a?.canManageAssignment).toBe(true);
    expect(a).toMatchObject({ canCompleteOrder: false, canAbandonOrder: false, canPauseOrder: false, canResumeOrder: false });
  });

  it("admin gets no customer pause / resume or booster actions in the workspace", () => {
    const a = resolveWorkspaceAccess(ADMIN, order());
    expect(a).toMatchObject({ canCompleteOrder: false, canAbandonOrder: false, canPauseOrder: false, canResumeOrder: false });
  });

  it("there is no manual rank reporting permission any more", () => {
    for (const viewer of [CUSTOMER, BOOSTER, ADMIN]) {
      expect(resolveWorkspaceAccess(viewer, order())).not.toHaveProperty("canReportRank");
    }
  });

  it("unauthenticated / unknown roles / missing order are rejected", () => {
    expect(resolveWorkspaceAccess(null, order())).toBeNull();
    expect(resolveWorkspaceAccess({ id: "x", role: "HACKER" }, order())).toBeNull();
    expect(resolveWorkspaceAccess(CUSTOMER, null)).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findUnique: vi.fn() },
    supportTicket: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/chat/service", () => ({ canAccessConversation: vi.fn() }));

import prisma from "@/lib/prisma";
import { canAccessConversation } from "@/lib/chat/service";
import { canAccessChannel } from "@/lib/realtime/authorization";

const db = prisma as any;
const mockCanAccessConversation = canAccessConversation as any;

describe("realtime channel authorization (unit, mocked DB)", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("rejects unknown channel", async () => {
    db.user.findUnique.mockResolvedValue({ id: "u1", role: "CUSTOMER", boosterProfile: null });
    expect((await canAccessChannel({ id: "u1", role: "CUSTOMER" } as any, "public-foo:1")).allowed).toBe(false);
  });
  it("rejects deleted/ineligible user", async () => {
    db.user.findUnique.mockResolvedValue(null);
    expect((await canAccessChannel({ id: "u1", role: "CUSTOMER" } as any, "private-user:u1")).allowed).toBe(false);
  });
  it("rejects suspended/non-approved booster", async () => {
    db.user.findUnique.mockResolvedValue({ id: "b1", role: "BOOSTER", boosterProfile: { verificationStatus: "SUSPENDED" } });
    expect((await canAccessChannel({ id: "b1", role: "BOOSTER" } as any, "private-user:b1")).allowed).toBe(false);
  });
  it("allows approved booster to own user channel", async () => {
    db.user.findUnique.mockResolvedValue({ id: "b1", role: "BOOSTER", boosterProfile: { verificationStatus: "APPROVED" } });
    expect((await canAccessChannel({ id: "b1", role: "BOOSTER" } as any, "private-user:b1")).allowed).toBe(true);
  });
  it("denies cross-user private-user channel", async () => {
    db.user.findUnique.mockResolvedValue({ id: "u1", role: "CUSTOMER", boosterProfile: null });
    expect((await canAccessChannel({ id: "u1", role: "CUSTOMER" } as any, "private-user:u2")).allowed).toBe(false);
  });
  it("delegates order channel to DB-backed conversation access", async () => {
    db.user.findUnique.mockResolvedValue({ id: "u1", role: "CUSTOMER", boosterProfile: null });
    mockCanAccessConversation.mockResolvedValue(true);
    expect((await canAccessChannel({ id: "u1", role: "CUSTOMER" } as any, "private-order:o1")).allowed).toBe(true);
  });
  it("denies former/unassigned booster on order channel", async () => {
    db.user.findUnique.mockResolvedValue({ id: "b1", role: "BOOSTER", boosterProfile: { verificationStatus: "APPROVED" } });
    mockCanAccessConversation.mockResolvedValue(false);
    expect((await canAccessChannel({ id: "b1", role: "BOOSTER" } as any, "private-order:o1")).allowed).toBe(false);
  });
  it("enforces support ticket owner/admin only", async () => {
    db.user.findUnique.mockResolvedValue({ id: "u1", role: "CUSTOMER", boosterProfile: null });
    db.supportTicket.findUnique.mockResolvedValue({ customerId: "u1", assignedAdminId: null });
    expect((await canAccessChannel({ id: "u1", role: "CUSTOMER" } as any, "private-support:t1")).allowed).toBe(true);
    db.user.findUnique.mockResolvedValue({ id: "u2", role: "CUSTOMER", boosterProfile: null });
    expect((await canAccessChannel({ id: "u2", role: "CUSTOMER" } as any, "private-support:t1")).allowed).toBe(false);
    db.user.findUnique.mockResolvedValue({ id: "a1", role: "ADMIN", boosterProfile: null });
    expect((await canAccessChannel({ id: "a1", role: "ADMIN" } as any, "private-support:t1")).allowed).toBe(true);
  });
});

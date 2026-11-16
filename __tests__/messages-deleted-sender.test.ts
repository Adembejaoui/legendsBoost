import { describe, it, expect } from "vitest";
import { DELETED_USER_LABEL, getSenderDisplayName } from "@/lib/messages/sender";

describe("deleted sender handling", () => {
  it("uses Deleted user label when sender is null (customer context)", () => {
    expect(getSenderDisplayName(null)).toBe(DELETED_USER_LABEL);
    expect(DELETED_USER_LABEL).toBe("Deleted user");
  });

  it("uses Deleted user label when sender is missing/undefined (booster context)", () => {
    expect(getSenderDisplayName(undefined)).toBe(DELETED_USER_LABEL);
  });

  it("preserves existing sender name in admin-visible contexts", () => {
    expect(getSenderDisplayName({ id: "u1", name: "Admin User", image: null })).toBe("Admin User");
  });

  it("falls back to Deleted user when sender exists without name", () => {
    expect(getSenderDisplayName({ id: "u2", name: null, image: null })).toBe(DELETED_USER_LABEL);
  });
});

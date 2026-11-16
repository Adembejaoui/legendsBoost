import { describe, expect, it } from "vitest";
import { hashPassword, isPasswordHash, verifyPassword } from "@/lib/auth/password";

// Converted from a standalone tsx script (it was collected by vitest but had
// no test suite, so it always failed). Same checks.
describe("password hashing", () => {
  it("hashes to a bcrypt string and verifies", async () => {
    const hash = await hashPassword("correct horse");
    expect(isPasswordHash(hash)).toBe(true);
    expect(await verifyPassword("correct horse", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  }, 20_000);

  it("salts every hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  }, 20_000);

  it("rejects empty and oversized (> 72 bytes) passwords; accepts exactly 72", async () => {
    await expect(hashPassword("")).rejects.toThrow();
    await expect(hashPassword("a".repeat(73))).rejects.toThrow(/too long/);
    await expect(hashPassword("é".repeat(37))).rejects.toThrow(/too long/); // 74 bytes
    expect(isPasswordHash(await hashPassword("a".repeat(72)))).toBe(true);
  }, 20_000);

  it("never throws on bad hashes", async () => {
    expect(await verifyPassword("x", null as unknown as string)).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
  });
});

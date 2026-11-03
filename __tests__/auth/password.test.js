/**
 * Standalone test runner for auth password hashing.
 * Run with: node __tests__/auth/password.test.js
 */

const { hashPassword, verifyPassword, isPasswordHash } = require("../../lib/auth/password.ts");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.log(`  FAIL: ${message}`);
  }
}

async function runTests() {
  console.log("Password hashing tests\n");

  // Test 1: hash produces a string
  console.log("Test 1: hashPassword returns a string");
  try {
    const hash = await hashPassword("SecurePass123");
    assert(typeof hash === "string" && hash.length > 0, "hash is a non-empty string");
    assert(isPasswordHash(hash), "hash starts with $ (bcrypt format)");
  } catch (e) {
    assert(false, `hashPassword threw: ${e.message}`);
  }

  // Test 2: verify correct password
  console.log("\nTest 2: verifyPassword with correct password");
  try {
    const hash = await hashPassword("MyPassword1");
    const valid = await verifyPassword("MyPassword1", hash);
    assert(valid === true, "correct password verifies");
  } catch (e) {
    assert(false, `verifyPassword threw: ${e.message}`);
  }

  // Test 3: verify incorrect password
  console.log("\nTest 3: verifyPassword with incorrect password");
  try {
    const hash = await hashPassword("CorrectHorse");
    const valid = await verifyPassword("WrongBatter", hash);
    assert(valid === false, "incorrect password does not verify");
  } catch (e) {
    assert(false, `verifyPassword threw: ${e.message}`);
  }

  // Test 4: empty password rejected
  console.log("\nTest 4: empty password rejected");
  try {
    await hashPassword("");
    assert(false, "empty password should throw");
  } catch (e) {
    assert(true, "empty password throws as expected");
  }

  // Test 5: oversized password rejected
  console.log("\nTest 5: oversized password rejected");
  try {
    const longPassword = "a".repeat(73);
    await hashPassword(longPassword);
    assert(false, "oversized password should throw");
  } catch (e) {
    assert(e.message.includes("too long"), "oversized password throws 'too long'");
  }

  // Test 6: different hashes for same password
  console.log("\nTest 6: different hashes for same password");
  try {
    const hash1 = await hashPassword("SamePassword");
    const hash2 = await hashPassword("SamePassword");
    assert(hash1 !== hash2, "hashes are different (salt)");
  } catch (e) {
    assert(false, `hashPassword threw: ${e.message}`);
  }

  // Test 7: null/undefined hash
  console.log("\nTest 7: null hash returns false");
  try {
    const valid = await verifyPassword("password", null);
    assert(valid === false, "null hash returns false");
  } catch (e) {
    assert(false, `verifyPassword threw: ${e.message}`);
  }

  // Test 8: 72-byte password is accepted (boundary)
  console.log("\nTest 8: 72-byte password accepted (boundary)");
  try {
    const boundaryPassword = "a".repeat(72);
    const hash = await hashPassword(boundaryPassword);
    assert(typeof hash === "string" && hash.length > 0, "72-byte password accepted");
  } catch (e) {
    assert(false, `boundary password threw: ${e.message}`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((e) => {
  console.error("Test runner error:", e);
  process.exit(1);
});
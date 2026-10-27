import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("hashes passwords with a random salt and verifies without storing plaintext", async () => {
    const firstHash = await hashPassword("Example-Long-Password-123!");
    const secondHash = await hashPassword("Example-Long-Password-123!");

    expect(firstHash).not.toContain("Example-Long-Password-123!");
    expect(firstHash).not.toBe(secondHash);
    await expect(verifyPassword("Example-Long-Password-123!", firstHash)).resolves.toBe(true);
    await expect(verifyPassword("incorrect-password", firstHash)).resolves.toBe(false);
  });

  it("rejects malformed stored hashes", async () => {
    await expect(verifyPassword("anything", "not-a-hash")).resolves.toBe(false);
  });
});

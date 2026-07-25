import { createHmac } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createCounterSessionToken, verifyCounterSessionToken } from "@/lib/counter-session";

beforeEach(() => {
  process.env.COUNTER_SESSION_SECRET = "test-secret-do-not-use-in-prod";
});

const basePayload = {
  userId: "11111111-1111-1111-1111-111111111111",
  tenantId: "22222222-2222-2222-2222-222222222222",
  fullName: "Test Cashier",
  roleKey: "cashier",
};

describe("counter session token", () => {
  it("round-trips a signed payload", () => {
    const { token } = createCounterSessionToken(basePayload);
    const verified = verifyCounterSessionToken(token);

    expect(verified).not.toBeNull();
    expect(verified?.userId).toBe(basePayload.userId);
    expect(verified?.tenantId).toBe(basePayload.tenantId);
    expect(verified?.roleKey).toBe("cashier");
  });

  it("rejects a tampered payload", () => {
    const { token } = createCounterSessionToken(basePayload);
    const [encoded, signature] = token.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...basePayload, roleKey: "owner", issuedAt: Date.now(), expiresAt: Date.now() + 1000000 }),
    ).toString("base64url");

    expect(verifyCounterSessionToken(`${tamperedPayload}.${signature}`)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const { token } = createCounterSessionToken(basePayload);
    process.env.COUNTER_SESSION_SECRET = "a-different-secret";
    expect(verifyCounterSessionToken(token)).toBeNull();
  });

  it("rejects an expired token", () => {
    const [encoded] = createCounterSessionToken(basePayload).token.split(".");
    const expiredPayload = Buffer.from(
      JSON.stringify({ ...basePayload, issuedAt: Date.now() - 100000, expiresAt: Date.now() - 1000 }),
    ).toString("base64url");

    // Re-sign the expired payload so it fails on expiry, not signature.
    const { createHmac } = require("crypto");
    const sig = createHmac("sha256", process.env.COUNTER_SESSION_SECRET!)
      .update(expiredPayload)
      .digest("base64url");

    expect(verifyCounterSessionToken(`${expiredPayload}.${sig}`)).toBeNull();
  });

  it("rejects garbage input", () => {
    expect(verifyCounterSessionToken(undefined)).toBeNull();
    expect(verifyCounterSessionToken("")).toBeNull();
    expect(verifyCounterSessionToken("not-a-valid-token")).toBeNull();
  });
});

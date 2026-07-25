import { describe, expect, it } from "vitest";
import { hashPin, isValidPinFormat, verifyPin } from "@/lib/pin";

describe("pin hashing", () => {
  it("accepts 4-6 digit PINs, rejects everything else", () => {
    expect(isValidPinFormat("1234")).toBe(true);
    expect(isValidPinFormat("123456")).toBe(true);
    expect(isValidPinFormat("123")).toBe(false);
    expect(isValidPinFormat("1234567")).toBe(false);
    expect(isValidPinFormat("12a4")).toBe(false);
    expect(isValidPinFormat("")).toBe(false);
  });

  it("verifies a correct PIN against its own hash", () => {
    const { hash, salt } = hashPin("4821");
    expect(verifyPin("4821", hash, salt)).toBe(true);
  });

  it("rejects an incorrect PIN", () => {
    const { hash, salt } = hashPin("4821");
    expect(verifyPin("9999", hash, salt)).toBe(false);
  });

  it("produces a different hash for the same PIN each time (random salt)", () => {
    const a = hashPin("4821");
    const b = hashPin("4821");
    expect(a.hash).not.toBe(b.hash);
    expect(a.salt).not.toBe(b.salt);
    // but both still verify correctly against their own salt
    expect(verifyPin("4821", a.hash, a.salt)).toBe(true);
    expect(verifyPin("4821", b.hash, b.salt)).toBe(true);
  });

  it("does not verify one user's PIN against another user's hash+salt", () => {
    const alice = hashPin("1111");
    const bob = hashPin("2222");
    expect(verifyPin("1111", bob.hash, bob.salt)).toBe(false);
  });
});

import "server-only";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

/**
 * PIN hashing for the cashier counter-login flow. Uses Node's built-in scrypt (no extra
 * dependency) -- this file must only ever run in a Node-runtime Route Handler
 * (`export const runtime = "nodejs"`), never Edge middleware, never the browser.
 */

const KEY_LENGTH = 64;

export function isValidPinFormat(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

export function hashPin(pin: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pin, salt, KEY_LENGTH).toString("hex");
  return { hash, salt };
}

export function verifyPin(pin: string, hash: string, salt: string): boolean {
  const candidate = scryptSync(pin, salt, KEY_LENGTH);
  const stored = Buffer.from(hash, "hex");

  if (candidate.length !== stored.length) {
    return false;
  }

  return timingSafeEqual(candidate, stored);
}

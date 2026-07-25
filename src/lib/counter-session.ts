import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

export { COUNTER_COOKIE_NAME } from "@/lib/counter-cookie";

/**
 * The PIN counter-login flow does not create a new Supabase Auth session -- an owner/manager
 * stays logged in on the device, and this cookie just records which staff member is currently
 * "at the counter" for POS attribution. It's a small HMAC-signed, httpOnly, short-lived cookie,
 * not a JWT -- there's no need for the extra complexity of a JWT library for a same-server
 * sign/verify round trip.
 *
 * Important: because the cashier never gets their own real DB session, Postgres/RLS has no
 * visibility into this cookie. Any future per-role data hiding (e.g. cost price invisible to
 * cashiers) cannot be enforced via RLS and must be re-checked server-side, per request, using
 * this payload's userId re-looked-up against the DB (never trust the embedded roleKey as
 * authoritative if it could have gone stale mid-shift).
 */

export interface CounterSessionPayload {
  userId: string;
  tenantId: string;
  fullName: string;
  roleKey: string;
  issuedAt: number;
  expiresAt: number;
}

const SESSION_DURATION_MS = 12 * 60 * 60 * 1000; // 12h, roughly one shift

function getSecret(): string {
  const secret = process.env.COUNTER_SESSION_SECRET;
  if (!secret) {
    throw new Error("COUNTER_SESSION_SECRET is not set");
  }
  return secret;
}

function sign(data: string): string {
  return createHmac("sha256", getSecret()).update(data).digest("base64url");
}

export function createCounterSessionToken(
  payload: Omit<CounterSessionPayload, "issuedAt" | "expiresAt">,
): { token: string; expiresAt: number } {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + SESSION_DURATION_MS;

  const fullPayload: CounterSessionPayload = { ...payload, issuedAt, expiresAt };
  const encoded = Buffer.from(JSON.stringify(fullPayload)).toString("base64url");
  const signature = sign(encoded);

  return { token: `${encoded}.${signature}`, expiresAt };
}

export function verifyCounterSessionToken(token: string | undefined): CounterSessionPayload | null {
  if (!token) return null;

  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expectedSignature = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSignature);

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }

  let payload: CounterSessionPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof payload.expiresAt !== "number" || Date.now() > payload.expiresAt) {
    return null;
  }

  return payload;
}

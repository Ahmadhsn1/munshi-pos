// Edge-safe: no Node crypto import here. Middleware (Edge runtime) only ever needs the cookie
// name to check presence/clear it; actual signing/verification (lib/counter-session.ts, which
// uses Node's crypto) only ever runs in Node-runtime Route Handlers.
export const COUNTER_COOKIE_NAME = "counter_session";

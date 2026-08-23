# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Report them privately through
[GitHub Security Advisories](https://github.com/Ahmadhsn1/retailflow-saas/security/advisories/new),
or by email to `ahmad.hsn0099@gmail.com`.

Include the affected version or commit, reproduction steps, and the impact you believe it has.
Expect an acknowledgement within 72 hours.

## Scope

This is a multi-tenant financial application. The following are considered high-severity and are
especially in scope:

| Class | Examples |
|---|---|
| **Cross-tenant data access** | Any read or write that crosses a `tenant_id` boundary, including through a `SECURITY DEFINER` function or service-role route |
| **Privilege escalation** | A cashier acting with manager/owner permissions; a manager reading the audit log; any bypass of `getActingUserContext()` |
| **Counter-session forgery** | Forging, replaying or extending the HMAC-signed PIN cookie (`src/lib/counter-session.ts`) |
| **Sensitive field exposure** | `pin_hash` / `pin_salt` reaching a client; cost price reaching a user without `cost_price.view`, including via an RSC payload rather than rendered JSON |
| **Money or stock integrity** | Any path that lets stored totals diverge from their ledger source of truth, or defeats an invariant in `check_money_integrity()` |
| **Audit tampering** | Any path that updates or deletes an `audit_log` or `stock_ledger` row |

## Out of scope

- Findings that require the `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS by design.
- Missing hardening on a self-hosted deployment's own Supabase project (RLS toggles, exposed keys,
  weak `COUNTER_SESSION_SECRET`).
- Automated scanner output without a demonstrated impact.
- Rate limiting on unauthenticated endpoints, which is delegated to the hosting platform.

## Operator guidance

If you deploy this yourself:

- `SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security entirely. Never prefix it with
  `NEXT_PUBLIC_`, never import it into a Client Component, and store it as a secret.
- Generate a distinct `COUNTER_SESSION_SECRET` per environment with `openssl rand -hex 32`.
  Reusing a development value in production makes counter sessions forgeable.
- Use a production Supabase project separate from any project used for development or testing —
  the RLS test suite writes real rows.
- Apply migrations in filename order. Several later migrations exist specifically to close
  `EXECUTE` grants that Supabase's defaults hand to `anon`; skipping them leaves functions callable.
- After adding any `SECURITY DEFINER` or trigger function, run the grant-verification query in
  [`ENGINEERING.md`](ENGINEERING.md) and re-run `npm run test:rls`.

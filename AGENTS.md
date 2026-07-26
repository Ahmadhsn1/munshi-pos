<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Shop Management SaaS -- Project Conventions

Pakistan-focused shop management SaaS. Web-only: Next.js 15 (App Router, TypeScript) + Supabase
(Postgres + Auth), Tailwind + shadcn/ui, deployed on Vercel + Supabase Cloud. Full roadmap in
`plan.md` -- build one phase at a time, in order; do not start a later phase until the current one
is complete and tested.

## Absolute rules (apply from Phase 1 onward, no exceptions)

1. **Money is always an integer number of paisa.** Never a float, anywhere -- not in Postgres
   (`integer`/`bigint`, never `float`/`real`), not in application code. Use `lib/money.ts`
   (`toPaisa`/`fromPaisa`/`formatPKR`/`addPaisa`) as the only sanctioned boundary between integer
   paisa and any float-ish input/output (form fields, display strings).
2. **Weight is always an integer number of grams.** Same reasoning, same pattern:
   `lib/weight.ts` (`toGrams`/`fromGrams`/`formatWeight`).
3. **Every tenant-scoped table has a `tenant_id` column and an RLS policy.** Global reference
   catalogs (`roles`, `permissions`, `role_permissions`) are the deliberate exception -- see
   "Multi-tenancy & RLS" below for why.
4. **No hard deletes on financial records.** Soft delete with a reason column once financial
   tables exist (Phase 3+). Not yet applicable to Phase 1's schema.

## Multi-tenancy & RLS

- `public.current_tenant_id()` (in `20260725000005_rls_functions.sql`) is how every RLS policy
  resolves "the caller's own tenant". It's `SECURITY DEFINER` with `search_path = ''`, owned by
  the migration role, which is what lets its internal `select tenant_id from public.users where
  id = auth.uid()` bypass RLS without recursing into the very policy it supports (Postgres exempts
  the table owner from RLS unless `FORCE ROW LEVEL SECURITY` is set -- it never is, here).
- Policies reference it as `tenant_id = (select public.current_tenant_id())` -- the subquery
  wrapper is Supabase's documented RLS performance pattern (evaluated once per statement, not once
  per row). Keep using this form in every new tenant-scoped policy.
- **`SECURITY DEFINER` functions need explicit `REVOKE ... FROM public` AND `FROM anon` and/or
  `FROM authenticated`, not just one of them.** Supabase's default `ALTER DEFAULT PRIVILEGES`
  setup separately grants `EXECUTE` on every new public-schema function to
  `anon`/`authenticated`/`service_role`, on top of Postgres's own default grant to `PUBLIC`. This
  bit us once already while building this phase (see the `fix_function_execute_grants` /
  `fix_trigger_function_public_grant` migrations) -- `get_advisors` (Supabase MCP) caught it.
  **Always run the security advisor after adding or changing a `SECURITY DEFINER`/trigger
  function**, and verify with:
  ```sql
  select p.proname, r.rolname, has_function_privilege(r.oid, p.oid, 'EXECUTE')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join (select oid, rolname from pg_roles where rolname in ('anon','authenticated','service_role')) r
  where n.nspname = 'public';
  ```
- `roles`/`permissions`/`role_permissions` are intentionally **global, not tenant-scoped**: the
  full 8-phase plan uses exactly three fixed roles (owner/manager/cashier) for every tenant, with
  no per-tenant custom roles anywhere in the roadmap. If that ever changes, this needs revisiting.
- Row Level Security is row-scoped only -- it cannot hide individual columns. `pin_hash`/`pin_salt`
  on `public.users` are additionally locked down with column-level `REVOKE`/`GRANT` (see
  `20260725000009_column_privileges.sql`) so no authenticated client can ever read them, RLS
  notwithstanding. Follow this pattern for any future sensitive column that lives on an
  otherwise-readable table.
- Role-escalation / tenant-reassignment prevention lives in a `BEFORE UPDATE` trigger
  (`enforce_role_change_rules`), not RLS `WITH CHECK` -- RLS's `WITH CHECK` can only see the `NEW`
  row, so it can't compare against `OLD.role_id`. The trigger no-ops when `auth.uid() is null`
  (the service-role write path used by signup/staff-creation) -- remember this when adding new
  service-role write flows that touch `users.role_id`/`tenant_id`.

## Auth

- Real login (owner/manager): Supabase Auth email + password. Phone is a profile field only for
  now -- real phone-OTP is deferred (needs an SMS provider, not justified yet).
- Cashiers never get a real Supabase Auth session of their own. They get a real `auth.users` row
  (synthetic non-deliverable email + random password, created via
  `admin.createUser({ email_confirm: true })`) purely so the schema's `users.id -> auth.users.id`
  FK stays simple -- but they authenticate exclusively through PIN counter-login
  (`/api/auth/counter-login`), which layers a short-lived, HMAC-signed, httpOnly cookie
  (`lib/counter-session.ts`) on top of an already-authenticated owner/manager's real session. It
  is NOT a new Supabase Auth session.
- **Because of this, Postgres/RLS has zero visibility into "who's at the counter."** Any future
  per-role data hiding that needs to apply to a cashier (e.g. Phase 6's "cost price hidden from
  cashier") cannot be enforced via RLS and must be re-checked server-side, per request, by looking
  up the counter-session's `userId` fresh against the DB -- never trust the cookie's embedded
  `roleKey` as authoritative, it can go stale mid-shift if an owner changes the cashier's role.
- **`getActingUserContext()` is the ONLY correct source for an authorization decision** -- in
  Server Components and Route Handlers alike, back-office screens included, not just the POS.
  `getSessionUserContext()` answers "whose login is this device on" and is used by exactly one
  file (`/api/auth/counter-login`, which can't ask who's at the counter without being circular).
  This was a real Phase 6 finding, not a style preference: because counter-login layers onto an
  owner's still-live session, back-office code that authorized against the session let a cashier
  PIN'd in at the counter act with **owner** permissions -- create staff accounts, adjust stock,
  pay suppliers, read every cost price -- and the nav bar linked them straight there. The role
  model only held on the single screen the cashier was supposed to be confined to.
  `tests/unit/authorization-identity.test.ts` fails the build if a new file authorizes from the
  session identity, or if a route gates on `permissions.has()` without resolving the acting user.
- **Hiding a sensitive field in JSX is not enforcement.** A Server Component's fetched data reaches
  the browser in the RSC payload whether or not the JSX renders it, so `{canSee && <Cell/>}` alone
  leaks. Either omit the column from the `select()` (preferred -- for Route Handlers, where the
  response *is* the browser boundary, the data then never leaves Postgres) or null it out when
  projecting the row. Note that a `select()` string built from a ternary defeats supabase-js's
  literal-type inference and collapses the row type to `any`; in a Server Component prefer
  projection-time stripping to keep types intact.
- Route Handlers that use `SUPABASE_SERVICE_ROLE_KEY` (`lib/supabase/admin.ts`) or Node's
  `crypto` (`lib/pin.ts`, `lib/counter-session.ts`) must declare
  `export const runtime = "nodejs"` -- these are incompatible with the Edge runtime.
- Middleware (`src/middleware.ts`) uses `supabase.auth.getUser()`, never `getSession()`, for route
  protection. `getSession()` reads the JWT out of cookies without revalidating against the Auth
  server -- a documented `@supabase/ssr` footgun that would otherwise let a stale/tampered cookie
  pass route protection.
- Never trust a client-supplied `tenantId` for a privileged (service-role) operation. Always
  derive it server-side from the caller's own validated session first (see
  `lib/permissions.ts#getCurrentUserContext`), then scope the privileged operation to that.

## Known gotcha: use the legacy service_role JWT, not the new `sb_secret_...` key

As of this writing, `supabase.auth.admin.*` (createUser, deleteUser -- used by every
signup/staff-creation route) fails against GoTrue's `/admin/*` endpoints when
`SUPABASE_SERVICE_ROLE_KEY` is set to the new `sb_secret_...` key format: GoTrue tries to verify
the Authorization header as a JWT and rejects it with `unrecognized JWT kid <nil> for algorithm
ES256`. Confirmed via `get_logs(service: "auth")` while building this phase, not a guess. Use the
**legacy** service_role key (Project Settings -> API Keys -> "Legacy API Keys" -> `service_role`,
a long `eyJ...` JWT) until this is fixed upstream. Regular PostgREST calls (`.from(...)`) work fine
with either key format -- this only affects the GoTrue admin endpoints specifically.

## Known gotcha: middleware matcher must exclude `/api/*`

The page-guard middleware (`src/middleware.ts`) redirects unauthenticated requests to `/login`.
If its `matcher` isn't scoped to exclude `/api/*`, that redirect also intercepts API Route Handler
calls -- caught live during Phase 1 manual testing: `POST /api/auth/signup` with no session yet
(the normal case -- you're signing up precisely because you have no session) got silently
redirected to `/login`, returning login-page HTML with a 200 instead of the route's JSON, which
broke `res.json()` client-side with an opaque "Network error." Route Handlers authenticate
themselves (`getCurrentUserContext()` / `getUser()`) and return proper 401/403 JSON -- they must
never go through the page-guard's redirect. Keep `api` in the matcher's negative lookahead.

## Phase 2: products & inventory -- patterns established here

- **Write pattern changed from Phase 1's `users` table.** Every Phase 2 table
  (`units`/`categories`/`products`/`product_barcodes`/`stock_ledger`) has a **SELECT-only** RLS
  policy for `authenticated`. There is no client-side INSERT/UPDATE policy on any of them --
  every write goes through a Route Handler using `createAdminClient()` after a
  `getCurrentUserContext()` permission check, never a direct client-side Supabase call. This is
  more consistent than Phase 1's `users` table (which has a client UPDATE policy narrowed by
  column grants) and means sensitive/derived columns like `products.current_stock` never need a
  column-privilege migration -- there's no client write policy to narrow in the first place.
  Follow this SELECT-only-RLS-plus-admin-client-writes pattern for new tables going forward unless
  there's a specific reason a table needs direct client writes (Phase 1's `users` table has one:
  a user updating their own profile fields).
- **`units` is tenant-scoped, not a global catalog like `roles`/`permissions`.** Pakistani
  kiryana/wholesale shops use informal units (*bori*, *theli*, *gross*) that vary shop to shop --
  unlike the three fixed roles, there's no fixed universal set. Each tenant gets a starter set
  (piece, kg, g, litre, ml, dozen, carton, packet, box) seeded inside `bootstrap_tenant` at
  signup, and can freely add more via `/api/units`. Tenants created *before* this seeding was
  added to `bootstrap_tenant` have zero units and must create their own via the product form's
  "+ New unit" affordance -- this is expected, not a bug, if you're testing against an
  old/pre-existing tenant.
- **Cross-tenant FK consistency triggers.** Because every write goes through the service-role
  admin client (bypasses RLS entirely), a plain FK (e.g. `products.category_id ->
  categories.id`) does nothing to stop a buggy route from linking a product to a *different*
  tenant's category. Every Phase 2 table with a same-tenant FK relationship
  (`products`->categories/units, `product_barcodes`->products, `stock_ledger`->products) has a
  `BEFORE INSERT` trigger (`enforce_*_tenant_consistency`) that checks the referenced row's
  `tenant_id` matches. Add the same trigger for any new FK relationship between tenant-scoped
  tables.
- **Stock ledger is append-only; `products.current_stock` is a maintained projection, not
  computed on read.** An `AFTER INSERT` trigger on `stock_ledger` does
  `current_stock += NEW.quantity_delta` -- standard event-log + materialized-projection pattern,
  keeps low-stock queries O(1) per product instead of a `SUM()` over the whole ledger. Never
  UPDATE/DELETE a `stock_ledger` row -- corrections are compensating entries. This can't be
  enforced against `service_role` at the DB level, so it's an app-code discipline rule.
- **The RLS-enabled meta-check is now a real automated test, not ad hoc.** `check_rls_enabled()`
  (a `service_role`-only RPC, since PostgREST doesn't expose `pg_catalog`) backs
  `tests/rls/rls-enabled.test.ts`, which asserts `relrowsecurity = true` for every tenant-scoped
  table by name. **Add any new tenant-scoped table's name to that test's list** -- this is what
  actually catches a migration that forgets `ENABLE ROW LEVEL SECURITY`, not a manual
  `get_advisors` pass.

## Known gotcha: `z.coerce.number().optional()` doesn't handle a blank CSV cell

csv-parse gives `""` for an empty cell, never `undefined`. `z.coerce.number().min(1).optional()`
still runs the coercion on `""` (→ `0`) *before* the optional check ever applies, so a blank
optional numeric CSV column fails validation on `.min(1)` even though leaving it blank is the
normal case. Caught live during Phase 2 manual browser testing: every opening-stock import row
that didn't fill in `purchase_to_stock_factor`/`sale_to_stock_factor` was silently rejected. Fixed
with a `z.preprocess` that maps `""` to `undefined` before the coerced schema runs (see
`csvOptionalInt()` in `lib/validation.ts`); regression-tested in
`tests/unit/opening-stock-row-schema.test.ts`. Apply the same preprocessing to any future
optional numeric field parsed from CSV/spreadsheet input.

## Local dev tooling note (Windows)

The Supabase CLI does not support `npm install`/`npx` on Windows (intentionally disabled upstream
-- their docs point Windows users to Scoop instead). This repo instead has the CLI binary
downloaded directly from the GitHub release into `.tools/supabase.exe` (gitignored, ~220MB,
`.tools/README.md` has the redownload command). If you don't have Docker/enough local disk for
`supabase start`, developing directly against a real (even free-tier) Supabase Cloud project via
the `apply_migration`/`execute_sql` MCP tools is a fine substitute -- that's how this phase was
actually built and tested.

## Testing

- `npx vitest run tests/unit` -- pure logic (`money`, `weight`, `pin`, `counter-session`), no
  network, always runnable.
- `npx vitest run tests/rls` -- runs against the **real** Supabase project in `.env.local`
  (requires `SUPABASE_SERVICE_ROLE_KEY` to be filled in). Seeds real tenants/users, signs in with
  real passwords, and asserts on real RLS behavior -- not mocks. This is deliberate: RLS policy
  bugs are exactly the kind of thing a mock would hide. Tests clean up their own fixtures in
  `afterAll` via `cleanupTenant`, which deletes every tenant-scoped child table in FK order, sweeps
  any leftover users, and **throws** on failure. It used to be a bare `delete from tenants` whose
  error was discarded -- and since every tenant-scoped table is `on delete restrict`, it failed
  the moment a test created one row, silently, leaking ~37 tenants per run (295 tenants, ~18k
  products had piled up before this was caught). **When you add a tenant-scoped table, add it to
  `TENANT_CHILD_TABLES_IN_DELETE_ORDER` in `tests/rls/helpers.ts`** or teardown starts failing
  loudly again. `hookTimeout` is 120s because that teardown is ~26 sequential network round trips
  per tenant.
- `npx vitest run tests/rls/money-integrity.test.ts` -- reconciles stored money against its own
  source of truth in the live database (stock projection vs ledger, sale totals vs line items,
  payments vs totals, refunds vs return totals, no over-returns, no negative stock/cost, no
  ownerless khata). tsc/lint/tests/build are all structurally blind to *stored data drifting*, which
  is the failure a shopkeeper notices first. Add new invariants to the `check_money_integrity()`
  SQL function, not the test -- the test just asserts every returned violation count is zero.
- Whenever you add a new tenant-scoped table, add its name to `tests/rls/rls-enabled.test.ts`'s
  table list (see "Phase 2" section above) so a migration that forgets
  `ENABLE ROW LEVEL SECURITY` fails a test instead of waiting for a manual `get_advisors` pass.

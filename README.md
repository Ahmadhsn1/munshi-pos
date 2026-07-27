# Shop Management SaaS

A complete point-of-sale and back-office platform for Pakistani kiryana, mart, and wholesale
shops. Multi-tenant, web-only: Next.js 15 (App Router, TypeScript) on the frontend and API layer,
Supabase (PostgreSQL + Auth) on the backend, deployed on Vercel.

## What it does

- **Point of sale** — barcode scan or search, cart with per-line discounts, mixed payment on one
  bill (cash / khata / JazzCash / Easypaisa reference), hold & recall, returns, printable receipts
  with Urdu product names, shift open/close with cash reconciliation.
- **Inventory** — multi-unit products (carton → packet → piece conversions), categories, opening
  stock import, append-only stock ledger, low-stock alerts.
- **Purchasing** — supplier ledger, purchase orders with partial goods receipt, weighted-average
  costing.
- **Khata (credit ledger)** — running customer balances, credit limits, aging report, partial
  payment allocation, blacklist/stop-supply.
- **Reports & money** — daily sales summary, cashier-wise performance, margin/COGS, stock
  valuation, cash book, expense tracking, full audit log.
- **Roles & security** — owner / manager / cashier roles enforced end-to-end via Postgres Row
  Level Security, with PIN-based counter login for fast cashier hand-off.

See `plan.md` for the full build roadmap and `AGENTS.md` for project conventions (money/weight
handling, multi-tenancy, RLS patterns, and other engineering notes).

## Local development

1. **Install dependencies**
   ```
   npm install
   ```

2. **Environment variables** — copy `.env.example` to `.env.local` and fill in your Supabase
   project's values (Project Settings → API):
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from "API Keys"
   - `SUPABASE_SERVICE_ROLE_KEY` — from **"Legacy API Keys"** specifically (see the comment in
     `.env.example` for why)
   - `COUNTER_SESSION_SECRET` — generate with `openssl rand -hex 32`

3. **Database** — point at a Supabase project (Cloud free tier is fine) and apply
   `supabase/migrations/*.sql` in order, then `supabase/seed.sql`, via the SQL editor or the
   Supabase CLI (`.tools/supabase.exe db push`, needs Docker for `db reset`/local dev — see
   `.tools/README.md`).

4. **Run it**
   ```
   npm run dev
   ```
   Open http://localhost:3000/signup to create your first shop + owner account.

## Testing

```
npx vitest run tests/unit    # pure logic (money, weight, pin, counter-session) — no network
npx vitest run tests/rls     # cross-tenant isolation + role-escalation — needs .env.local
                              # filled in, runs against the REAL database, not mocks
npx vitest run               # everything
npm run build                # production build (also runs typecheck + lint)
```

## Deploying

### 1. Supabase Cloud (production project)

Use a dedicated production project, separate from any project used for local development or
testing (pick a region close to your users, e.g. `ap-south-1` Mumbai for Pakistan-based traffic).

1. Create a new project at https://supabase.com/dashboard
2. Apply all files in `supabase/migrations/` **in filename order**, then `supabase/seed.sql`,
   via the SQL Editor (paste each file's contents and run) or `supabase db push` with the CLI
   linked to the new project.
3. Under Authentication → Providers, confirm Email is enabled.
4. Grab the production `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and the
   **Legacy** `service_role` key (Project Settings → API Keys → Legacy API Keys) for the next step.

### 2. Vercel

1. Push this repo to GitHub (or GitLab/Bitbucket).
2. Import the project at https://vercel.com/new.
3. Add environment variables (Project Settings → Environment Variables) for Production:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (the Legacy one, from step 1 — mark it as a secret)
   - `COUNTER_SESSION_SECRET` (a fresh `openssl rand -hex 32`, different from your local one)
4. Deploy. Vercel auto-detects Next.js — no build config changes needed.
5. Visit `https://<your-project>.vercel.app/signup` and confirm you can create a shop end-to-end,
   same as the local test above.

Runs comfortably on free tiers to start: Vercel Hobby + Supabase free tier.

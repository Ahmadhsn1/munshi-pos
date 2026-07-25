# Shop Management SaaS — Phase 1

Pakistan-focused shop management SaaS. Web-only: Next.js 15 (App Router, TypeScript) + Supabase.
See `plan.md` for the full 8-phase roadmap and `AGENTS.md` for project conventions (money/weight
rules, RLS pattern, known gotchas).

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

3. **Database** — either:
   - Point at a real Supabase project (Cloud, free tier is fine) and apply
     `supabase/migrations/*.sql` in order, then `supabase/seed.sql`, via the SQL editor or the
     Supabase CLI (`.tools/supabase.exe db push`, needs Docker for `db reset`/local dev — see
     `.tools/README.md`), **or**
   - Use `apply_migration` MCP tool calls in order if working with an AI assistant that has
     Supabase MCP access (this is how Phase 1 was actually built/tested).

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

Don't reuse the dev/test project used while building this phase — create a fresh one for
production (pick a region close to your users when creating it, e.g. `ap-south-1` Mumbai for
Pakistan-based traffic, since `ap-southeast-1` Singapore was just a build-time default here).

1. Create a new project at https://supabase.com/dashboard
2. Apply all files in `supabase/migrations/` **in filename order**, then `supabase/seed.sql`,
   via the SQL Editor (paste each file's contents and run) or `supabase db push` with the CLI
   linked to the new project.
3. Under Authentication → Providers, confirm Email is enabled. Phase 1 doesn't need email
   templates customized (`email_confirm: true` is set server-side, so no confirmation email is
   ever sent).
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

Free tier covers both sides for a while: Vercel Hobby + Supabase free tier, as the plan intends.

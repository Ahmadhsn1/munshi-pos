-- Platform admin panel, part 1: a real subscription-status vocabulary for tenants, replacing the
-- dead `is_active` column (confirmed zero readers anywhere in src/ or elsewhere in supabase/ --
-- it was added in the original tenants table but nothing ever wrote or read it).
--
-- Deliberately a text status column, not a boolean, because "is this shop allowed in" is not
-- actually binary in a real subscription business: `past_due` (payment failed but not yet cut off)
-- and `cancelled` (churned, not suspended-for-cause) are different situations that need different
-- admin-panel treatment and different tenant-facing messaging, even though today only `suspended`
-- is enforced (see the dashboard layout's suspension gate). The full vocabulary is captured now so
-- a future billing-webhook integration has somewhere to write real states without another schema
-- migration.
alter table public.tenants
  drop column is_active,
  add column subscription_status text not null default 'trialing'
    check (subscription_status in ('trialing', 'active', 'past_due', 'suspended', 'cancelled')),
  add column suspended_at timestamptz,
  add column suspended_reason text;

-- Backs the admin dashboard's "count tenants by status" and "list suspended tenants" queries.
create index idx_tenants_subscription_status on public.tenants (subscription_status);

-- No RLS policy change needed: public.tenants already has zero client insert/update/delete
-- policies (see 20260725000006_rls_policies.sql's own comment -- tenant creation/mutation is
-- exclusively service-role), and the existing tenants_select_own SELECT policy exposes whichever
-- columns exist on the row, so it covers these new ones automatically.

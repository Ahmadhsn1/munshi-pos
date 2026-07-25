-- RLS `WITH CHECK` can only see the NEW row, so it can't compare against OLD.role_id -- a
-- BEFORE UPDATE trigger is the only mechanism with both OLD and NEW, making it the correct
-- enforcement point for role-escalation and tenant-reassignment prevention.
--
-- Triggers fire even for service-role writes (RLS bypass != trigger bypass), and the service-role
-- signup/staff-creation routes also write role_id -- so this trigger must recognize the trusted
-- server path and no-op for it. The service-role static JWT carries no `sub` claim, so
-- auth.uid() is null in that context; that's the signal used below.
create or replace function public.enforce_role_change_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new; -- service-role / server-trusted write path (signup, staff creation)
  end if;

  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id is immutable';
  end if;

  if new.role_id is distinct from old.role_id then
    if auth.uid() = old.id then
      raise exception 'You cannot change your own role';
    end if;

    if not exists (
      select 1
      from public.users u
      join public.roles r on r.id = u.role_id
      where u.id = auth.uid()
        and u.tenant_id = old.tenant_id
        and r.key in ('owner', 'manager')
    ) then
      raise exception 'Insufficient permissions to change role';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_enforce_role_change_rules
before update on public.users
for each row execute function public.enforce_role_change_rules();

-- Trigger functions are never meant to be part of the exposed PostgREST API -- revoke from
-- PUBLIC (Postgres's default grant on creation; anon/authenticated inherit through it otherwise).
revoke execute on function public.enforce_role_change_rules() from public;

// One-off bootstrap: creates the first (or an additional) platform admin login. Deliberately not a
// public route -- there must never be a self-serve path to becoming platform staff, same reasoning
// as bootstrap_tenant's service_role-only grant for tenant creation. Run manually:
//
//   node scripts/create-platform-admin.cjs --email you@example.com --name "Ahmad" --password "..."
//
// Same conventions as scripts/purge-leaked-test-tenants.cjs: .env.local, raw service-role client,
// autoRefreshToken/persistSession both off.
require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

function parseArgs() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const flag = process.argv[i];
    const value = process.argv[i + 1];
    if (!flag?.startsWith("--")) continue;
    args[flag.slice(2)] = value;
  }
  return args;
}

const { email, name, password } = parseArgs();

if (!email || !name || !password) {
  console.error('Usage: node scripts/create-platform-admin.cjs --email you@example.com --name "Your Name" --password "..."');
  process.exit(1);
}

if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const { data: created, error: createUserError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createUserError) {
    console.error(`Failed to create auth user: ${createUserError.message}`);
    process.exit(1);
  }

  const { error: insertError } = await admin.from("platform_admins").insert({
    id: created.user.id,
    full_name: name,
    email,
  });

  if (insertError) {
    console.error(`Failed to insert platform_admins row: ${insertError.message}`);
    console.error(`The auth user (${created.user.id}) was still created -- clean it up manually via the Supabase dashboard if you don't retry this.`);
    process.exit(1);
  }

  console.log(`Platform admin created: ${email} (${created.user.id})`);
  // /admin has no login form of its own -- it shares /login with tenant staff, and "/" routes a
  // freshly signed-in user to /admin vs /dashboard depending on which identity space they're in.
  console.log("Log in at /login");
}

main();

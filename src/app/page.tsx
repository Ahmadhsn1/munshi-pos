import { redirect } from "next/navigation";
import { getPlatformAdminContext } from "@/lib/platform-admin";
import { getActingUserContext } from "@/lib/permissions";

// Middleware already sends unauthenticated visitors to /login before this ever renders. For
// everyone else, this is also where the single shared login form (src/app/login/page.tsx) sends a
// freshly signed-in user -- platform admins and tenant staff authenticate through the same
// Supabase Auth call, so this is the one place that decides which identity space a given uid
// actually belongs to and routes accordingly, rather than the login form needing to know.
export default async function Home() {
  const adminContext = await getPlatformAdminContext();
  if (adminContext) {
    redirect("/admin");
  }

  const tenantContext = await getActingUserContext();
  if (tenantContext) {
    redirect("/dashboard");
  }

  redirect("/login");
}

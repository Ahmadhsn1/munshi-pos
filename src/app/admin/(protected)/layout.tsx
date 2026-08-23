import { redirect } from "next/navigation";
import Link from "next/link";
import { getPlatformAdminContext } from "@/lib/platform-admin";
import { AdminLogoutButton } from "../admin-logout-button";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const context = await getPlatformAdminContext();

  if (!context) {
    // One shared login form for both tenant staff and platform admins (src/app/login/page.tsx) --
    // it authenticates against the same Supabase Auth either way, and src/app/page.tsx is what
    // routes a freshly signed-in user to /admin vs /dashboard depending on which identity space
    // their uid actually belongs to. This is just the "not signed in at all" bounce.
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-card flex items-center justify-between border-b px-5 py-2.5">
        <div className="flex items-center gap-6">
          <span className="font-serif text-sm font-bold">Platform admin</span>
          <nav className="flex items-center gap-4 text-[13px]">
            <Link href="/admin" className="hover:underline">
              Dashboard
            </Link>
            <Link href="/admin/tenants" className="hover:underline">
              Tenants
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground hidden text-[13px] md:inline">{context.fullName}</span>
          <AdminLogoutButton />
        </div>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}

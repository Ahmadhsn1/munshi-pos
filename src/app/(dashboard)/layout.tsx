import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "@/components/logout-button";

// Defense in depth: middleware already redirects unauthenticated requests to /login before this
// layout ever renders, but a Server Component guard doesn't rely on middleware matcher config
// staying correct forever.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("full_name, tenant_id, tenants:tenant_id(name), roles:role_id(key, name)")
    .eq("id", user.id)
    .single();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="font-semibold">
            {(profile?.tenants as unknown as { name: string } | null)?.name ?? "Shop Management"}
          </Link>
          <nav className="text-muted-foreground flex gap-4 text-sm">
            <Link href="/dashboard" className="hover:text-foreground">
              Dashboard
            </Link>
            <Link href="/pos" className="hover:text-foreground">
              Sell
            </Link>
            <Link href="/pos/sales" className="hover:text-foreground">
              Sales
            </Link>
            <Link href="/products" className="hover:text-foreground">
              Products
            </Link>
            <Link href="/categories" className="hover:text-foreground">
              Categories
            </Link>
            <Link href="/inventory" className="hover:text-foreground">
              Inventory
            </Link>
            <Link href="/purchases" className="hover:text-foreground">
              Purchases
            </Link>
            <Link href="/suppliers" className="hover:text-foreground">
              Suppliers
            </Link>
            <Link href="/customers" className="hover:text-foreground">
              Customers
            </Link>
            <Link href="/staff" className="hover:text-foreground">
              Staff
            </Link>
            <Link href="/counter" className="hover:text-foreground">
              Counter
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {profile?.full_name} ·{" "}
            {(profile?.roles as unknown as { name: string } | null)?.name ?? "..."}
          </span>
          <LogoutButton />
        </div>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}

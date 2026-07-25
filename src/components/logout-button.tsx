"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    // Clear the counter-login cookie too -- without this, a stale cashier "at the counter" could
    // visually linger if a different owner/manager signs into the same shared device next
    // (middleware's own re-validation already prevents any actual cross-tenant data leak from
    // this, but leaving it uncleared is sloppy UX, not just a cosmetic nit).
    await fetch("/api/auth/counter-logout", { method: "POST" });
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <Button variant="outline" size="sm" onClick={handleLogout}>
      Log out
    </Button>
  );
}

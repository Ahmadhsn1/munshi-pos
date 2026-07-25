import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUserContext } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { CounterPinPad } from "./pin-pad";

export default async function CounterPage() {
  const context = await getCurrentUserContext();

  if (!context) {
    redirect("/login");
  }

  // Uses the admin client, scoped by context.tenantId (derived from the caller's own validated
  // session, never client input) -- the `authenticated` role can't select pin_hash at all (see
  // the column-privilege migration), so this query can't run through the regular RLS-scoped
  // client. Only safe fields (id, full_name, role) ever leave this function.
  const admin = createAdminClient();
  const { data: candidates } = await admin
    .from("users")
    .select("id, full_name, roles:role_id(key, name)")
    .eq("tenant_id", context.tenantId)
    .eq("is_active", true)
    .not("pin_hash", "is", null);

  const staff = (candidates ?? []).map((c) => ({
    id: c.id,
    fullName: c.full_name,
    roleName: (c.roles as unknown as { key: string; name: string } | null)?.name ?? "Staff",
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Counter login</h1>
        <p className="text-muted-foreground">
          Switch to a cashier for this shift without logging out of the owner/manager session.
        </p>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Who&apos;s at the counter?</CardTitle>
          <CardDescription>Select your name, then enter your PIN.</CardDescription>
        </CardHeader>
        <CardContent>
          <CounterPinPad staff={staff} />
        </CardContent>
      </Card>
    </div>
  );
}

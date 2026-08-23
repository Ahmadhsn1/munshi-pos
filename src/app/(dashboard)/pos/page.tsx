import { redirect } from "next/navigation";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getActingUserContext } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { PosClient } from "./pos-client";
import { ShiftOpenGate } from "./shift-open-gate";

export default async function PosPage() {
  const context = await getActingUserContext();

  if (!context) {
    redirect("/login");
  }

  if (!context.permissions.has("sales.create")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Point of Sale</CardTitle>
          <CardDescription>
            Your role ({context.roleName}) doesn&apos;t have permission to operate the counter.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const admin = createAdminClient();

  const [{ data: shift }, { data: tenant }] = await Promise.all([
    admin
      .from("shifts")
      .select("id, opening_cash_paisa, opened_at")
      .eq("tenant_id", context.tenantId)
      .eq("cashier_user_id", context.userId)
      .eq("status", "open")
      .maybeSingle(),
    admin.from("tenants").select("name").eq("id", context.tenantId).single(),
  ]);

  if (!shift) {
    return <ShiftOpenGate />;
  }

  return (
    <PosClient
      cashierName={context.fullName}
      canDiscount={context.permissions.has("sales.discount")}
      tenantName={tenant?.name ?? "Shop"}
    />
  );
}

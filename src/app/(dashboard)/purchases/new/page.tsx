import { redirect } from "next/navigation";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUserContext } from "@/lib/permissions";
import { NewPurchaseClient } from "./new-purchase-client";

export default async function NewPurchasePage() {
  const context = await getCurrentUserContext();

  if (!context) {
    redirect("/login");
  }

  if (!context.permissions.has("purchases.manage")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>New purchase</CardTitle>
          <CardDescription>
            Your role ({context.roleName}) doesn&apos;t have permission to create purchases.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return <NewPurchaseClient />;
}

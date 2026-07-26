import { redirect } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getActingUserContext } from "@/lib/permissions";

export default async function DashboardPage() {
  const context = await getActingUserContext();

  if (!context) {
    redirect("/login");
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground">Phase 1 smoke test: auth, tenancy, and roles.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Signed in as</CardTitle>
            <CardDescription>{context.fullName}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div>
              Role: <Badge variant="secondary">{context.roleName}</Badge>
            </div>
            <div className="text-muted-foreground">Tenant ID: {context.tenantId}</div>
            <div className="text-muted-foreground">User ID: {context.userId}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your permissions</CardTitle>
            <CardDescription>Resolved from your role via role_permissions.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {[...context.permissions].sort().map((permission) => (
              <Badge key={permission} variant="outline">
                {permission}
              </Badge>
            ))}
          </CardContent>
        </Card>
      </div>

      {context.permissions.has("users.manage") ? (
        <Card>
          <CardHeader>
            <CardTitle>Staff</CardTitle>
            <CardDescription>
              You can manage staff accounts and PINs.{" "}
              <Link href="/staff" className="underline">
                Go to staff
              </Link>
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Staff</CardTitle>
            <CardDescription>
              Your role ({context.roleName}) doesn&apos;t have permission to manage staff.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}

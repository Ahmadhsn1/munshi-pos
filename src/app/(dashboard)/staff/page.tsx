import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCurrentUserContext } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { StaffCreateForm } from "./staff-create-form";

export default async function StaffPage() {
  const context = await getCurrentUserContext();

  if (!context) {
    redirect("/login");
  }

  if (!context.permissions.has("users.manage")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Staff</CardTitle>
          <CardDescription>
            Your role ({context.roleName}) doesn&apos;t have permission to manage staff.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const supabase = await createClient();
  const { data: staff } = await supabase
    .from("users")
    .select("id, full_name, phone, email, is_active, roles:role_id(name), pin_attempts, pin_locked_until")
    .order("created_at", { ascending: true });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Staff</h1>
        <p className="text-muted-foreground">Manage owner/manager logins and cashier PINs.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add staff</CardTitle>
          <CardDescription>
            Managers log in with email + password. Cashiers only ever use a PIN at the counter.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StaffCreateForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current staff</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(staff ?? []).map((member) => (
                <TableRow key={member.id}>
                  <TableCell>{member.full_name}</TableCell>
                  <TableCell>
                    {(member.roles as unknown as { name: string } | null)?.name ?? "-"}
                  </TableCell>
                  <TableCell>{member.email ?? <span className="text-muted-foreground">PIN only</span>}</TableCell>
                  <TableCell>{member.phone ?? "-"}</TableCell>
                  <TableCell>
                    <Badge variant={member.is_active ? "secondary" : "outline"}>
                      {member.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

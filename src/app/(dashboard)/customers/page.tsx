import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getActingUserContext } from "@/lib/permissions";
import { formatPKR } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { CustomerCreateForm } from "./customer-create-form";

export default async function CustomersPage() {
  const context = await getActingUserContext();

  if (!context) {
    redirect("/login");
  }

  if (!context.permissions.has("customers.manage")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Customers</CardTitle>
          <CardDescription>
            Your role ({context.roleName}) doesn&apos;t have permission to view customers.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const supabase = await createClient();
  const { data: customers } = await supabase
    .from("customers")
    .select("id, name, phone, credit_limit_paisa, price_tier, is_blacklisted, is_active")
    .order("name");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Customers</h1>
          <p className="text-muted-foreground">Manage your customer master and khata (credit) terms.</p>
        </div>
        <Link href="/customers/aging" className="text-sm hover:underline">
          Khata aging →
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add customer</CardTitle>
        </CardHeader>
        <CardContent>
          <CustomerCreateForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All customers</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Credit limit</TableHead>
                <TableHead>Price tier</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(customers ?? []).map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell>
                    <Link href={`/customers/${customer.id}`} className="hover:underline">
                      {customer.name}
                    </Link>
                  </TableCell>
                  <TableCell>{customer.phone ?? "-"}</TableCell>
                  <TableCell>{customer.credit_limit_paisa != null ? formatPKR(customer.credit_limit_paisa) : "No limit"}</TableCell>
                  <TableCell>{customer.price_tier ?? "-"}</TableCell>
                  <TableCell className="flex gap-2">
                    <Badge variant={customer.is_active ? "secondary" : "outline"}>
                      {customer.is_active ? "Active" : "Inactive"}
                    </Badge>
                    {customer.is_blacklisted && <Badge variant="destructive">Blacklisted</Badge>}
                  </TableCell>
                </TableRow>
              ))}
              {(customers ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground text-center">
                    No customers yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

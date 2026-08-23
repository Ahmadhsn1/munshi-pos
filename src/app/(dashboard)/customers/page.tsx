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

  // Net khata balance per customer -- same debits-minus-credits definition as the dashboard's
  // grand total and lib/khata.ts#computeKhataBalance, just grouped by customer instead of summed
  // tenant-wide. Deliberately NOT the /customers/aging page's FIFO allocation: this list only needs
  // "how much, if any, does each customer currently owe" for an at-a-glance pill, not which
  // specific invoice that balance traces back to.
  //
  // Fetched in 3 dependency-ordered rounds instead of 6 flat sequential awaits -- each round only
  // waits on what the next one actually needs (saleIds, then returnIds), and everything independent
  // within a round runs concurrently.
  const [{ data: customers }, { data: sales }, { data: customerPayments }] = await Promise.all([
    supabase
      .from("customers")
      .select("id, name, phone, credit_limit_paisa, price_tier, is_blacklisted, is_active")
      .order("name"),
    supabase.from("sales").select("id, customer_id").not("customer_id", "is", null),
    supabase.from("customer_payments").select("customer_id, amount_paisa"),
  ]);
  const customerIdBySaleId = new Map((sales ?? []).map((s) => [s.id, s.customer_id]));
  const saleIds = (sales ?? []).map((s) => s.id);

  const [{ data: khataSalePayments }, { data: saleReturns }] = await Promise.all([
    saleIds.length > 0
      ? supabase.from("sale_payments").select("sale_id, amount_paisa").eq("payment_mode", "khata").in("sale_id", saleIds)
      : Promise.resolve({ data: [] }),
    saleIds.length > 0
      ? supabase.from("sale_returns").select("id, sale_id").in("sale_id", saleIds)
      : Promise.resolve({ data: [] }),
  ]);
  const saleIdByReturnId = new Map((saleReturns ?? []).map((r) => [r.id, r.sale_id]));
  const returnIds = (saleReturns ?? []).map((r) => r.id);

  const { data: khataReturnPayments } =
    returnIds.length > 0
      ? await supabase.from("sale_return_payments").select("sale_return_id, amount_paisa").eq("payment_mode", "khata").in("sale_return_id", returnIds)
      : { data: [] };

  const balanceByCustomer = new Map<string, number>();
  for (const p of khataSalePayments ?? []) {
    const customerId = customerIdBySaleId.get(p.sale_id);
    if (!customerId) continue;
    balanceByCustomer.set(customerId, (balanceByCustomer.get(customerId) ?? 0) + p.amount_paisa);
  }
  for (const p of khataReturnPayments ?? []) {
    const saleId = saleIdByReturnId.get(p.sale_return_id);
    const customerId = saleId ? customerIdBySaleId.get(saleId) : undefined;
    if (!customerId) continue;
    balanceByCustomer.set(customerId, (balanceByCustomer.get(customerId) ?? 0) - p.amount_paisa);
  }
  for (const p of customerPayments ?? []) {
    balanceByCustomer.set(p.customer_id, (balanceByCustomer.get(p.customer_id) ?? 0) - p.amount_paisa);
  }

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
                <TableHead>Balance</TableHead>
                <TableHead>Credit limit</TableHead>
                <TableHead>Price tier</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(customers ?? []).map((customer) => {
                const balancePaisa = balanceByCustomer.get(customer.id) ?? 0;
                return (
                  <TableRow key={customer.id}>
                    <TableCell>
                      <Link href={`/customers/${customer.id}`} className="hover:underline">
                        {customer.name}
                      </Link>
                    </TableCell>
                    <TableCell>{customer.phone ?? "-"}</TableCell>
                    <TableCell>
                      {balancePaisa > 0 ? (
                        <Badge className="bg-debt-soft text-debt border-transparent">
                          {formatPKR(balancePaisa)} owed
                        </Badge>
                      ) : (
                        <Badge className="bg-accent text-accent-foreground border-transparent">Clear</Badge>
                      )}
                    </TableCell>
                    <TableCell>{customer.credit_limit_paisa != null ? formatPKR(customer.credit_limit_paisa) : "No limit"}</TableCell>
                    <TableCell>{customer.price_tier ?? "-"}</TableCell>
                    <TableCell className="flex gap-2">
                      <Badge variant={customer.is_active ? "secondary" : "outline"}>
                        {customer.is_active ? "Active" : "Inactive"}
                      </Badge>
                      {customer.is_blacklisted && <Badge variant="destructive">Blacklisted</Badge>}
                    </TableCell>
                  </TableRow>
                );
              })}
              {(customers ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground text-center">
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

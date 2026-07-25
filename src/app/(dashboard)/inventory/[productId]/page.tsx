import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCurrentUserContext } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatPKR } from "@/lib/money";

export default async function ProductLedgerPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const context = await getCurrentUserContext();

  if (!context) {
    redirect("/login");
  }

  if (!context.permissions.has("inventory.view")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Stock history</CardTitle>
          <CardDescription>
            Your role ({context.roleName}) doesn&apos;t have permission to view inventory.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const supabase = await createClient();

  const { data: product } = await supabase
    .from("products")
    .select("id, name_en, current_stock, stock_unit:stock_unit_id(name)")
    .eq("id", productId)
    .maybeSingle();

  if (!product) {
    notFound();
  }

  const { data: movements } = await supabase
    .from("stock_ledger")
    .select("id, movement_type, quantity_delta, reason_code, note, unit_cost_paisa, created_at, created_by:created_by(full_name)")
    .eq("product_id", productId)
    .order("created_at", { ascending: false });

  const stockUnit = product.stock_unit as unknown as { name: string } | null;
  const showCost = context.permissions.has("cost_price.view");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/inventory" className="text-muted-foreground text-sm hover:underline">
          ← Inventory
        </Link>
        <h1 className="text-2xl font-semibold">{product.name_en}</h1>
        <p className="text-muted-foreground">
          Current stock: {product.current_stock} {stockUnit?.name}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stock movement history</CardTitle>
          <CardDescription>
            The ledger is the source of truth for all stock -- every change is a permanent entry
            here, never edited or deleted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Change</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Note</TableHead>
                {showCost && <TableHead>Unit cost</TableHead>}
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(movements ?? []).map((movement) => {
                const createdBy = movement.created_by as unknown as { full_name: string } | null;

                return (
                  <TableRow key={movement.id}>
                    <TableCell className="text-sm">
                      {new Date(movement.created_at).toLocaleString("en-PK")}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {movement.movement_type === "opening_stock" ? "Opening stock" : "Adjustment"}
                      </Badge>
                    </TableCell>
                    <TableCell className={movement.quantity_delta < 0 ? "text-destructive" : ""}>
                      {movement.quantity_delta > 0 ? "+" : ""}
                      {movement.quantity_delta} {stockUnit?.name}
                    </TableCell>
                    <TableCell>{movement.reason_code ?? "-"}</TableCell>
                    <TableCell>{movement.note ?? "-"}</TableCell>
                    {showCost && (
                      <TableCell>
                        {movement.unit_cost_paisa != null ? formatPKR(movement.unit_cost_paisa) : "-"}
                      </TableCell>
                    )}
                    <TableCell>{createdBy?.full_name ?? "-"}</TableCell>
                  </TableRow>
                );
              })}
              {(movements ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={showCost ? 7 : 6} className="text-muted-foreground text-center">
                    No stock movements yet.
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

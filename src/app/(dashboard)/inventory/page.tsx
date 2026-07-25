import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCurrentUserContext } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { StockAdjustmentDialog } from "./stock-adjustment-dialog";
import { OpeningStockImportDialog } from "./opening-stock-import-dialog";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ low?: string }>;
}) {
  const context = await getCurrentUserContext();

  if (!context) {
    redirect("/login");
  }

  if (!context.permissions.has("inventory.view")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Inventory</CardTitle>
          <CardDescription>
            Your role ({context.roleName}) doesn&apos;t have permission to view inventory.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { low } = await searchParams;
  const supabase = await createClient();

  const { data: products } = await supabase
    .from("products")
    .select("id, name_en, current_stock, reorder_level, stock_unit:stock_unit_id(name)")
    .eq("is_active", true)
    .order("name_en");

  const lowStockCount = (products ?? []).filter(
    (p) => p.reorder_level > 0 && p.current_stock <= p.reorder_level,
  ).length;

  const visibleProducts = low
    ? (products ?? []).filter((p) => p.reorder_level > 0 && p.current_stock <= p.reorder_level)
    : (products ?? []);

  const canAdjust = context.permissions.has("inventory.adjust");
  const canManageProducts = context.permissions.has("products.manage");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Inventory</h1>
          <p className="text-muted-foreground">
            Stock levels are the ledger&apos;s running total, not editable directly.
          </p>
        </div>
        <div className="flex gap-2">
          {canAdjust && canManageProducts && <OpeningStockImportDialog />}
          <Button
            variant={low ? "default" : "outline"}
            render={<Link href={low ? "/inventory" : "/inventory?low=1"} />}
          >
            {low ? "Show all" : `Low stock (${lowStockCount})`}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Current stock</TableHead>
                <TableHead>Reorder level</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleProducts.map((product) => {
                const stockUnit = product.stock_unit as unknown as { name: string } | null;
                const isLow = product.reorder_level > 0 && product.current_stock <= product.reorder_level;

                return (
                  <TableRow key={product.id}>
                    <TableCell>
                      <Link href={`/inventory/${product.id}`} className="hover:underline">
                        {product.name_en}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span>
                          {product.current_stock} {stockUnit?.name}
                        </span>
                        {isLow && <Badge variant="destructive">Low</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      {product.reorder_level > 0 ? `${product.reorder_level} ${stockUnit?.name}` : "-"}
                    </TableCell>
                    <TableCell>
                      {canAdjust && (
                        <StockAdjustmentDialog
                          productId={product.id}
                          productName={product.name_en}
                          currentStock={product.current_stock}
                          unitName={stockUnit?.name ?? ""}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {visibleProducts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground text-center">
                    {low ? "No products are low on stock." : "No products yet."}
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

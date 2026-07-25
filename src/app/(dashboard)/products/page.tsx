import { redirect } from "next/navigation";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCurrentUserContext } from "@/lib/permissions";
import { formatPKR } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { formatTaxRate } from "@/lib/tax";
import { ProductCreateDialog } from "./product-create-dialog";

export default async function ProductsPage() {
  const context = await getCurrentUserContext();

  if (!context) {
    redirect("/login");
  }

  if (!context.permissions.has("products.view")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Products</CardTitle>
          <CardDescription>
            Your role ({context.roleName}) doesn&apos;t have permission to view products.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const supabase = await createClient();

  const [{ data: products }, { data: categories }, { data: units }] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, name_en, name_ur, brand, tax_rate_bps, sale_price_paisa, current_stock, reorder_level, is_active, image_path, category:category_id(name), stock_unit:stock_unit_id(name)",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("categories")
      .select("id, name, parent_category_id")
      .eq("is_active", true)
      .order("name"),
    supabase.from("units").select("id, key, name").eq("is_active", true).order("name"),
  ]);

  const canManage = context.permissions.has("products.manage");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Products</h1>
          <p className="text-muted-foreground">Manage your product catalog.</p>
        </div>
        {canManage && (
          <ProductCreateDialog categories={categories ?? []} units={units ?? []} />
        )}
      </div>

      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead></TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Tax</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(products ?? []).map((product) => {
                const category = product.category as unknown as { name: string } | null;
                const stockUnit = product.stock_unit as unknown as { name: string } | null;
                const lowStock = product.reorder_level > 0 && product.current_stock <= product.reorder_level;

                return (
                  <TableRow key={product.id}>
                    <TableCell>
                      {product.image_path ? (
                        <Image
                          src={
                            supabase.storage.from("product-images").getPublicUrl(product.image_path)
                              .data.publicUrl
                          }
                          alt={product.name_en}
                          width={40}
                          height={40}
                          className="rounded object-cover"
                        />
                      ) : (
                        <div className="bg-muted h-10 w-10 rounded" />
                      )}
                    </TableCell>
                    <TableCell>
                      <div>{product.name_en}</div>
                      {product.name_ur && (
                        <div className="text-muted-foreground text-sm" dir="rtl">
                          {product.name_ur}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{category?.name ?? "-"}</TableCell>
                    <TableCell>{product.brand ?? "-"}</TableCell>
                    <TableCell>{formatPKR(product.sale_price_paisa)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span>
                          {product.current_stock} {stockUnit?.name}
                        </span>
                        {lowStock && <Badge variant="destructive">Low</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>{formatTaxRate(product.tax_rate_bps)}</TableCell>
                    <TableCell>
                      <Badge variant={product.is_active ? "secondary" : "outline"}>
                        {product.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              {(products ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground text-center">
                    No products yet.
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

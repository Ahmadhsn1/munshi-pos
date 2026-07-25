import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCurrentUserContext } from "@/lib/permissions";
import { formatPKR } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { ReturnVoidActions } from "./return-void-actions";

export default async function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getCurrentUserContext();

  if (!context) {
    redirect("/login");
  }

  if (!context.permissions.has("sales.return") && !context.permissions.has("sales.void")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sale</CardTitle>
          <CardDescription>
            Your role ({context.roleName}) doesn&apos;t have permission to view this sale.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const supabase = await createClient();

  const { data: sale } = await supabase
    .from("sales")
    .select("id, invoice_number, status, subtotal_paisa, tax_paisa, bill_discount_paisa, total_paisa, completed_at")
    .eq("id", id)
    .maybeSingle();

  if (!sale) {
    notFound();
  }

  const { data: lines } = await supabase
    .from("sale_line_items")
    .select("id, quantity, unit_price_paisa, tax_paisa, line_total_paisa, products:product_id(name_en)")
    .eq("sale_id", id);

  const { data: payments } = await supabase
    .from("sale_payments")
    .select("payment_mode, amount_paisa")
    .eq("sale_id", id);

  const { data: returnedLines } = await supabase
    .from("sale_return_line_items")
    .select("sale_line_item_id, quantity")
    .in("sale_line_item_id", (lines ?? []).map((l) => l.id));

  const returnedByLine = new Map<string, number>();
  for (const r of returnedLines ?? []) {
    returnedByLine.set(r.sale_line_item_id, (returnedByLine.get(r.sale_line_item_id) ?? 0) + r.quantity);
  }

  const linesWithRemaining = (lines ?? []).map((line) => ({
    id: line.id,
    productName: (line.products as unknown as { name_en: string } | null)?.name_en ?? "Product",
    quantity: line.quantity,
    unitPricePaisa: line.unit_price_paisa,
    taxPaisa: line.tax_paisa,
    lineTotalPaisa: line.line_total_paisa,
    remaining: line.quantity - (returnedByLine.get(line.id) ?? 0),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/pos/sales" className="text-muted-foreground text-sm hover:underline">
          ← Sales
        </Link>
        <h1 className="text-2xl font-semibold">Invoice {sale.invoice_number}</h1>
        <Badge variant={sale.status === "void" ? "destructive" : "secondary"}>{sale.status}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Unit price</TableHead>
                <TableHead>Line total</TableHead>
                <TableHead>Returnable</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linesWithRemaining.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>{line.productName}</TableCell>
                  <TableCell>{line.quantity}</TableCell>
                  <TableCell>{formatPKR(line.unitPricePaisa)}</TableCell>
                  <TableCell>{formatPKR(line.lineTotalPaisa)}</TableCell>
                  <TableCell>{line.remaining}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Total</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          <p>Subtotal: {formatPKR(sale.subtotal_paisa)}</p>
          {sale.bill_discount_paisa > 0 && <p>Bill discount: -{formatPKR(sale.bill_discount_paisa)}</p>}
          <p>Tax: {formatPKR(sale.tax_paisa)}</p>
          <p className="font-semibold">Total: {formatPKR(sale.total_paisa)}</p>
          <p className="text-muted-foreground">
            Paid via {(payments ?? []).map((p) => `${p.payment_mode} (${formatPKR(p.amount_paisa)})`).join(", ")}
          </p>
        </CardContent>
      </Card>

      {sale.status === "completed" && (
        <ReturnVoidActions
          saleId={sale.id}
          lines={linesWithRemaining}
          canReturn={context.permissions.has("sales.return")}
          canVoid={context.permissions.has("sales.void")}
        />
      )}
    </div>
  );
}

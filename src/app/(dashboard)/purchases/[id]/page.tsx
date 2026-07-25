import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCurrentUserContext } from "@/lib/permissions";
import { formatPKR } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { PurchaseActions } from "./receive-return-payment-actions";

export default async function PurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getCurrentUserContext();

  if (!context) {
    redirect("/login");
  }

  if (!context.permissions.has("purchases.manage")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Purchase</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  const showCost = context.permissions.has("cost_price.view");
  const supabase = await createClient();

  const { data: purchase } = await supabase
    .from("purchases")
    .select(
      "id, status, supplier_invoice_number, purchase_date, subtotal_paisa, discount_paisa, total_paisa, notes, suppliers:supplier_id(id, name)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!purchase) {
    notFound();
  }

  const { data: lines } = await supabase
    .from("purchase_line_items")
    .select(
      "id, batch_number, expiry_date, quantity, unit_cost_paisa, discount_paisa, is_free_goods, line_total_paisa, products:product_id(name_en, purchase_to_stock_factor, purchase_unit:purchase_unit_id(name))",
    )
    .eq("purchase_id", id);

  const lineIds = (lines ?? []).map((l) => l.id);

  const { data: receiptLines } =
    lineIds.length > 0
      ? await supabase
          .from("purchase_receipt_line_items")
          .select("purchase_line_item_id, quantity_received")
          .in("purchase_line_item_id", lineIds)
      : { data: [] };

  const { data: returnLines } =
    lineIds.length > 0
      ? await supabase
          .from("purchase_return_line_items")
          .select("purchase_line_item_id, quantity")
          .in("purchase_line_item_id", lineIds)
      : { data: [] };

  const receivedByLine = new Map<string, number>();
  for (const r of receiptLines ?? []) {
    receivedByLine.set(r.purchase_line_item_id, (receivedByLine.get(r.purchase_line_item_id) ?? 0) + r.quantity_received);
  }

  const returnedByLine = new Map<string, number>();
  for (const r of returnLines ?? []) {
    returnedByLine.set(r.purchase_line_item_id, (returnedByLine.get(r.purchase_line_item_id) ?? 0) + r.quantity);
  }

  const { data: payments } = await supabase
    .from("purchase_payments")
    .select("id, payment_mode, amount_paisa, paid_at, reference_text")
    .eq("purchase_id", id)
    .order("paid_at");

  const totalPaid = (payments ?? []).reduce((sum, p) => sum + p.amount_paisa, 0);

  const enrichedLines = (lines ?? []).map((line) => {
    const product = line.products as unknown as {
      name_en: string;
      purchase_to_stock_factor: number;
      purchase_unit: { name: string } | null;
    } | null;
    const factor = product?.purchase_to_stock_factor ?? 1;
    const invoicedStockUnits = line.quantity * factor;
    const receivedStockUnits = receivedByLine.get(line.id) ?? 0;
    const returnedStockUnits = returnedByLine.get(line.id) ?? 0;

    return {
      id: line.id,
      productName: product?.name_en ?? "Product",
      unitName: product?.purchase_unit?.name ?? "unit",
      batchNumber: line.batch_number,
      expiryDate: line.expiry_date,
      quantity: line.quantity,
      unitCostPaisa: line.unit_cost_paisa,
      discountPaisa: line.discount_paisa,
      isFreeGoods: line.is_free_goods,
      lineTotalPaisa: line.line_total_paisa,
      receivedStockUnits,
      remainingPurchaseUnits: Math.floor((invoicedStockUnits - receivedStockUnits) / factor),
      remainingReturnableStockUnits: receivedStockUnits - returnedStockUnits,
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/purchases" className="text-muted-foreground text-sm hover:underline">
          ← Purchases
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {purchase.supplier_invoice_number ?? `Purchase ${purchase.id.slice(0, 8)}`}
          </h1>
          <Badge variant="secondary">{purchase.status}</Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          <Link href={`/suppliers/${(purchase.suppliers as unknown as { id: string; name: string } | null)?.id}`} className="hover:underline">
            {(purchase.suppliers as unknown as { id: string; name: string } | null)?.name}
          </Link>{" "}
          · {purchase.purchase_date}
        </p>
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
                <TableHead>Batch</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead>Qty</TableHead>
                {showCost && <TableHead>Unit cost</TableHead>}
                {showCost && <TableHead>Discount</TableHead>}
                <TableHead>Received</TableHead>
                {showCost && <TableHead>Line total</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {enrichedLines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>
                    {line.productName} {line.isFreeGoods && <Badge variant="outline">Free</Badge>}
                  </TableCell>
                  <TableCell>{line.batchNumber ?? "-"}</TableCell>
                  <TableCell>{line.expiryDate ?? "-"}</TableCell>
                  <TableCell>
                    {line.quantity} {line.unitName}
                  </TableCell>
                  {showCost && <TableCell>{formatPKR(line.unitCostPaisa)}</TableCell>}
                  {showCost && <TableCell>{formatPKR(line.discountPaisa)}</TableCell>}
                  <TableCell>{line.receivedStockUnits} stock units</TableCell>
                  {showCost && <TableCell>{formatPKR(line.lineTotalPaisa)}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {showCost && (
        <Card>
          <CardHeader>
            <CardTitle>Total</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            <p>Subtotal: {formatPKR(purchase.subtotal_paisa)}</p>
            <p>Discount: -{formatPKR(purchase.discount_paisa)}</p>
            <p className="font-semibold">Total: {formatPKR(purchase.total_paisa)}</p>
            <p className="text-muted-foreground">
              Paid: {formatPKR(totalPaid)} · Outstanding: {formatPKR(purchase.total_paisa - totalPaid)}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <PurchaseActions
            purchaseId={purchase.id}
            status={purchase.status}
            canManage={context.permissions.has("purchases.manage")}
            receivableLines={enrichedLines.map((l) => ({
              purchaseLineItemId: l.id,
              productName: l.productName,
              unitName: l.unitName,
              remainingPurchaseUnits: l.remainingPurchaseUnits,
            }))}
            returnableLines={enrichedLines.map((l) => ({
              purchaseLineItemId: l.id,
              productName: l.productName,
              remainingStockUnits: l.remainingReturnableStockUnits,
            }))}
          />
        </CardContent>
      </Card>

      {(payments ?? []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Payments</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Reference</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(payments ?? []).map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell>{payment.paid_at}</TableCell>
                    <TableCell>{payment.payment_mode}</TableCell>
                    <TableCell>{formatPKR(payment.amount_paisa)}</TableCell>
                    <TableCell>{payment.reference_text ?? "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {purchase.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">{purchase.notes}</CardContent>
        </Card>
      )}
    </div>
  );
}

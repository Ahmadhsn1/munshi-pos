import Link from "next/link";

const REPORT_LINKS = [
  { href: "/reports/sales", label: "Sales & margin" },
  { href: "/reports/products", label: "Products" },
  { href: "/reports/cashiers", label: "Cashiers" },
  { href: "/reports/stock-valuation", label: "Stock valuation" },
  { href: "/reports/cash-book", label: "Cash book" },
];

export function ReportNav({ current }: { current: string }) {
  return (
    <div className="flex flex-wrap gap-2 border-b pb-3 text-sm">
      {REPORT_LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`rounded-md px-3 py-1.5 ${
            current === link.href ? "bg-foreground text-background" : "hover:bg-muted"
          }`}
        >
          {link.label}
        </Link>
      ))}
    </div>
  );
}

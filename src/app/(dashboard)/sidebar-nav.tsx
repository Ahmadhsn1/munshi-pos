"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboardIcon,
  ShoppingCartIcon,
  ReceiptIcon,
  UserCircleIcon,
  PackageIcon,
  TagIcon,
  LayersIcon,
  TruckIcon,
  Building2Icon,
  UsersIcon,
  ContactIcon,
  WalletIcon,
  BarChart3Icon,
  ShieldCheckIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** null means "anyone signed in" -- matches the permission-gating convention already used
   * throughout this app (see AGENTS.md's acting-identity notes). */
  permission: string | null;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

// Every href/permission pair here is byte-identical to the flat NAV_ITEMS list this replaces --
// this redesign only changes grouping and presentation, never who can see what. Grouped by what a
// shopkeeper actually does (sell, stock, buy, people, money) rather than a flat alphabetical-ish
// dump, which is the real fix for 14 items no longer fitting a single row.
const NAV_GROUPS: NavGroup[] = [
  {
    title: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboardIcon, permission: null }],
  },
  {
    title: "Sell",
    items: [
      { href: "/pos", label: "Sell", icon: ShoppingCartIcon, permission: "sales.create" },
      { href: "/pos/sales", label: "Sales", icon: ReceiptIcon, permission: "sales.create" },
      { href: "/counter", label: "Counter", icon: UserCircleIcon, permission: null },
    ],
  },
  {
    title: "Catalog",
    items: [
      { href: "/products", label: "Products", icon: PackageIcon, permission: "products.view" },
      { href: "/categories", label: "Categories", icon: TagIcon, permission: "products.manage" },
      { href: "/inventory", label: "Inventory", icon: LayersIcon, permission: "inventory.view" },
    ],
  },
  {
    title: "Purchasing",
    items: [
      { href: "/purchases", label: "Purchases", icon: TruckIcon, permission: "purchases.manage" },
      { href: "/suppliers", label: "Suppliers", icon: Building2Icon, permission: "suppliers.manage" },
    ],
  },
  {
    title: "People",
    items: [
      { href: "/customers", label: "Customers", icon: UsersIcon, permission: "customers.manage" },
      { href: "/staff", label: "Staff", icon: ContactIcon, permission: "users.manage" },
    ],
  },
  {
    title: "Money",
    items: [
      { href: "/expenses", label: "Expenses", icon: WalletIcon, permission: "expenses.manage" },
      { href: "/reports/sales", label: "Reports", icon: BarChart3Icon, permission: "reports.view" },
      { href: "/audit", label: "Audit log", icon: ShieldCheckIcon, permission: "audit.view" },
    ],
  },
];

export function SidebarNav({
  permissions,
  onNavigate,
}: {
  permissions: string[];
  /** Fired when a nav link is clicked -- used by the mobile menu to close itself on navigation,
   * since a Dialog-based mobile drawer otherwise stays open after the route already changed. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const permissionSet = new Set(permissions);

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.permission === null || permissionSet.has(item.permission)),
  })).filter((group) => group.items.length > 0);

  return (
    <nav className="flex flex-col gap-5">
      {visibleGroups.map((group) => (
        <div key={group.title} className="flex flex-col gap-0.5">
          <div className="text-ink-faint px-2.5 pb-1 text-[10.5px] font-semibold tracking-wider uppercase">
            {group.title}
          </div>
          {group.items.map((item) => {
            // /pos matching /pos/sales as a prefix would wrongly highlight "Sell" while on the
            // "Sales" list page (both start with /pos) -- exact match for the shorter path,
            // prefix match otherwise, is what keeps exactly one item active at a time.
            const isActive =
              pathname === item.href ||
              (item.href !== "/pos" && item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.3px] font-medium transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className={cn("size-4 shrink-0", isActive ? "text-accent-foreground" : "text-ink-faint")} />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

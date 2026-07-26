import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shared loading state for EVERY page under the (dashboard) route group -- Next.js's App Router
 * loading.tsx convention shows this as an instant fallback while a page's own async Server
 * Component data fetch is in flight, replacing what would otherwise be a frozen blank screen
 * during navigation. One file here covers all 14+ dashboard routes at once (plan.md Phase 7:
 * "loading states ... across every screen") rather than needing a bespoke skeleton per page --
 * appropriate for a polish pass, which explicitly isn't a redesign.
 *
 * Intentionally generic (a title-sized bar + a few content blocks) rather than mimicking each
 * page's exact layout -- a generic skeleton that ships everywhere beats a perfectly-matched one
 * that only covers a handful of pages.
 */
export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

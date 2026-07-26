"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Shared error boundary for EVERY page under the (dashboard) route group -- plan.md Phase 7:
 * "error states across every screen." Without this, any thrown error on any dashboard page (a
 * failed Supabase query, a bad response shape) fell through to Next.js's raw, unstyled default
 * error screen -- confusing and unbranded for a real shopkeeper who has no idea what a stack trace
 * means. Must be a Client Component; this is a Next.js App Router requirement for error.tsx, not a
 * choice made here.
 *
 * "Try again" calls reset(), which re-renders the segment and re-runs its data fetch -- the
 * correct recovery for a transient failure (a dropped connection, a momentary Supabase blip)
 * without a full page reload losing scroll position/form state elsewhere on the page.
 */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[dashboard error boundary]", error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Something went wrong</CardTitle>
          <CardDescription>
            This page hit an unexpected error. Your data is safe -- this is just a display problem.
            {error.digest && (
              <span className="mt-1 block font-mono text-xs opacity-60">Ref: {error.digest}</span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={reset}>Try again</Button>
        </CardContent>
      </Card>
    </div>
  );
}

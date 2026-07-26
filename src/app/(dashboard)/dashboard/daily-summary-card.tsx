"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buildWhatsAppDailySummaryUrl, type DailySummaryInput } from "@/lib/reports";

/**
 * Manual "send today's summary" -- plan.md Phase 6: "Daily WhatsApp sales summary (manual trigger
 * first, cron job later)". Fetches fresh numbers on click rather than using server-rendered ones
 * from page load, since an owner may open this card hours after the dashboard first loaded and
 * would otherwise share a stale count.
 */
export function DailySummaryCard() {
  const [loading, setLoading] = useState(false);

  async function handleSend() {
    setLoading(true);
    try {
      const res = await fetch("/api/reports/daily-summary");
      const data = (await res.json()) as DailySummaryInput | { error: string };

      if (!res.ok || "error" in data) {
        toast.error("error" in data ? data.error : "Failed to load today's summary");
        return;
      }

      // window.open, not a direct navigation -- keeps this dashboard tab intact if the owner
      // cancels out of WhatsApp's share sheet.
      window.open(buildWhatsAppDailySummaryUrl(data), "_blank", "noopener,noreferrer");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Today&apos;s summary</CardTitle>
        <CardDescription>Send a quick sales summary to WhatsApp.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={handleSend} disabled={loading}>
          {loading ? "Loading…" : "Send today's summary"}
        </Button>
      </CardContent>
    </Card>
  );
}

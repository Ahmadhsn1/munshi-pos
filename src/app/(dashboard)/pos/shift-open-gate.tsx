"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ShiftOpenGate() {
  const router = useRouter();
  const [openingCash, setOpeningCash] = useState("0");
  const [loading, setLoading] = useState(false);

  async function handleOpen(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);

    try {
      const res = await fetch("/api/pos/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openingCashPaisa: Math.round(Number(openingCash) * 100) || 0 }),
      });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error ?? "Failed to open shift");
        return;
      }

      toast.success("Shift opened");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex justify-center py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Open your shift</CardTitle>
          <CardDescription>Count the cash in your drawer before you start selling.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleOpen} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="openingCash">Opening cash (Rs)</Label>
              <Input
                id="openingCash"
                inputMode="decimal"
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={loading}>
              {loading ? "Opening..." : "Open shift"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

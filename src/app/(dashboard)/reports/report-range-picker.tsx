"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Date range control shared by every report screen. Pushes the range into the URL rather than
 * holding it in component state, so a shopkeeper can bookmark or share "last month's margin" and
 * the Server Component can read it directly without a client round trip.
 */
export function ReportRangePicker({
  basePath,
  from,
  to,
}: {
  basePath: string;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const [localFrom, setLocalFrom] = useState(from);
  const [localTo, setLocalTo] = useState(to);

  function apply() {
    router.push(`${basePath}?from=${localFrom}&to=${localTo}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="from">From</Label>
        <Input
          id="from"
          type="date"
          value={localFrom}
          onChange={(e) => setLocalFrom(e.target.value)}
          className="w-44"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="to">To</Label>
        <Input
          id="to"
          type="date"
          value={localTo}
          onChange={(e) => setLocalTo(e.target.value)}
          className="w-44"
        />
      </div>
      <Button onClick={apply} variant="outline">
        Apply
      </Button>
    </div>
  );
}

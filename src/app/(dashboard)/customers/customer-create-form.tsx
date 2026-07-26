"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CustomerCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [creditLimitRupees, setCreditLimitRupees] = useState("");
  const [priceTier, setPriceTier] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);

    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          phone: phone || undefined,
          creditLimitPaisa: creditLimitRupees ? Math.round(Number(creditLimitRupees) * 100) : null,
          priceTier: priceTier || undefined,
        }),
      });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error ?? "Failed to create customer");
        return;
      }

      toast.success(`${name} added`);
      setName("");
      setPhone("");
      setCreditLimitRupees("");
      setPriceTier("");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="flex flex-col gap-2">
        <Label htmlFor="customerName">Name</Label>
        <Input id="customerName" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="customerPhone">Phone</Label>
        <Input id="customerPhone" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="customerCreditLimit">Credit limit (Rs, blank = no limit)</Label>
        <Input
          id="customerCreditLimit"
          type="number"
          min={0}
          className="w-40"
          value={creditLimitRupees}
          onChange={(e) => setCreditLimitRupees(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="customerPriceTier">Price tier (optional)</Label>
        <Input
          id="customerPriceTier"
          className="w-32"
          value={priceTier}
          onChange={(e) => setPriceTier(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={loading} className="w-fit">
        {loading ? "Adding..." : "Add customer"}
      </Button>
    </form>
  );
}

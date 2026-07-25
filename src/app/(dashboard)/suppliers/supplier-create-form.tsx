"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SupplierCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [creditTermsDays, setCreditTermsDays] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);

    try {
      const res = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          phone: phone || undefined,
          address: address || undefined,
          creditTermsDays: creditTermsDays ? Number(creditTermsDays) : null,
        }),
      });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error ?? "Failed to create supplier");
        return;
      }

      toast.success(`${name} added`);
      setName("");
      setPhone("");
      setAddress("");
      setCreditTermsDays("");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="flex flex-col gap-2">
        <Label htmlFor="supplierName">Name</Label>
        <Input id="supplierName" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="supplierPhone">Phone</Label>
        <Input id="supplierPhone" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="supplierAddress">Address</Label>
        <Input id="supplierAddress" value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="supplierCreditTerms">Credit terms (days)</Label>
        <Input
          id="supplierCreditTerms"
          type="number"
          min={0}
          className="w-32"
          value={creditTermsDays}
          onChange={(e) => setCreditTermsDays(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={loading} className="w-fit">
        {loading ? "Adding..." : "Add supplier"}
      </Button>
    </form>
  );
}

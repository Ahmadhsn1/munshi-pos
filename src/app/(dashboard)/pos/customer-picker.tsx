"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Customer {
  id: string;
  name: string;
}

export function CustomerPicker({
  selected,
  onSelect,
}: {
  selected: Customer | null;
  onSelect: (customer: Customer | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    { id: string; name: string; phone: string | null; is_blacklisted: boolean }[]
  >([]);
  const [adding, setAdding] = useState(false);
  const [newPhone, setNewPhone] = useState("");

  async function search(q: string) {
    setQuery(q);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const res = await fetch(`/api/pos/customers/search?q=${encodeURIComponent(q)}`);
    const body = await res.json();
    setResults(body.customers ?? []);
  }

  async function quickAdd() {
    if (!query.trim()) return;

    const res = await fetch("/api/pos/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: query, phone: newPhone }),
    });
    const result = await res.json();

    if (!res.ok) {
      toast.error(result.error ?? "Failed to add customer");
      return;
    }

    onSelect(result.customer);
    setQuery("");
    setNewPhone("");
    setAdding(false);
    setResults([]);
  }

  if (selected) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span>
          Customer: <span className="font-medium">{selected.name}</span>
        </span>
        <Button variant="ghost" size="sm" onClick={() => onSelect(null)}>
          Clear
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <Input
          placeholder="Customer (for khata) -- optional"
          className="w-56"
          value={query}
          onChange={(e) => search(e.target.value)}
        />
        {query && !adding && (
          <Button type="button" variant="link" size="sm" onClick={() => setAdding(true)}>
            + New
          </Button>
        )}
      </div>
      {results.length > 0 && (
        <div className="flex flex-col gap-1 rounded border">
          {results.map((c) => (
            <button
              key={c.id}
              type="button"
              className="hover:bg-muted px-3 py-1 text-left text-sm"
              onClick={() => {
                onSelect({ id: c.id, name: c.name });
                setQuery("");
                setResults([]);
              }}
            >
              {c.name} {c.phone && <span className="text-muted-foreground">({c.phone})</span>}
              {c.is_blacklisted && (
                <span className="text-destructive ml-2 text-xs font-medium">Khata blocked</span>
              )}
            </button>
          ))}
        </div>
      )}
      {adding && (
        <div className="flex gap-2">
          <Input
            placeholder="Phone"
            className="w-40"
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
          />
          <Button type="button" size="sm" onClick={quickAdd}>
            Add {query}
          </Button>
        </div>
      )}
    </div>
  );
}

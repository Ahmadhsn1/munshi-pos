"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";

interface Supplier {
  id: string;
  name: string;
}

export function SupplierPicker({
  selected,
  onSelect,
}: {
  selected: Supplier | null;
  onSelect: (supplier: Supplier | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; phone: string | null }[]>([]);

  async function search(q: string) {
    setQuery(q);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const res = await fetch(`/api/suppliers/search?q=${encodeURIComponent(q)}`);
    const body = await res.json();
    setResults(body.suppliers ?? []);
  }

  if (selected) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span>
          Supplier: <span className="font-medium">{selected.name}</span>
        </span>
        <button type="button" className="text-muted-foreground hover:underline" onClick={() => onSelect(null)}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Input placeholder="Search supplier..." className="w-64" value={query} onChange={(e) => search(e.target.value)} />
      {results.length > 0 && (
        <div className="flex flex-col gap-1 rounded border">
          {results.map((s) => (
            <button
              key={s.id}
              type="button"
              className="hover:bg-muted px-3 py-1 text-left text-sm"
              onClick={() => {
                onSelect({ id: s.id, name: s.name });
                setQuery("");
                setResults([]);
              }}
            >
              {s.name} {s.phone && <span className="text-muted-foreground">({s.phone})</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

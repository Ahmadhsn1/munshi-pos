"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TopLevelCategory {
  id: string;
  name: string;
}

export function CategoryCreateForm({ topLevelCategories }: { topLevelCategories: TopLevelCategory[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [parentCategoryId, setParentCategoryId] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);

    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parentCategoryId: parentCategoryId || null }),
      });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error ?? "Failed to create category");
        return;
      }

      toast.success(`${name} added`);
      setName("");
      setParentCategoryId("");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 sm:flex-row sm:items-end">
      <div className="flex flex-col gap-2">
        <Label htmlFor="categoryName">Name</Label>
        <Input id="categoryName" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label>Parent (optional, for a subcategory)</Label>
        <Select
          items={Object.fromEntries(topLevelCategories.map((c) => [c.id, c.name]))}
          value={parentCategoryId}
          onValueChange={(value) => setParentCategoryId(value ?? "")}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Top-level category" />
          </SelectTrigger>
          <SelectContent>
            {topLevelCategories.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={loading} className="w-fit">
        {loading ? "Adding..." : "Add category"}
      </Button>
    </form>
  );
}

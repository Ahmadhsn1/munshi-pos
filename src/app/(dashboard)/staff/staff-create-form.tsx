"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type RoleKey = "manager" | "cashier";

export function StaffCreateForm() {
  const router = useRouter();
  const [roleKey, setRoleKey] = useState<RoleKey>("cashier");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);

    const body =
      roleKey === "manager"
        ? { roleKey, fullName, phone, email, password, pin: pin || undefined }
        : { roleKey, fullName, phone, pin };

    try {
      const res = await fetch("/api/auth/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error ?? "Failed to add staff member");
        return;
      }

      toast.success(`${fullName} added as ${roleKey}`);
      setFullName("");
      setPhone("");
      setEmail("");
      setPassword("");
      setPin("");
      router.refresh();
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Button
          type="button"
          variant={roleKey === "cashier" ? "default" : "outline"}
          size="sm"
          onClick={() => setRoleKey("cashier")}
        >
          Cashier
        </Button>
        <Button
          type="button"
          variant={roleKey === "manager" ? "default" : "outline"}
          size="sm"
          onClick={() => setRoleKey("manager")}
        >
          Manager
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="fullName">Full name</Label>
          <Input id="fullName" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="phone">Phone (optional)</Label>
          <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>

        {roleKey === "manager" && (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Temporary password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="pin">
            {roleKey === "cashier" ? "Counter PIN" : "Counter PIN (optional)"}
          </Label>
          <Input
            id="pin"
            inputMode="numeric"
            required={roleKey === "cashier"}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            placeholder="4-6 digits"
            maxLength={6}
          />
        </div>
      </div>

      <Button type="submit" disabled={loading} className="w-fit">
        {loading ? "Adding..." : "Add staff member"}
      </Button>
    </form>
  );
}

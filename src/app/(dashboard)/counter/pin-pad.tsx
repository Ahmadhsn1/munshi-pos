"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface StaffOption {
  id: string;
  fullName: string;
  roleName: string;
}

interface ActiveCounterSession {
  fullName: string;
  roleName: string;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"];

export function CounterPinPad({ staff }: { staff: StaffOption[] }) {
  const [selected, setSelected] = useState<StaffOption | null>(null);
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<ActiveCounterSession | null>(null);

  async function handleLogout() {
    await fetch("/api/auth/counter-logout", { method: "POST" });
    setActive(null);
    setSelected(null);
    setPin("");
    toast.success("Switched off the counter");
  }

  async function submitPin(candidateStaff: StaffOption, candidatePin: string) {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/counter-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: candidateStaff.id, pin: candidatePin }),
      });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error ?? "Login failed");
        setPin("");
        return;
      }

      setActive({ fullName: result.fullName, roleName: result.roleKey });
      toast.success(`Counter active for ${result.fullName}`);
    } catch {
      toast.error("Network error. Please try again.");
      setPin("");
    } finally {
      setLoading(false);
    }
  }

  function handleKey(key: string) {
    if (!selected || loading) return;

    if (key === "back") {
      setPin((prev) => prev.slice(0, -1));
      return;
    }

    if (key === "") return;

    const next = (pin + key).slice(0, 6);
    setPin(next);

    if (next.length >= 4 && next.length === 4) {
      // Give a beat in case the shop uses 6-digit PINs -- don't auto-submit at 4 digits, only
      // explicit submit or hitting 6 digits.
    }

    if (next.length === 6) {
      submitPin(selected, next);
    }
  }

  if (active) {
    return (
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        <div>
          <p className="text-lg font-medium">{active.fullName}</p>
          <p className="text-muted-foreground text-sm capitalize">{active.roleName} at the counter</p>
        </div>
        <Button variant="outline" onClick={handleLogout}>
          Switch off counter
        </Button>
      </div>
    );
  }

  if (!selected) {
    return (
      <div className="grid grid-cols-2 gap-2">
        {staff.length === 0 && (
          <p className="text-muted-foreground col-span-2 text-sm">
            No staff have a PIN set yet. Add one from the Staff page.
          </p>
        )}
        {staff.map((member) => (
          <Button
            key={member.id}
            variant="outline"
            className="h-16 flex-col"
            onClick={() => {
              setSelected(member);
              setPin("");
            }}
          >
            <span>{member.fullName}</span>
            <span className="text-muted-foreground text-xs">{member.roleName}</span>
          </Button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div>
        <p className="text-center font-medium">{selected.fullName}</p>
        <div className="mt-2 flex justify-center gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <span
              key={i}
              className={`h-3 w-3 rounded-full border ${i < pin.length ? "bg-foreground" : ""}`}
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((key, i) => (
          <Button
            key={i}
            type="button"
            variant={key === "" ? "ghost" : "outline"}
            disabled={key === "" || loading}
            className="h-14 w-14 text-lg"
            onClick={() => handleKey(key)}
          >
            {key === "back" ? "⌫" : key}
          </Button>
        ))}
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pin.length < 4 || loading}
          onClick={() => submitPin(selected, pin)}
        >
          {loading ? "Checking..." : "Submit"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setSelected(null);
            setPin("");
          }}
        >
          Not you?
        </Button>
      </div>
    </div>
  );
}

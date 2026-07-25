"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function SignupPage() {
  const router = useRouter();
  const [tenantName, setTenantName] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [ownerFullName, setOwnerFullName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantName,
          tenantSlug,
          ownerFullName,
          ownerEmail,
          ownerPhone,
          password,
        }),
      });

      const body = await res.json();

      if (!res.ok) {
        toast.error(body.error ?? "Something went wrong");
        setLoading(false);
        return;
      }

      // The route created the account server-side with the service role -- signing in here,
      // browser-side, is what actually establishes the session cookies for this device.
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: ownerEmail,
        password,
      });

      if (signInError) {
        toast.error("Account created, but sign-in failed. Please log in.");
        router.push("/login");
        return;
      }

      toast.success("Shop created!");
      router.push("/dashboard");
      router.refresh();
    } catch {
      toast.error("Network error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Set up your shop</CardTitle>
          <CardDescription>Create your shop account and owner login.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="tenantName">Shop name</Label>
              <Input
                id="tenantName"
                required
                value={tenantName}
                onChange={(e) => {
                  setTenantName(e.target.value);
                  if (!slugTouched) setTenantSlug(slugify(e.target.value));
                }}
                placeholder="Al-Madina Kiryana Store"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="tenantSlug">Shop URL</Label>
              <Input
                id="tenantSlug"
                required
                value={tenantSlug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setTenantSlug(slugify(e.target.value));
                }}
                placeholder="al-madina-store"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="ownerFullName">Your full name</Label>
              <Input
                id="ownerFullName"
                required
                value={ownerFullName}
                onChange={(e) => setOwnerFullName(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="ownerEmail">Email</Label>
              <Input
                id="ownerEmail"
                type="email"
                required
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="ownerPhone">Phone (optional)</Label>
              <Input
                id="ownerPhone"
                type="tel"
                value={ownerPhone}
                onChange={(e) => setOwnerPhone(e.target.value)}
                placeholder="03xx-xxxxxxx"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <Button type="submit" disabled={loading} className="mt-2">
              {loading ? "Creating..." : "Create shop"}
            </Button>
          </form>

          <p className="text-muted-foreground mt-4 text-center text-sm">
            Already have an account?{" "}
            <Link href="/login" className="underline">
              Log in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

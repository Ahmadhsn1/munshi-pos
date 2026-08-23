"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Channel = "in_app" | "email" | "whatsapp";
type TemplateKey = "subscription_suspended" | "subscription_reactivated" | "trial_ending_reminder" | "custom";

const CHANNEL_LABEL: Record<Channel, string> = {
  in_app: "In-app",
  email: "Email",
  whatsapp: "WhatsApp",
};

const TEMPLATE_LABEL: Record<TemplateKey, string> = {
  subscription_suspended: "Subscription suspended",
  subscription_reactivated: "Subscription reactivated",
  trial_ending_reminder: "Trial ending reminder",
  custom: "Custom message",
};

/**
 * Channel availability is computed server-side (whether RESEND_API_KEY / WHATSAPP_CLOUD_API_TOKEN
 * are set) and passed down as props -- the client never gets to decide what's "configured", it
 * only decides what to select among what's actually available.
 */
export function NotifyForm({
  tenantId,
  availableChannels,
}: {
  tenantId: string;
  availableChannels: Record<Channel, boolean>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Channel[]>(["in_app"]);
  const [templateKey, setTemplateKey] = useState<TemplateKey>("custom");
  const [customSubject, setCustomSubject] = useState("");
  const [customBody, setCustomBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastResults, setLastResults] = useState<{ channel: Channel; status: string; error?: string }[] | null>(null);

  function toggleChannel(channel: Channel) {
    setSelected((prev) => (prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel]));
  }

  async function handleSend() {
    if (selected.length === 0) {
      toast.error("Pick at least one channel");
      return;
    }
    if (templateKey === "custom" && !customBody.trim()) {
      toast.error("Write a message");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channels: selected,
          templateKey,
          customSubject: customSubject.trim() || undefined,
          customBody: customBody.trim() || undefined,
        }),
      });
      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error ?? "Failed to send");
        return;
      }

      setLastResults(result.results);
      toast.success("Sent");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label>Template</Label>
        <Select value={templateKey} onValueChange={(v) => setTemplateKey((v as TemplateKey) ?? "custom")}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(TEMPLATE_LABEL).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {templateKey === "custom" && (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="customSubject">Subject</Label>
            <Input id="customSubject" value={customSubject} onChange={(e) => setCustomSubject(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="customBody">Message</Label>
            <Textarea id="customBody" value={customBody} onChange={(e) => setCustomBody(e.target.value)} rows={4} />
          </div>
        </>
      )}

      <div className="flex flex-col gap-2">
        <Label>Channels</Label>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(CHANNEL_LABEL) as Channel[]).map((channel) => {
            const isAvailable = availableChannels[channel];
            const isSelected = selected.includes(channel);
            return (
              <Button
                key={channel}
                type="button"
                size="sm"
                variant={isSelected ? "default" : "outline"}
                disabled={!isAvailable}
                onClick={() => toggleChannel(channel)}
                title={isAvailable ? undefined : "Not configured yet"}
              >
                {CHANNEL_LABEL[channel]}
                {!isAvailable && " (not configured)"}
              </Button>
            );
          })}
        </div>
      </div>

      <Button onClick={handleSend} disabled={loading} className="self-start">
        {loading ? "Sending…" : "Send notification"}
      </Button>

      {lastResults && (
        <div className="text-muted-foreground flex flex-col gap-1 text-xs">
          {lastResults.map((r) => (
            <span key={r.channel}>
              {CHANNEL_LABEL[r.channel]}: {r.status}
              {r.error ? ` (${r.error})` : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

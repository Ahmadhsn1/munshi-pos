import type { NotificationSendParams, NotificationSendResult, NotificationSender } from "../types";

const RESEND_API_URL = "https://api.resend.com/emails";

/**
 * Email channel via Resend's HTTP API directly (no SDK dependency -- a single POST is simpler
 * than adding a package for it). Skipped, not attempted, when RESEND_API_KEY/RESEND_FROM_EMAIL
 * aren't set -- same defensive posture as every other optional integration in this app (see
 * NEXT_PUBLIC_SUPPORT_WHATSAPP in trial-banner.tsx).
 *
 * `to` is resolved by the caller (see send-notification.ts) from the tenant's owner contact email
 * -- this module only knows how to send, not who to send to.
 */
export function createEmailSender(to: string | null): NotificationSender {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;

  return {
    channel: "email",
    isConfigured: () => Boolean(apiKey && from && to),

    async send(params: NotificationSendParams): Promise<NotificationSendResult> {
      if (!apiKey || !from) {
        return { status: "skipped", error: "RESEND_API_KEY/RESEND_FROM_EMAIL not configured" };
      }
      if (!to) {
        return { status: "skipped", error: "tenant has no owner email on file" };
      }

      const response = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to,
          subject: params.subject,
          text: params.body,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        return { status: "failed", error: `Resend ${response.status}: ${errorBody.slice(0, 200)}` };
      }

      return { status: "sent" };
    },
  };
}

import type { NotificationSendParams, NotificationSendResult, NotificationSender } from "../types";

/**
 * WhatsApp Business Cloud API stub. Needs Meta Business verification, which isn't achievable
 * same-day -- so this is wired up and selectable in the admin UI, but always skips until
 * WHATSAPP_CLOUD_API_TOKEN/WHATSAPP_CLOUD_API_PHONE_NUMBER_ID are set. Left as a real channel
 * (not deleted) precisely so turning it on later is filling in env vars, not writing new code.
 */
export function createWhatsAppSender(to: string | null): NotificationSender {
  const token = process.env.WHATSAPP_CLOUD_API_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_CLOUD_API_PHONE_NUMBER_ID;

  return {
    channel: "whatsapp",
    isConfigured: () => Boolean(token && phoneNumberId && to),

    async send(_params: NotificationSendParams): Promise<NotificationSendResult> {
      if (!token || !phoneNumberId) {
        return { status: "skipped", error: "WhatsApp Business Cloud API not configured" };
      }
      if (!to) {
        return { status: "skipped", error: "tenant has no owner phone on file" };
      }
      // Not implemented yet -- configuring the env vars above is not, by itself, enough (Meta
      // Business verification + an approved message template are also required). Fails closed
      // rather than silently pretending to send.
      return { status: "skipped", error: "WhatsApp sending not yet implemented" };
    },
  };
}

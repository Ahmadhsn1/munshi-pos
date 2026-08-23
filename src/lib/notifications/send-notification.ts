import type { SupabaseClient } from "@supabase/supabase-js";
import { createInAppSender } from "./channels/in-app";
import { createEmailSender } from "./channels/email";
import { createWhatsAppSender } from "./channels/whatsapp";
import { renderNotificationTemplate, type NotificationTemplateData, type NotificationTemplateKey } from "./templates";
import type { NotificationChannel, NotificationSendResult } from "./types";

export interface SendNotificationParams {
  tenantId: string;
  channels: NotificationChannel[];
  templateKey: NotificationTemplateKey;
  templateData: NotificationTemplateData;
  sentByAdminId: string;
}

export interface SendNotificationChannelResult extends NotificationSendResult {
  channel: NotificationChannel;
}

/**
 * Dispatches a notification through every requested channel and records one notification_log row
 * per channel with its real outcome. Deliberately returns the per-channel results to the caller,
 * unlike lib/audit.ts#writeAuditLog's fire-and-forget silence -- a notification send IS the
 * primary action here (the admin clicking "Send" needs to see which channels actually went
 * through), not a side effect of something else that must never be blocked by a logging failure.
 */
export async function sendNotification(
  admin: SupabaseClient,
  params: SendNotificationParams,
): Promise<SendNotificationChannelResult[]> {
  const { tenantId, channels, templateKey, templateData, sentByAdminId } = params;

  // roles is a small global catalog (owner/manager/cashier) -- resolving the owner's role_id first
  // avoids relying on supabase-js's embedded-resource filtering (which needs a `!inner` join hint
  // to filter on a joined column, unlike a plain left-embed), keeping this a straightforward
  // two-query lookup instead.
  const { data: ownerRole } = await admin.from("roles").select("id").eq("key", "owner").single();
  const { data: owner } = ownerRole
    ? await admin
        .from("users")
        .select("email, phone")
        .eq("tenant_id", tenantId)
        .eq("role_id", ownerRole.id)
        .maybeSingle()
    : { data: null };

  const { subject, body } = renderNotificationTemplate(templateKey, templateData);

  const senders = {
    in_app: createInAppSender(admin),
    email: createEmailSender(owner?.email ?? null),
    whatsapp: createWhatsAppSender(owner?.phone ?? null),
  };

  const results: SendNotificationChannelResult[] = [];

  for (const channel of channels) {
    const sender = senders[channel];
    const result = await sender.send({ tenantId, tenantName: templateData.tenantName, subject, body });

    const { error } = await admin.from("notification_log").insert({
      tenant_id: tenantId,
      channel,
      template_key: templateKey,
      status: result.status,
      error_message: result.error ?? null,
      sent_by_admin_id: sentByAdminId,
      payload: { subject, body },
    });

    if (error) {
      console.error(`[notification_log] failed to record ${channel} send for tenant ${tenantId}: ${error.message}`);
    }

    results.push({ channel, ...result });
  }

  return results;
}

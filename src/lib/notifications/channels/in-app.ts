import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotificationSendParams, NotificationSendResult, NotificationSender } from "../types";

/** Always available -- no external credential, writes directly to in_app_notifications. */
export function createInAppSender(admin: SupabaseClient): NotificationSender {
  return {
    channel: "in_app",
    isConfigured: () => true,
    async send(params: NotificationSendParams): Promise<NotificationSendResult> {
      const { error } = await admin.from("in_app_notifications").insert({
        tenant_id: params.tenantId,
        title: params.subject,
        body: params.body,
      });

      if (error) {
        return { status: "failed", error: error.message };
      }
      return { status: "sent" };
    },
  };
}

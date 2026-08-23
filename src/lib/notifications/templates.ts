export type NotificationTemplateKey =
  | "subscription_suspended"
  | "subscription_reactivated"
  | "trial_ending_reminder"
  | "custom";

export interface NotificationTemplateData {
  tenantName: string;
  reason?: string;
  daysRemaining?: number;
  customSubject?: string;
  customBody?: string;
}

/** Small keyed templates -- {subject, body} pairs with simple variable interpolation. */
export function renderNotificationTemplate(
  templateKey: NotificationTemplateKey,
  data: NotificationTemplateData,
): { subject: string; body: string } {
  switch (templateKey) {
    case "subscription_suspended":
      return {
        subject: `${data.tenantName} -- your account has been suspended`,
        body: data.reason
          ? `Your subscription has been suspended: ${data.reason}. Please contact us to restore access.`
          : "Your subscription has been suspended. Please contact us to restore access.",
      };
    case "subscription_reactivated":
      return {
        subject: `${data.tenantName} -- your account is active again`,
        body: "Your subscription has been reactivated. You can sign back in and pick up right where you left off.",
      };
    case "trial_ending_reminder":
      return {
        subject: `${data.tenantName} -- your trial is ending soon`,
        body: `Your trial ends in ${data.daysRemaining ?? 0} day${data.daysRemaining === 1 ? "" : "s"}. Subscribe to keep using the app without interruption.`,
      };
    case "custom":
      return {
        subject: data.customSubject ?? `A message from ${data.tenantName}'s platform admin`,
        body: data.customBody ?? "",
      };
  }
}

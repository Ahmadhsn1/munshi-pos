export type NotificationChannel = "in_app" | "email" | "whatsapp";

export type NotificationSendStatus = "sent" | "failed" | "skipped";

export interface NotificationSendResult {
  status: NotificationSendStatus;
  error?: string;
}

export interface NotificationSendParams {
  tenantId: string;
  /** Shop name, used by channel senders that need a greeting/subject line. */
  tenantName: string;
  subject: string;
  body: string;
}

export interface NotificationSender {
  channel: NotificationChannel;
  /** Whether this channel has the credentials it needs to actually attempt a send right now. */
  isConfigured(): boolean;
  send(params: NotificationSendParams): Promise<NotificationSendResult>;
}

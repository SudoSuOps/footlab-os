export type SmsDeliveryState = "queued" | "sent" | "delivered" | "failed";

export interface SendSmsInput {
  to: string;
  body: string;
  statusCallbackUrl?: string;
}

export interface SendSmsResult {
  providerMessageId: string;
  state: SmsDeliveryState;
}

export interface SmsProvider {
  send(input: SendSmsInput): Promise<SendSmsResult>;
}

import type { SendSmsInput, SendSmsResult, SmsProvider } from "./index";

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber?: string;
  messagingServiceSid?: string;
}

export class TwilioSmsProvider implements SmsProvider {
  constructor(private readonly config: TwilioConfig) {
    if (!config.fromNumber && !config.messagingServiceSid) {
      throw new Error("Twilio requires either fromNumber or messagingServiceSid");
    }
  }

  async send(input: SendSmsInput): Promise<SendSmsResult> {
    const url =
      `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`;

    const form = new URLSearchParams({
      To: input.to,
      Body: input.body,
    });

    if (this.config.messagingServiceSid) {
      form.set("MessagingServiceSid", this.config.messagingServiceSid);
    } else {
      form.set("From", this.config.fromNumber!);
    }

    if (input.statusCallbackUrl) {
      form.set("StatusCallback", input.statusCallbackUrl);
    }

    const auth = Buffer.from(
      `${this.config.accountSid}:${this.config.authToken}`,
    ).toString("base64");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });

    const payload = await response.json() as {
      sid?: string;
      status?: string;
      message?: string;
    };

    if (!response.ok || !payload.sid) {
      throw new Error(payload.message ?? `Twilio send failed: ${response.status}`);
    }

    return {
      providerMessageId: payload.sid,
      state: payload.status === "sent" ? "sent" : "queued",
    };
  }
}

import { Resend } from "resend";

export interface EmailProvider {
  sendConfirmation(to: string, subject: string, text: string): Promise<boolean>;
}

export function createResendProvider(apiKey: string): EmailProvider {
  const resend = new Resend(apiKey);

  return {
    async sendConfirmation(to: string, subject: string, text: string): Promise<boolean> {
      try {
        await resend.emails.send({
          from: "Pure Life Ministries Brasil <contato@purelifebrasil.org>",
          to,
          subject,
          text,
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}

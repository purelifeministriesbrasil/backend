export type WebhookClaimResult =
  | { kind: "claimed" }
  | { kind: "already_processed" }
  | { kind: "currently_processing" }
  | { kind: "resumed" }
  | { kind: "dead_letter" };

export interface EventIdempotencyRepository {
  claimOrResume(input: {
    provider: "asaas" | "mercadopago";
    eventId: string;
    eventType: string;
    signatureOk: boolean;
    now: Date;
    leaseSeconds: number;
    maxAttempts: number;
  }): Promise<WebhookClaimResult>;

  markProcessed(provider: string, eventId: string, chargeId: string | null): Promise<void>;
  markIgnored(provider: string, eventId: string, reason: string): Promise<void>;
  markFailed(provider: string, eventId: string, errorCode: string): Promise<void>;
}

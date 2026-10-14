import type { ChargeStatus } from "../../domains/donations/state-machine.js";
import type { PaymentProviderName } from "./payment-gateway.js";

export interface StoredCharge {
  chargeId: string;
  provider: PaymentProviderName;
  providerChargeId: string;
  amountCents: number;
  status: ChargeStatus;
  pixCopyPaste: string | null;
  expiresAt: Date | null;
}

export interface DonationIntentRecord {
  intentId: string;
  amountCents: number;
  frequency: "one_time" | "monthly";
  created: boolean;
  /** Cobrança já emitida para esta intenção (retentativa com a mesma Idempotency-Key). */
  existingCharge: StoredCharge | null;
}

export interface DonationRepository {
  /** Cria a intenção pela `idempotencyKey` ou devolve a existente com sua cobrança, se houver. */
  findOrCreateIntent(input: {
    idempotencyKey: string;
    amountCents: number;
    frequency: "one_time" | "monthly";
    donorEmail?: string;
  }): Promise<DonationIntentRecord>;

  /** Grava a 1ª cobrança da intenção; em corrida concorrente devolve a que venceu. */
  saveFirstCharge(input: {
    intentId: string;
    provider: PaymentProviderName;
    providerChargeId: string;
    amountCents: number;
    pixCopyPaste: string;
    expiresAt: Date;
  }): Promise<StoredCharge>;
}

export interface ChargeRepository {
  findByProviderChargeId(
    provider: string,
    providerChargeId: string
  ): Promise<{ id: string; status: ChargeStatus; amountCents: number } | null>;
  /**
   * Transição condicional (`WHERE status = from`): dois eventos concorrentes não regridem o estado.
   * Retorna `false` se o estado mudou entre a leitura e a escrita.
   */
  transitionStatus(chargeId: string, from: ChargeStatus, to: ChargeStatus, at: Date): Promise<boolean>;
  recordAudit(action: string, entityId: string, metadata: Record<string, unknown>): Promise<void>;
}

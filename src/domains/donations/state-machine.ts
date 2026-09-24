/**
 * Payment Charge State Machine (§8.4)
 * Strict transitions: 'failed' is terminal (new attempt is a new charge under the same intent).
 */
export type ChargeStatus =
  | "pending"
  | "confirmed"
  | "failed"
  | "refunded"
  | "cancelled"
  | "expired";

const TRANSITIONS: Record<ChargeStatus, readonly ChargeStatus[]> = {
  pending: ["confirmed", "failed", "cancelled", "expired"],
  expired: ["confirmed"], // Pix pago após a expiração nominal
  confirmed: ["refunded"],
  failed: [], // terminal: nova tentativa é uma nova charge
  cancelled: [],
  refunded: [],
} as const;

export function canTransition(from: ChargeStatus, to: ChargeStatus): boolean {
  const allowed = TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

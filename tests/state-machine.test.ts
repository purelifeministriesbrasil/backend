import { describe, it, expect } from "vitest";
import { canTransition, type ChargeStatus } from "../src/domains/donations/state-machine.js";

describe("Payment Charge State Machine (§8.4)", () => {
  it("allows valid transitions from 'pending'", () => {
    expect(canTransition("pending", "confirmed")).toBe(true);
    expect(canTransition("pending", "failed")).toBe(true);
    expect(canTransition("pending", "cancelled")).toBe(true);
    expect(canTransition("pending", "expired")).toBe(true);
    expect(canTransition("pending", "refunded")).toBe(false);
  });

  it("allows 'expired' to be confirmed when nominal late Pix is credited", () => {
    expect(canTransition("expired", "confirmed")).toBe(true);
    expect(canTransition("expired", "failed")).toBe(false);
  });

  it("allows 'confirmed' to transition only to 'refunded'", () => {
    expect(canTransition("confirmed", "refunded")).toBe(true);
    expect(canTransition("confirmed", "pending")).toBe(false);
    expect(canTransition("confirmed", "failed")).toBe(false);
  });

  it("enforces that 'failed' is strictly terminal (correction of P0 v4)", () => {
    const statuses: ChargeStatus[] = [
      "pending",
      "confirmed",
      "failed",
      "refunded",
      "cancelled",
      "expired",
    ];

    for (const target of statuses) {
      expect(canTransition("failed", target)).toBe(false);
    }
  });

  it("enforces that 'cancelled' and 'refunded' are terminal", () => {
    expect(canTransition("cancelled", "pending")).toBe(false);
    expect(canTransition("cancelled", "confirmed")).toBe(false);
    expect(canTransition("refunded", "confirmed")).toBe(false);
    expect(canTransition("refunded", "pending")).toBe(false);
  });
});

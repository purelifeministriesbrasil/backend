import type { PaymentGateway } from "../../application/ports/payment-gateway.js";
import type { PaymentConfig } from "../config/env.js";
import { createAsaasGateway } from "./asaas.js";
import { createMercadoPagoGateway } from "./mercadopago.js";

/** Seleciona o gateway ativo por `PAYMENT_PROVIDER` (a configuração já foi validada fail-closed). */
export function createPaymentGateway(config: PaymentConfig): PaymentGateway {
  return config.provider === "asaas" ? createAsaasGateway(config) : createMercadoPagoGateway(config);
}

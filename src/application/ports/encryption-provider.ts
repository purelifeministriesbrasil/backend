export interface EncryptedPayload {
  ciphertext: string; // base64
  iv: string; // base64, 12 bytes, único por mensagem
  keyVersion: number;
  algorithm: "AES-256-GCM";
}

export interface EncryptionContext {
  entityType: "triage_submission" | "contact_submission" | "donation_intent" | "newsletter";
  entityId: string;
  field: "contact" | "report" | "message" | "email";
  keyVersion: number;
}

export interface EncryptionProvider {
  encrypt(plaintext: string, context: Omit<EncryptionContext, "keyVersion">): Promise<EncryptedPayload>;
  decrypt(payload: EncryptedPayload, context: Omit<EncryptionContext, "keyVersion">): Promise<string>;
}

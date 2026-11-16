// Server-only module.
/**
 * KycProvider: identity verification for boosters (gates payouts in Phase 7).
 * Only a mock exists: it returns a reference and the admin records the
 * outcome by hand. A real provider (Sumsub, Persona, Stripe Identity) comes
 * in Phase 10 behind this interface; only status + reference are stored,
 * never documents.
 */
import { randomUUID } from "node:crypto";

export interface KycSession {
  provider: "mock" | "sumsub" | "persona" | "stripe_identity";
  reference: string;
  /** Where the booster completes verification (null for the mock). */
  url: string | null;
}

export interface KycProvider {
  readonly kind: KycSession["provider"];
  startVerification(userId: string): Promise<KycSession>;
}

export class MockKycProvider implements KycProvider {
  readonly kind = "mock" as const;
  async startVerification(): Promise<KycSession> {
    return { provider: "mock", reference: `mock_${randomUUID()}`, url: null };
  }
}

export function getKycProvider(): KycProvider {
  return new MockKycProvider();
}

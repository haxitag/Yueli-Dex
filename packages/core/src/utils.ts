import { createHash, randomUUID } from "node:crypto";

/**
 * Generate a deterministic decision ID. Not a secret; used for correlation.
 */
export function generateDecisionId(): string {
  return `dex_${randomUUID()}`;
}

/**
 * Compute a stable hash of a ChoiceRequest for correlation and idempotency.
 * Uses SHA-256 of the canonical JSON.
 */
export function hashRequest(request: unknown): string {
  const canonical = JSON.stringify(request, Object.keys(request as object).sort());
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

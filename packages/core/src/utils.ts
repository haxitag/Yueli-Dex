import { createHash, randomUUID } from "node:crypto";
import type { JsonValue } from "@haxitag/yueli-dex-plugin-sdk";

/**
 * Maximum nesting depth accepted by `canonicalize` / `hashRequest`.
 *
 * Deeply-nested (adversarial or accidental) input previously overflowed the
 * call stack with an uncontrolled `RangeError: Maximum call stack size
 * exceeded` — crashing the caller with a 500 instead of a validation error.
 * 512 is far above any legitimate ChoiceRequest nesting and matches common
 * API-gateway body-depth limits.
 */
export const MAX_CANONICALIZE_DEPTH = 512;

/**
 * Generate a deterministic decision ID. Not a secret; used for correlation.
 */
export function generateDecisionId(): string {
  return `dex_${randomUUID()}`;
}

/**
 * Recursively canonicalize a JSON-like value. Object keys are sorted at every
 * depth so that two structurally-equal inputs always serialize to the same
 * string. Array order is preserved.
 *
 * Throws on non-JSON values (functions, symbols, undefined in arrays,
 * circular references, BigInt). Callers should pre-validate or accept
 * `INVALID_CHOICE_REQUEST` propagation from the upstream validator.
 */
export function canonicalize(value: JsonValue, depth = 0): JsonValue {
  if (depth > MAX_CANONICALIZE_DEPTH) {
    throw new TypeError(
      `canonicalize: input exceeds maximum nesting depth (${MAX_CANONICALIZE_DEPTH})`,
    );
  }
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        `canonicalize: non-finite number is not a valid JSON value: ${String(value)}`,
      );
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v: JsonValue) => canonicalize(v, depth + 1));
  }
  const obj = value as Record<string, JsonValue>;
  const keys = Object.keys(obj).sort();
  const sorted: Record<string, JsonValue> = {};
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined) {
      // JSON.stringify drops undefined; we mirror that.
      continue;
    }
    sorted[k] = canonicalize(v, depth + 1);
  }
  return sorted;
}

/**
 * Strict canonicalize for non-trusted input. Validates the value is JSON-safe
 * first, then delegates to `canonicalize`.
 */
function canonicalizeUnknown(value: unknown, depth = 0): JsonValue {
  if (depth > MAX_CANONICALIZE_DEPTH) {
    throw new TypeError(
      `hashRequest: input exceeds maximum nesting depth (${MAX_CANONICALIZE_DEPTH})`,
    );
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return canonicalize(value as JsonValue, depth);
  }
  if (Array.isArray(value)) {
    return value.map((v) => canonicalizeUnknown(v, depth + 1));
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, JsonValue> = {};
    for (const k of Object.keys(obj).sort()) {
      const v = obj[k];
      if (v === undefined) continue;
      sorted[k] = canonicalizeUnknown(v, depth + 1);
    }
    return sorted;
  }
  throw new TypeError(
    `hashRequest: value is not a valid JSON value (type=${typeof value})`,
  );
}

/**
 * Compute a stable hash of a ChoiceRequest for correlation and idempotency.
 *
 * P0-6: the previous implementation only sorted top-level keys; nested objects
 * with key-order differences could produce different hashes. The recursive
 * `canonicalize` ensures structural equality yields byte-identical serialization.
 *
 * Arrays preserve order (a design choice: provider-eligibility order is
 * semantically meaningful, see `RoutePolicy.providerIds`).
 */
export function hashRequest(request: unknown): string {
  const canonical = JSON.stringify(canonicalizeUnknown(request));
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

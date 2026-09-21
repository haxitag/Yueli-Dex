/**
 * Error codes for Yueli DEX.
 *
 * These codes are part of the public contract. Downstream systems should
 * branch on `code` rather than parsing message strings.
 */
export type DexErrorCode =
  | "RULE_REJECTED"
  | "TEMPLATE_INVALID"
  | "TEMPLATE_NOT_FOUND"
  | "MODELING_PROPOSAL_REJECTED"
  | "MODELER_NOT_FOUND"
  | "NO_ELIGIBLE_PROVIDER"
  | "PROVIDER_AUTH"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_FAILURE"
  | "INVALID_CHOICE_REQUEST"
  | "INVALID_CHOICE_RESPONSE"
  | "UNKNOWN_ROUTE"
  | "INTERNAL_ERROR";

export class DexError extends Error {
  readonly code: DexErrorCode;
  readonly decisionId: string;
  readonly providerId?: string;
  readonly recoveryHint?: string;

  constructor(
    code: DexErrorCode,
    message: string,
    opts: {
      decisionId: string;
      providerId?: string;
      recoveryHint?: string;
      cause?: unknown;
    },
  ) {
    super(message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = "DexError";
    this.code = code;
    this.decisionId = opts.decisionId;
    this.providerId = opts.providerId;
    this.recoveryHint = opts.recoveryHint;
  }
}

/** A provider attempt failed for a retryable reason. */
export class ProviderAttemptError extends DexError {
  readonly attempt: number;
  constructor(
    code: DexErrorCode,
    message: string,
    opts: {
      decisionId: string;
      providerId: string;
      attempt: number;
      recoveryHint?: string;
      cause?: unknown;
    },
  ) {
    super(code, message, {
      decisionId: opts.decisionId,
      providerId: opts.providerId,
      recoveryHint: opts.recoveryHint,
      cause: opts.cause,
    });
    this.attempt = opts.attempt;
  }
}

export function isDexError(value: unknown): value is DexError {
  return value instanceof DexError;
}

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

/**
 * Why the route exited without a successful response. P0-3 exposes this on
 * the receipt so failures carry the same audit trail as successes.
 */
export type RouteFailureReason =
  | "no_eligible_provider"
  | "all_attempts_failed"
  | "non_retryable"
  | "unknown_route"
  | "invalid_request"
  | "rule_rejected"
  | "modeling_rejected"
  | "template_invalid";

/**
 * Carries the per-attempt trace that the routing layer collected before the
 * route gave up. Thrown by `executeRoute()` instead of a bare `DexError` so
 * the top-level `dex.choice()` can preserve the attempts on the receipt —
 * failures are the *most* important audit signal and must not be silently
 * trimmed (P0-3, plan §6.3).
 */
export class RouteExecutionFailure extends DexError {
  readonly attempts: readonly import("./types.js").ProviderAttempt[];
  readonly reason: RouteFailureReason;

  constructor(
    code: DexErrorCode,
    message: string,
    opts: {
      decisionId: string;
      reason: RouteFailureReason;
      attempts: readonly import("./types.js").ProviderAttempt[];
      providerId?: string;
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
    this.attempts = opts.attempts;
    this.reason = opts.reason;
  }
}

export function isDexError(value: unknown): value is DexError {
  return value instanceof DexError;
}

export function isRouteExecutionFailure(
  value: unknown,
): value is RouteExecutionFailure {
  return value instanceof RouteExecutionFailure;
}

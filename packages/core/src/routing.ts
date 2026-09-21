import type {
  ChoiceProvider,
  ChoiceRequest,
  ChoiceResponse,
} from "@haxitag/yueli-dex-plugin-sdk";
import { DexError, ProviderAttemptError } from "./errors.js";
import type {
  ProviderAttempt,
  RoutePolicy,
  RoutingConfig,
} from "./types.js";
import { validateChoiceResponse } from "./validation.js";

/* ------------------------------------------------------------------ */
/* Circuit breaker                                                     */
/* ------------------------------------------------------------------ */

type CircuitState = "closed" | "open" | "half-open";

interface CircuitRecord {
  state: CircuitState;
  failures: number;
  lastFailureAt: number;
}

interface CircuitBreaker {
  isOpen(providerId: string): boolean;
  recordFailure(providerId: string): void;
  recordSuccess(providerId: string): void;
  /** Attempt to transition from open to half-open after cooldown. */
  allowProbe(providerId: string): boolean;
}

export function createCircuitBreaker(policy: RoutePolicy): CircuitBreaker {
  const circuits = new Map<string, CircuitRecord>();

  function get(id: string): CircuitRecord {
    let c = circuits.get(id);
    if (!c) {
      c = { state: "closed", failures: 0, lastFailureAt: 0 };
      circuits.set(id, c);
    }
    return c;
  }

  return {
    isOpen(id) {
      const c = get(id);
      if (c.state === "open") {
        // Check if cooldown has elapsed -> half-open
        if (Date.now() - c.lastFailureAt >= policy.circuitCooldownMs) {
          c.state = "half-open";
        }
      }
      return c.state === "open";
    },

    recordFailure(id) {
      const c = get(id);
      c.failures += 1;
      c.lastFailureAt = Date.now();
      if (c.failures >= policy.circuitFailureThreshold) {
        c.state = "open";
      }
    },

    recordSuccess(id) {
      const c = get(id);
      c.failures = 0;
      c.state = "closed";
    },

    allowProbe(id) {
      const c = get(id);
      return c.state !== "open" || Date.now() - c.lastFailureAt >= policy.circuitCooldownMs;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Provider health cache                                               */
/* ------------------------------------------------------------------ */

interface ProviderHealthCache {
  getHealth(provider: ChoiceProvider, deadlineMs: number): Promise<{
    available: boolean;
    p95?: number;
    errorRate?: number;
  }>;
}

export function createHealthCache(): ProviderHealthCache {
  const cache = new Map<string, { ts: number; health: { available: boolean; p95?: number; errorRate?: number } }>();
  const TTL_MS = 5000;

  return {
    async getHealth(provider, deadlineMs) {
      const id = provider.manifest.id;
      const cached = cache.get(id);
      const now = Date.now();
      if (cached && now - cached.ts < TTL_MS) {
        return cached.health;
      }
      try {
        const h = await provider.health({ now: new Date(now).toISOString(), deadlineMs });
        const health = {
          available: h.available,
          p95: h.observedP95LatencyMs,
          errorRate: h.recentErrorRate,
        };
        cache.set(id, { ts: now, health });
        return health;
      } catch {
        const health = { available: false };
        cache.set(id, { ts: now, health });
        return health;
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

export interface RouterDeps {
  readonly providers: readonly ChoiceProvider[];
  readonly routing: RoutingConfig;
  readonly circuit: CircuitBreaker;
  readonly health: ProviderHealthCache;
}

export interface RouteExecutionResult {
  readonly response: ChoiceResponse;
  readonly attempts: readonly ProviderAttempt[];
  readonly eligibleProviderIds: readonly string[];
  readonly selectedProviderId: string;
  readonly usage?: ChoiceResponse["usage"];
}

/**
 * Select and execute a provider according to route policy.
 *
 * Ordering: static preference (providerIds order), then penalize by observed
 * P95 latency, recent error rate, and estimated cost. Only connection
 * failures, timeouts, configured transient server errors, or rate limits
 * permit failover. A valid Choice response ends the attempt sequence even
 * if confidence is low.
 */
export async function executeRoute(
  request: ChoiceRequest,
  options: {
    readonly decisionId: string;
    readonly requestHash: string;
    readonly routeName?: string;
    readonly deadlineMs?: number;
    readonly preferredOrder?: readonly string[];
  },
  deps: RouterDeps,
): Promise<RouteExecutionResult> {
  const policy = resolvePolicy(deps.routing, options.routeName);
  const deadline = options.deadlineMs ?? 30000;
  const retryableStatuses = new Set(policy.retryableStatusCodes ?? [429, 500, 502, 503, 504]);

  // Filter eligible providers
  const eligible = await filterEligible(policy, deps, options.decisionId);
  if (eligible.length === 0) {
    throw new DexError(
      "NO_ELIGIBLE_PROVIDER",
      `No eligible provider for route "${options.routeName ?? "default"}"`,
      {
        decisionId: options.decisionId,
        recoveryHint: "Check provider credentials, circuit state, and route policy.",
      },
    );
  }

  // Order providers: apply preferredOrder if present, then policy.providerIds order,
  // then health/latency/cost penalties.
  const ordered = orderProviders(eligible, policy, options.preferredOrder);

  const attempts: ProviderAttempt[] = [];
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < Math.min(ordered.length, policy.maxAttempts); attempt++) {
    const provider = ordered[attempt];
    const startedAt = new Date().toISOString();
    const startMs = Date.now();

    try {
      const response = await executeWithTimeout(
        provider.execute(request, {
          decisionId: options.decisionId,
          requestHash: options.requestHash,
          deadlineMs: deadline,
          attempt: attempt + 1,
        }),
        deadline,
        options.decisionId,
        provider.manifest.id,
      );

      const elapsedMs = Date.now() - startMs;

      // Validate the response
      const validated = validateChoiceResponse(
        request,
        response,
        options.decisionId,
        provider.manifest.id,
      );

      deps.circuit.recordSuccess(provider.manifest.id);
      attempts.push({
        providerId: provider.manifest.id,
        startedAt,
        elapsedMs,
        outcome: "success",
      });

      return {
        response: validated,
        attempts,
        eligibleProviderIds: eligible.map((p) => p.manifest.id),
        selectedProviderId: provider.manifest.id,
        usage: validated.usage,
      };
    } catch (err) {
      const elapsedMs = Date.now() - startMs;
      const dexErr = normalizeProviderError(err, options.decisionId, provider.manifest.id, attempt + 1, retryableStatuses);

      const outcome: ProviderAttempt["outcome"] =
        dexErr.code === "PROVIDER_TIMEOUT" ? "timed_out" :
        dexErr.code === "PROVIDER_RATE_LIMIT" ? "rate_limited" :
        "failed";

      attempts.push({
        providerId: provider.manifest.id,
        startedAt,
        elapsedMs,
        outcome,
        failureCode: dexErr.code,
      });

      // Update circuit breaker
      if (dexErr.code === "PROVIDER_TIMEOUT" || dexErr.code === "PROVIDER_RATE_LIMIT" || dexErr.code === "PROVIDER_FAILURE") {
        deps.circuit.recordFailure(provider.manifest.id);
      }

      // Non-retryable errors fail immediately
      if (!isRetryable(dexErr.code)) {
        throw dexErr;
      }

      lastError = dexErr;
    }
  }

  // All attempts exhausted
  const lastCode = lastError instanceof DexError ? lastError.code : "PROVIDER_FAILURE";
  throw new DexError(
    lastCode,
    `All ${attempts.length} provider attempts failed for route "${options.routeName ?? "default"}"`,
    {
      decisionId: options.decisionId,
      cause: lastError,
      recoveryHint: "Check provider health, credentials, and retry policy.",
    },
  );
}

function resolvePolicy(routing: RoutingConfig, routeName?: string): RoutePolicy {
  if (routeName) {
    const named = routing.named?.[routeName];
    if (!named) {
      throw new DexError("UNKNOWN_ROUTE", `Unknown route "${routeName}"`, {
        decisionId: "router",
        recoveryHint: "Declare the route in DexConfig.routing.named.",
      });
    }
    return named;
  }
  return routing.default;
}

async function filterEligible(
  policy: RoutePolicy,
  deps: RouterDeps,
  _decisionId: string,
): Promise<ChoiceProvider[]> {
  const eligible: ChoiceProvider[] = [];
  for (const provider of deps.providers) {
    // Must be in policy.providerIds (or policy allows all if empty?)
    // Spec says providerIds is the list of eligible providers.
    if (!policy.providerIds.includes(provider.manifest.id)) {
      continue;
    }
    // Must declare choice capability
    if (!provider.manifest.capabilities.includes("choice")) {
      continue;
    }
    // Circuit breaker
    if (deps.circuit.isOpen(provider.manifest.id) && !deps.circuit.allowProbe(provider.manifest.id)) {
      continue;
    }
    // Health check
    const health = await deps.health.getHealth(provider, 5000);
    if (!health.available) {
      continue;
    }
    eligible.push(provider);
  }
  return eligible;
}

function orderProviders(
  providers: ChoiceProvider[],
  policy: RoutePolicy,
  preferredOrder?: readonly string[],
): ChoiceProvider[] {
  // Build a score: lower is better.
  // Start with static preference index (position in providerIds or preferredOrder).
  const order = preferredOrder && preferredOrder.length > 0 ? preferredOrder : policy.providerIds;

  return [...providers].sort((a, b) => {
    const aIdx = order.indexOf(a.manifest.id);
    const bIdx = order.indexOf(b.manifest.id);
    // Prefer explicitly listed providers
    const aPref = aIdx === -1 ? Number.MAX_SAFE_INTEGER : aIdx;
    const bPref = bIdx === -1 ? Number.MAX_SAFE_INTEGER : bIdx;
    if (aPref !== bPref) return aPref - bPref;
    return 0;
  });
}

async function executeWithTimeout<T>(
  promise: Promise<T>,
  deadlineMs: number,
  decisionId: string,
  providerId: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new ProviderAttemptError("PROVIDER_TIMEOUT", `Provider "${providerId}" timed out after ${deadlineMs}ms`, {
          decisionId,
          providerId,
          attempt: 0,
          recoveryHint: "Increase the deadline or check provider latency.",
        }),
      );
    }, deadlineMs);

    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function normalizeProviderError(
  err: unknown,
  decisionId: string,
  providerId: string,
  attempt: number,
  retryableStatuses: Set<number>,
): ProviderAttemptError {
  if (err instanceof ProviderAttemptError) {
    return err;
  }
  if (err instanceof DexError) {
    // Re-wrap as attempt error for consistency
    return new ProviderAttemptError(err.code, err.message, {
      decisionId,
      providerId,
      attempt,
      recoveryHint: err.recoveryHint,
      cause: err.cause,
    });
  }

  // Attempt to detect HTTP-like errors
  const anyErr = err as { status?: number; statusCode?: number; code?: string; message?: string };
  const status = anyErr.status ?? anyErr.statusCode;

  if (status === 401 || status === 403 || anyErr.code === "PROVIDER_AUTH") {
    return new ProviderAttemptError("PROVIDER_AUTH", `Provider "${providerId}" authentication failed`, {
      decisionId, providerId, attempt,
      recoveryHint: "Check API key or credentials.",
      cause: err,
    });
  }
  if (status === 429 || anyErr.code === "PROVIDER_RATE_LIMIT") {
    return new ProviderAttemptError("PROVIDER_RATE_LIMIT", `Provider "${providerId}" rate limited`, {
      decisionId, providerId, attempt,
      recoveryHint: "Retry later or reduce request rate.",
      cause: err,
    });
  }
  if (status && status >= 500 && retryableStatuses.has(status)) {
    return new ProviderAttemptError("PROVIDER_FAILURE", `Provider "${providerId}" returned ${status}`, {
      decisionId, providerId, attempt,
      cause: err,
    });
  }
  if (anyErr.code === "ECONNREFUSED" || anyErr.code === "ENOTFOUND" || anyErr.code === "ETIMEDOUT") {
    return new ProviderAttemptError("PROVIDER_FAILURE", `Provider "${providerId}" connection failed: ${anyErr.code}`, {
      decisionId, providerId, attempt,
      cause: err,
    });
  }

  return new ProviderAttemptError("PROVIDER_FAILURE", `Provider "${providerId}" failed: ${anyErr.message ?? String(err)}`, {
    decisionId, providerId, attempt,
    cause: err,
  });
}

function isRetryable(code: string): boolean {
  // Retryable: timeout, rate limit, provider failure (transient)
  // Non-retryable: auth, schema, no eligible provider
  return code === "PROVIDER_TIMEOUT" || code === "PROVIDER_RATE_LIMIT" || code === "PROVIDER_FAILURE";
}

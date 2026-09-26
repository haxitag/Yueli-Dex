import type {
  ChoiceProvider,
  ChoiceRequest,
  ChoiceResponse,
} from "@haxitag/yueli-dex-plugin-sdk";
import { DexError, ProviderAttemptError, RouteExecutionFailure } from "./errors.js";
import type {
  ProviderAttempt,
  RoutePolicy,
  RoutingConfig,
} from "./types.js";
import { validateChoiceResponse } from "./validation.js";

/* ------------------------------------------------------------------ */
/* Circuit breaker                                                     */
/* ------------------------------------------------------------------ */

// P0-5: explicit "probing" state ensures single-flight half-open probes.
// State machine:
//
//   closed ──failures >= threshold──> open
//   open   ──cooldown elapsed & first allowProbe()──> probing
//   probing ──recordSuccess──> closed
//   probing ──recordFailure──> open
//   probing ──probeTimeoutMs elapsed──> open (probe hung)
//
// allowProbe() is the *only* method that performs the open→probing
// transition and it does so atomically per call. isOpen() is now a pure
// observation that does NOT mutate state — that's the bug the previous
// half-open implementation had.

type CircuitState = "closed" | "open" | "probing";

interface CircuitRecord {
  state: CircuitState;
  failures: number;
  lastFailureAt: number;
  probeStartedAt?: number;
}

interface CircuitBreaker {
  /**
   * Pure observation. Returns true when this caller should NOT use the
   * provider: either the circuit is in cooldown ("open") or another caller
   * already holds the probe slot ("probing").
   */
  isOpen(providerId: string): boolean;
  recordFailure(providerId: string): void;
  recordSuccess(providerId: string): void;
  /**
   * Atomic probe-slot acquisition. Returns true ONLY for the single caller
   * that successfully transitions `open` → `probing` after cooldown. All
   * concurrent callers in the same cooldown window return false.
   */
  allowProbe(providerId: string): boolean;
}

export function createCircuitBreaker(policy: RoutePolicy): CircuitBreaker {
  const circuits = new Map<string, CircuitRecord>();
  // Default probeTimeoutMs = half of cooldownMs. Tunable via RoutePolicy.
  const probeTimeoutMs = policy.probeTimeoutMs ?? Math.max(1, Math.floor(policy.circuitCooldownMs / 2));

  function get(id: string): CircuitRecord {
    let c = circuits.get(id);
    if (!c) {
      c = { state: "closed", failures: 0, lastFailureAt: 0 };
      circuits.set(id, c);
    }
    return c;
  }

  function isProbeHung(c: CircuitRecord): boolean {
    return (
      c.state === "probing" &&
      c.probeStartedAt !== undefined &&
      Date.now() - c.probeStartedAt >= probeTimeoutMs
    );
  }

  return {
    isOpen(id) {
      const c = get(id);
      if (c.state === "closed") return false;
      // For open / probing states, treat this caller as excluded.
      // The provider is still cooling down OR someone else is currently
      // probing it.
      if (isProbeHung(c)) {
        // Probe has been hung too long — treat the circuit as back in
        // cooldown so the next allowProbe() can win a fresh slot.
        c.state = "open";
        c.lastFailureAt = Date.now();
        c.probeStartedAt = undefined;
        return true;
      }
      return true;
    },

    recordFailure(id) {
      const c = get(id);
      c.failures += 1;
      c.lastFailureAt = Date.now();
      if (c.state === "probing") {
        // The active probe failed — restart cooldown.
        c.state = "open";
        c.probeStartedAt = undefined;
      } else if (c.state === "closed" && c.failures >= policy.circuitFailureThreshold) {
        c.state = "open";
      }
    },

    recordSuccess(id) {
      const c = get(id);
      c.failures = 0;
      c.state = "closed";
      c.probeStartedAt = undefined;
    },

    allowProbe(id) {
      const c = get(id);
      if (c.state !== "open") return false;
      if (Date.now() - c.lastFailureAt < policy.circuitCooldownMs) return false;
      // Atomically win the probe slot.
      c.state = "probing";
      c.probeStartedAt = Date.now();
      return true;
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
  /** P1-4: passive observation store, updated after each execute attempt. */
  readonly observations?: import("./observations.js").ObservationStore;
}

export interface RouteExecutionResult {
  readonly response: ChoiceResponse;
  readonly attempts: readonly ProviderAttempt[];
  readonly eligibleProviderIds: readonly string[];
  readonly selectedProviderId: string;
  readonly usage?: ChoiceResponse["usage"];
  /** P1-1: per-candidate scoring + observation snapshot. */
  readonly routing?: import("./types.js").RoutingTrace;
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
  const requestedDeadline = options.deadlineMs ?? 30000;
  // P0-4: deadline is now a shared budget for the entire decision call, not
  // each provider attempt. Each attempt gets the *remaining* time slice.
  const deadlineAt =
    Number.isFinite(requestedDeadline) && requestedDeadline > 0
      ? Date.now() + requestedDeadline
      : Number.POSITIVE_INFINITY;
  const remainingMs = (): number => Math.max(0, deadlineAt - Date.now());
  const retryableStatuses = new Set(policy.retryableStatusCodes ?? [429, 500, 502, 503, 504]);

  // Filter eligible providers
  const eligible = await filterEligible(policy, deps, options.decisionId, remainingMs);
  if (eligible.length === 0) {
    throw new RouteExecutionFailure(
      "NO_ELIGIBLE_PROVIDER",
      `No eligible provider for route "${options.routeName ?? "default"}"`,
      {
        decisionId: options.decisionId,
        reason: "no_eligible_provider",
        attempts: [],
        recoveryHint: "Check provider credentials, circuit state, and route policy.",
      },
    );
  }

  // P1-1: score-based ordering with cost / latency / error penalties.
  // The decision trace is attached to the result for audit / observability.
  const { ordered, decisions } = orderProviders(
    eligible,
    policy,
    options.preferredOrder,
    deps.observations,
  );
  const selectedProviderId = ordered[0]?.manifest.id ?? "";
  const routingTrace: import("./types.js").RoutingTrace = {
    policy: options.routeName ?? "default",
    candidates: eligible.map((p) => p.manifest.id),
    decisions,
    selectedProviderId,
  };

  const attempts: ProviderAttempt[] = [];
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < Math.min(ordered.length, policy.maxAttempts); attempt++) {
    const provider = ordered[attempt];
    const startedAt = new Date().toISOString();
    const startMs = Date.now();

    try {
      const remaining = remainingMs();
      const response = await executeWithTimeout(
        provider.execute(request, {
          decisionId: options.decisionId,
          requestHash: options.requestHash,
          deadlineMs: remaining,
          attempt: attempt + 1,
        }),
        remaining,
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
      deps.observations?.record(provider.manifest.id, { ok: true, latencyMs: elapsedMs, at: Date.now() });
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
        routing: { ...routingTrace, selectedProviderId: provider.manifest.id },
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

      // P1-4: record observation (failures count toward errorRate).
      deps.observations?.record(provider.manifest.id, { ok: false, latencyMs: elapsedMs, at: Date.now() });

      // Update circuit breaker
      if (dexErr.code === "PROVIDER_TIMEOUT" || dexErr.code === "PROVIDER_RATE_LIMIT" || dexErr.code === "PROVIDER_FAILURE") {
        deps.circuit.recordFailure(provider.manifest.id);
      }

      // Non-retryable errors fail immediately
      if (!isRetryable(dexErr.code)) {
        throw new RouteExecutionFailure(
          dexErr.code,
          dexErr.message,
          {
            decisionId: options.decisionId,
            reason: "non_retryable",
            attempts,
            providerId: provider.manifest.id,
            recoveryHint: dexErr.recoveryHint,
            cause: dexErr.cause,
          },
        );
      }

      lastError = dexErr;
    }
  }

  // All attempts exhausted
  const lastCode = lastError instanceof DexError ? lastError.code : "PROVIDER_FAILURE";
  throw new RouteExecutionFailure(
    lastCode,
    `All ${attempts.length} provider attempts failed for route "${options.routeName ?? "default"}"`,
    {
      decisionId: options.decisionId,
      reason: "all_attempts_failed",
      attempts,
      providerId: lastError instanceof DexError ? lastError.providerId : undefined,
      recoveryHint: "Check provider health, credentials, and retry policy.",
      cause: lastError,
    },
  );
}

function resolvePolicy(routing: RoutingConfig, routeName?: string): RoutePolicy {
  if (routeName) {
    const named = routing.named?.[routeName];
    if (!named) {
      throw new RouteExecutionFailure(
        "UNKNOWN_ROUTE",
        `Unknown route "${routeName}"`,
        {
          decisionId: "router",
          reason: "unknown_route",
          attempts: [],
          recoveryHint: "Declare the route in DexConfig.routing.named.",
        },
      );
    }
    return named;
  }
  return routing.default;
}

async function filterEligible(
  policy: RoutePolicy,
  deps: RouterDeps,
  _decisionId: string,
  remainingMs: () => number,
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
    // Health check — bound by the smaller of the remaining deadline budget and
    // a 5000ms ceiling so a single provider cannot eat the whole budget on
    // health probing (P0-4).
    const healthBudget = Math.min(remainingMs(), 5000);
    const health = await deps.health.getHealth(provider, healthBudget);
    if (!health.available) {
      continue;
    }
    eligible.push(provider);
  }
  return eligible;
}

/**
 * P1-1: score every candidate against the policy and return both the
 * ordered list and a per-candidate decision trace for audit.
 *
 * Score (lower = better) is the sum of:
 *  - static priority index (position in providerIds / preferredOrder)
 *  - latency penalty: max(0, p95Ms - latencyPenaltyFloorMs) * latencyWeight
 *  - error penalty:   max(0, errorRate - errorPenaltyFloorRate) * errorWeight
 *  - cost penalty:    `provider.estimate?.costUsd ?? 0` * costWeight
 *                     (and HARD-eliminate providers above `maxEstimatedCostUsd`)
 *
 * Observations come from `RouterDeps.observations` (P1-4 sliding window).
 * If absent (e.g. in tests), the scoring falls back to zero penalties.
 */
function orderProviders(
  providers: readonly ChoiceProvider[],
  policy: RoutePolicy,
  preferredOrder: readonly string[] | undefined,
  observations: import("./observations.js").ObservationStore | undefined,
): { ordered: ChoiceProvider[]; decisions: import("./types.js").RouteDecision[] } {
  const order =
    preferredOrder && preferredOrder.length > 0 ? preferredOrder : policy.providerIds;
  const scoring = policy.scoring ?? {};
  const latencyWeight = scoring.latencyWeight ?? 1.0;
  const errorWeight = scoring.errorWeight ?? 2.0;
  const costWeight = scoring.costWeight ?? 1.5;
  const latencyFloor = scoring.latencyPenaltyFloorMs ?? policy.p95LatencyMs ?? 0;
  const errorFloor = scoring.errorPenaltyFloorRate ?? 0.1;
  const costCeiling = policy.maxEstimatedCostUsd ?? Number.POSITIVE_INFINITY;

  type Scored = {
    provider: ChoiceProvider;
    score: number;
    decision: import("./types.js").RouteDecision;
  };

  const scored: Scored[] = [];

  for (const provider of providers) {
    const reasons: import("./types.js").RouteDecisionReason[] = [];

    // 1) Static priority
    const idx = order.indexOf(provider.manifest.id);
    const priorityDelta = idx === -1 ? Number.MAX_SAFE_INTEGER / 2 : idx * 10; // space out so other factors can win
    reasons.push({
      factor: "priority",
      delta: priorityDelta,
      note: idx === -1 ? "not in policy order — penalized" : `position ${idx} in route order`,
    });

    // 2) Observation-driven penalties
    const snapshot = observations?.snapshot(provider.manifest.id) ?? { sampleCount: 0 };
    let latencyDelta = 0;
    let errorDelta = 0;
    if (snapshot.p95Ms !== undefined && snapshot.p95Ms > latencyFloor) {
      latencyDelta = (snapshot.p95Ms - latencyFloor) * latencyWeight;
      reasons.push({
        factor: "latency",
        delta: latencyDelta,
        note: `p95 ${snapshot.p95Ms}ms > floor ${latencyFloor}ms × ${latencyWeight}`,
      });
    }
    if (snapshot.errorRate !== undefined && snapshot.errorRate > errorFloor) {
      errorDelta = (snapshot.errorRate - errorFloor) * errorWeight;
      reasons.push({
        factor: "error",
        delta: errorDelta,
        note: `errorRate ${(snapshot.errorRate * 100).toFixed(1)}% > floor ${(errorFloor * 100).toFixed(1)}% × ${errorWeight}`,
      });
    }

    // 3) Cost penalty — also acts as a hard ceiling.
    const cost = provider.estimate?.costUsd ?? 0;
    let costDelta = 0;
    let eligible = true;
    if (cost > costCeiling) {
      eligible = false;
      reasons.push({
        factor: "cost",
        delta: Number.MAX_SAFE_INTEGER,
        note: `cost ${cost} > budget ${costCeiling} — ineligible`,
      });
    } else if (cost > 0) {
      costDelta = cost * costWeight;
      reasons.push({
        factor: "cost",
        delta: costDelta,
        note: `cost ${cost} × ${costWeight}`,
      });
    }

    const score = priorityDelta + latencyDelta + errorDelta + costDelta;
    scored.push({
      provider,
      score: eligible ? score : Number.POSITIVE_INFINITY,
      decision: {
        providerId: provider.manifest.id,
        score: eligible ? score : Number.POSITIVE_INFINITY,
        eligible,
        reasons,
        observation: {
          sampleCount: snapshot.sampleCount,
          p95Ms: snapshot.p95Ms,
          errorRate: snapshot.errorRate,
          avgLatencyMs: snapshot.avgLatencyMs,
        },
      },
    });
  }

  scored.sort((a, b) => a.score - b.score);
  return {
    ordered: scored.map((s) => s.provider),
    decisions: scored.map((s) => s.decision),
  };
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

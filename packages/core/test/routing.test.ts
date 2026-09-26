import { describe, it, expect, vi, afterEach } from "vitest";
import { createCircuitBreaker, executeRoute } from "../src/routing.js";
import { createObservationStore } from "../src/observations.js";
import type { ChoiceProvider, ChoiceRequest, ChoiceResponse, ProviderHealth } from "@haxitag/yueli-dex-plugin-sdk";
import type { RoutingConfig } from "../src/types.js";

const DECISION_ID = "test-decision";
const REQUEST_HASH = "hash123";

const sampleRequest: ChoiceRequest = {
  state: "test",
  questions: {
    q: { type: "choice", instructions: "?", criteria: { a: "a", b: "b" } },
  },
};

const validResponse: ChoiceResponse = {
  model: "jev",
  answers: {
    q: { type: "choice", choice: "a", confidence: 0.9, probabilities: { a: 0.9, b: 0.1 } },
  },
};

function makeProvider(
  id: string,
  opts: {
    execute?: (req: ChoiceRequest) => Promise<ChoiceResponse>;
    health?: () => Promise<ProviderHealth>;
  } = {},
): ChoiceProvider {
  return {
    manifest: {
      id,
      apiVersion: "yueli-dex-plugin/v1",
      kind: "provider",
      version: "0.1.0",
      capabilities: ["choice"],
    },
    health: opts.health ?? (async () => ({ available: true })),
    execute: opts.execute ?? (async () => validResponse),
  };
}

const baseRouting: RoutingConfig = {
  default: {
    providerIds: ["p1", "p2"],
    maxAttempts: 2,
    circuitFailureThreshold: 3,
    circuitCooldownMs: 60000,
    retryableStatusCodes: [429, 500, 502, 503, 504],
  },
};

describe("circuit breaker", () => {
  // Defensive: ensure fake timers don't leak between tests and break
  // later real-time tests with setTimeout-based provider fakes.
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts closed and allows requests", () => {
    const cb = createCircuitBreaker(baseRouting.default);
    expect(cb.isOpen("p1")).toBe(false);
  });

  it("opens after threshold failures", () => {
    const cb = createCircuitBreaker({ ...baseRouting.default, circuitFailureThreshold: 2 });
    cb.recordFailure("p1");
    cb.recordFailure("p1");
    expect(cb.isOpen("p1")).toBe(true);
  });

  it("resets after success", () => {
    const cb = createCircuitBreaker({ ...baseRouting.default, circuitFailureThreshold: 2 });
    cb.recordFailure("p1");
    cb.recordSuccess("p1");
    cb.recordFailure("p1");
    // Should still be closed since success reset failures
    expect(cb.isOpen("p1")).toBe(false);
  });

  it("transitions to half-open after cooldown", () => {
    vi.useFakeTimers();
    const cb = createCircuitBreaker({
      ...baseRouting.default,
      circuitFailureThreshold: 1,
      circuitCooldownMs: 1000,
    });
    cb.recordFailure("p1");
    expect(cb.isOpen("p1")).toBe(true);
    vi.advanceTimersByTime(1001);
    expect(cb.allowProbe("p1")).toBe(true);
    vi.useRealTimers();
  });

  // P0-5: only ONE caller may win the probe slot after cooldown, regardless
  // of how many concurrent callers race. Previously isOpen() mutated state
  // and any caller seeing the half-open transition could probe.
  it("single-flight probe slot after cooldown", () => {
    vi.useFakeTimers();
    const cb = createCircuitBreaker({
      ...baseRouting.default,
      circuitFailureThreshold: 1,
      circuitCooldownMs: 1000,
    });
    cb.recordFailure("p1");
    vi.advanceTimersByTime(1001);

    // 100 concurrent callers all race. Exactly one wins.
    const winners: boolean[] = [];
    for (let i = 0; i < 100; i++) winners.push(cb.allowProbe("p1"));
    expect(winners.filter(Boolean)).toHaveLength(1);
    vi.useRealTimers();
  });

  it("isOpen excludes callers while another caller is probing", () => {
    vi.useFakeTimers();
    const cb = createCircuitBreaker({
      ...baseRouting.default,
      circuitFailureThreshold: 1,
      circuitCooldownMs: 1000,
    });
    cb.recordFailure("p1");
    vi.advanceTimersByTime(1001);

    // Caller 1 wins the probe slot.
    expect(cb.allowProbe("p1")).toBe(true);

    // Caller 2 (concurrent) sees the circuit as excluded.
    expect(cb.isOpen("p1")).toBe(true);
    // ... and does NOT win a second probe slot.
    expect(cb.allowProbe("p1")).toBe(false);
    vi.useRealTimers();
  });

  it("probe failure returns circuit to open with fresh cooldown", () => {
    vi.useFakeTimers();
    const cb = createCircuitBreaker({
      ...baseRouting.default,
      circuitFailureThreshold: 1,
      circuitCooldownMs: 1000,
    });
    cb.recordFailure("p1");
    vi.advanceTimersByTime(1001);
    expect(cb.allowProbe("p1")).toBe(true);
    cb.recordFailure("p1"); // probe fails
    expect(cb.isOpen("p1")).toBe(true);
    expect(cb.allowProbe("p1")).toBe(false); // immediately — cooldown restarted
    vi.advanceTimersByTime(1001);
    expect(cb.allowProbe("p1")).toBe(true);
    vi.useRealTimers();
  });

  it("hung probe times out and returns to open", () => {
    vi.useFakeTimers();
    const cb = createCircuitBreaker({
      ...baseRouting.default,
      circuitFailureThreshold: 1,
      circuitCooldownMs: 1000,
      probeTimeoutMs: 100,
    });
    cb.recordFailure("p1");
    vi.advanceTimersByTime(1001);
    expect(cb.allowProbe("p1")).toBe(true); // probe acquired

    // Probe hangs longer than probeTimeoutMs.
    vi.advanceTimersByTime(101);

    // isOpen observes the timeout and treats the circuit as cooldown —
    // the timeout ALSO restarts the cooldown (a hung probe is a failure).
    expect(cb.isOpen("p1")).toBe(true);
    expect(cb.allowProbe("p1")).toBe(false);
    // After the fresh cooldown elapses, the next caller wins.
    vi.advanceTimersByTime(1001);
    expect(cb.allowProbe("p1")).toBe(true);
    vi.useRealTimers();
  });
});

describe("executeRoute", () => {
  it("selects the first available provider and returns a valid response", async () => {
    const p1 = makeProvider("p1");
    const result = await executeRoute(
      sampleRequest,
      { decisionId: DECISION_ID, requestHash: REQUEST_HASH },
      {
        providers: [p1],
        routing: baseRouting,
        circuit: createCircuitBreaker(baseRouting.default),
        health: { getHealth: async () => ({ available: true }) },
      },
    );
    expect(result.response.answers.q.choice).toBe("a");
    expect(result.selectedProviderId).toBe("p1");
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].outcome).toBe("success");
  });

  it("fails over to the next provider on retryable error", async () => {
    const failOnce = vi.fn(async () => {
      const err: Error & { status?: number } = new Error("500");
      err.status = 500;
      throw err;
    });
    const p1 = makeProvider("p1", { execute: failOnce });
    const p2 = makeProvider("p2");
    const result = await executeRoute(
      sampleRequest,
      { decisionId: DECISION_ID, requestHash: REQUEST_HASH },
      {
        providers: [p1, p2],
        routing: baseRouting,
        circuit: createCircuitBreaker(baseRouting.default),
        health: { getHealth: async () => ({ available: true }) },
      },
    );
    expect(result.selectedProviderId).toBe("p2");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].outcome).toBe("failed");
    expect(result.attempts[1].outcome).toBe("success");
  });

  it("does not retry on authentication error (non-retryable)", async () => {
    const authFail = vi.fn(async () => {
      const err: Error & { status?: number } = new Error("401");
      err.status = 401;
      throw err;
    });
    const p1 = makeProvider("p1", { execute: authFail });
    const p2 = makeProvider("p2");
    await expect(
      executeRoute(
        sampleRequest,
        { decisionId: DECISION_ID, requestHash: REQUEST_HASH },
        {
          providers: [p1, p2],
          routing: baseRouting,
          circuit: createCircuitBreaker(baseRouting.default),
          health: { getHealth: async () => ({ available: true }) },
        },
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_AUTH" });
    // p2 should not have been called
    expect(authFail).toHaveBeenCalledTimes(1);
  });

  it("does not retry a valid low-confidence response", async () => {
    const lowConfidence: ChoiceResponse = {
      model: "jev",
      answers: {
        q: { type: "choice", choice: "a", confidence: 0.1, probabilities: { a: 0.5, b: 0.5 } },
      },
    };
    const p1 = makeProvider("p1", { execute: async () => lowConfidence });
    const p1Execute = vi.spyOn(p1, "execute");
    const result = await executeRoute(
      sampleRequest,
      { decisionId: DECISION_ID, requestHash: REQUEST_HASH },
      {
        providers: [p1],
        routing: baseRouting,
        circuit: createCircuitBreaker(baseRouting.default),
        health: { getHealth: async () => ({ available: true }) },
      },
    );
    expect(result.attempts).toHaveLength(1);
    expect(p1Execute).toHaveBeenCalledTimes(1);
    expect(result.response.answers.q.confidence).toBe(0.1);
  });

  it("throws NO_ELIGIBLE_PROVIDER when no providers are eligible", async () => {
    const routing: RoutingConfig = {
      default: { ...baseRouting.default, providerIds: ["nonexistent"] },
    };
    await expect(
      executeRoute(
        sampleRequest,
        { decisionId: DECISION_ID, requestHash: REQUEST_HASH },
        {
          providers: [makeProvider("p1")],
          routing,
          circuit: createCircuitBreaker(routing.default),
          health: { getHealth: async () => ({ available: true }) },
        },
      ),
    ).rejects.toMatchObject({ code: "NO_ELIGIBLE_PROVIDER" });
  });

  it("excludes unhealthy providers", async () => {
    const p1 = makeProvider("p1");
    const result = await executeRoute(
      sampleRequest,
      { decisionId: DECISION_ID, requestHash: REQUEST_HASH },
      {
        providers: [p1],
        routing: baseRouting,
        circuit: createCircuitBreaker(baseRouting.default),
        health: { getHealth: async () => ({ available: false }) },
      },
    ).catch((e) => e);
    expect(result).toMatchObject({ code: "NO_ELIGIBLE_PROVIDER" });
  });

  it("times out and returns PROVIDER_TIMEOUT", async () => {
    const slowProvider = makeProvider("p1", {
      execute: async () => {
        await new Promise((r) => setTimeout(r, 200));
        return validResponse;
      },
    });
    await expect(
      executeRoute(
        sampleRequest,
        { decisionId: DECISION_ID, requestHash: REQUEST_HASH, deadlineMs: 50 },
        {
          providers: [slowProvider],
          routing: baseRouting,
          circuit: createCircuitBreaker(baseRouting.default),
          health: { getHealth: async () => ({ available: true }) },
        },
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
  });

  it("respects named route policy", async () => {
    const p2 = makeProvider("p2");
    const routing: RoutingConfig = {
      default: { ...baseRouting.default, providerIds: ["p1"] },
      named: {
        secondary: { ...baseRouting.default, providerIds: ["p2"] },
      },
    };
    const result = await executeRoute(
      sampleRequest,
      { decisionId: DECISION_ID, requestHash: REQUEST_HASH, routeName: "secondary" },
      {
        providers: [makeProvider("p1"), p2],
        routing,
        circuit: createCircuitBreaker(routing.default),
        health: { getHealth: async () => ({ available: true }) },
      },
    );
    expect(result.selectedProviderId).toBe("p2");
  });

  it("throws UNKNOWN_ROUTE for an undefined named route", async () => {
    await expect(
      executeRoute(
        sampleRequest,
        { decisionId: DECISION_ID, requestHash: REQUEST_HASH, routeName: "nope" },
        {
          providers: [makeProvider("p1")],
          routing: baseRouting,
          circuit: createCircuitBreaker(baseRouting.default),
          health: { getHealth: async () => ({ available: true }) },
        },
      ),
    ).rejects.toMatchObject({ code: "UNKNOWN_ROUTE" });
  });

  // P0-4: deadline is a shared budget for the whole decision call.
  it("deadline is a SHARED budget: each attempt uses remaining time", async () => {
    const policy = {
      ...baseRouting.default,
      maxAttempts: 3,
      providerIds: ["p1", "p2", "p3"],
    };
    const slow = makeProvider("p1", {
      execute: async () => {
        // Burn 30ms of the 50ms total budget.
        await new Promise((r) => setTimeout(r, 30));
        throw Object.assign(new Error("502"), { status: 502 });
      },
    });
    const instant = makeProvider("p2", {
      execute: async () => {
        throw Object.assign(new Error("502"), { status: 502 });
      },
    });
    const faster = makeProvider("p3", {
      execute: async () => {
        // p1 ate 30ms; remaining budget is ~20ms; this must still complete
        // because p3 is much faster than the leftover budget.
        await new Promise((r) => setTimeout(r, 5));
        return validResponse;
      },
    });

    const t0 = Date.now();
    const result = await executeRoute(
      sampleRequest,
      { decisionId: DECISION_ID, requestHash: REQUEST_HASH, deadlineMs: 50 },
      {
        providers: [slow, instant, faster],
        routing: { default: policy },
        circuit: createCircuitBreaker(policy),
        health: { getHealth: async () => ({ available: true }) },
      },
    );
    const total = Date.now() - t0;
    expect(result.selectedProviderId).toBe("p3");
    expect(total).toBeLessThan(50 * 3); // <150ms, well under old per-attempt budget
    expect(total).toBeLessThan(150); // sanity bound
  });

  it("deadline exhausted: subsequent attempts fail fast with PROVIDER_TIMEOUT", async () => {
    const policy = {
      ...baseRouting.default,
      maxAttempts: 3,
      providerIds: ["p1", "p2"],
    };
    const slow1 = makeProvider("p1", {
      execute: async () => {
        await new Promise((r) => setTimeout(r, 60));
        return validResponse;
      },
    });
    const slow2 = makeProvider("p2", {
      execute: async () => {
        await new Promise((r) => setTimeout(r, 60));
        return validResponse;
      },
    });
    const t0 = Date.now();
    await expect(
      executeRoute(
        sampleRequest,
        { decisionId: DECISION_ID, requestHash: REQUEST_HASH, deadlineMs: 30 },
        {
          providers: [slow1, slow2],
          routing: { default: policy },
          circuit: createCircuitBreaker(policy),
          health: { getHealth: async () => ({ available: true }) },
        },
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    const total = Date.now() - t0;
    // Old per-attempt logic would have allowed 60ms; new shared budget
    // stops at ~30ms + a small grace.
    expect(total).toBeLessThan(100);
  });

  // P1-1: routing scoring uses observation p95 to penalize a slow provider.
  it("orders providers by observation latency (slower penalized)", async () => {
    const policy = {
      ...baseRouting.default,
      providerIds: ["p1", "p2"],
      p95LatencyMs: 100,
    };
    const observations = createObservationStore(10);
    // Seed observations: p1 fast, p2 slow.
    for (let i = 0; i < 5; i++) {
      observations.record("p1", { ok: true, latencyMs: 50, at: Date.now() });
      observations.record("p2", { ok: true, latencyMs: 500, at: Date.now() });
    }
    const result = await executeRoute(
      sampleRequest,
      { decisionId: DECISION_ID, requestHash: REQUEST_HASH },
      {
        providers: [makeProvider("p1"), makeProvider("p2")],
        routing: { default: policy },
        circuit: createCircuitBreaker(policy),
        health: { getHealth: async () => ({ available: true }) },
        observations,
      },
    );
    expect(result.selectedProviderId).toBe("p1");
    expect(result.routing).toBeDefined();
    const p1Dec = result.routing!.decisions.find((d) => d.providerId === "p1")!;
    const p2Dec = result.routing!.decisions.find((d) => d.providerId === "p2")!;
    expect(p1Dec.score).toBeLessThan(p2Dec.score);
    expect(p2Dec.reasons.some((r) => r.factor === "latency")).toBe(true);
  });

  it("eliminates providers whose cost exceeds maxEstimatedCostUsd", async () => {
    const policy = {
      ...baseRouting.default,
      providerIds: ["p1", "p2"],
      maxEstimatedCostUsd: 1,
    };
    const expensive = makeProvider("p1");
    // makeProvider returns a stub; we override the manifest.estimate via Object.assign
    const p1 = { ...expensive, estimate: { ...expensive.estimate, costUsd: 5 } };
    const cheap = { ...makeProvider("p2"), estimate: { costUsd: 0.1 } };
    const result = await executeRoute(
      sampleRequest,
      { decisionId: DECISION_ID, requestHash: REQUEST_HASH },
      {
        providers: [p1 as never, cheap as never],
        routing: { default: policy },
        circuit: createCircuitBreaker(policy),
        health: { getHealth: async () => ({ available: true }) },
      },
    );
    expect(result.selectedProviderId).toBe("p2");
    const p1Dec = result.routing!.decisions.find((d) => d.providerId === "p1")!;
    expect(p1Dec.eligible).toBe(false);
    expect(p1Dec.reasons.some((r) => r.factor === "cost")).toBe(true);
  });

  it("penalizes by error rate from observations", async () => {
    const policy = {
      ...baseRouting.default,
      providerIds: ["p1", "p2"],
      // Make the error penalty large enough to overcome the priority gap.
      scoring: { errorPenaltyFloorRate: 0.0, errorWeight: 50 },
    };
    const observations = createObservationStore(10);
    // p1: 4 fails in 4 samples (100% error). p2: clean.
    for (let i = 0; i < 4; i++) {
      observations.record("p1", { ok: false, latencyMs: 50, at: Date.now() });
    }
    for (let i = 0; i < 4; i++) {
      observations.record("p2", { ok: true, latencyMs: 50, at: Date.now() });
    }
    const result = await executeRoute(
      sampleRequest,
      { decisionId: DECISION_ID, requestHash: REQUEST_HASH },
      {
        providers: [makeProvider("p1"), makeProvider("p2")],
        routing: { default: policy },
        circuit: createCircuitBreaker(policy),
        health: { getHealth: async () => ({ available: true }) },
        observations,
      },
    );
    expect(result.selectedProviderId).toBe("p2");
    const p1Dec = result.routing!.decisions.find((d) => d.providerId === "p1")!;
    expect(p1Dec.reasons.some((r) => r.factor === "error")).toBe(true);
  });

  it("records observations after a successful execute", async () => {
    const policy = { ...baseRouting.default, providerIds: ["p1"] };
    const observations = createObservationStore();
    await executeRoute(
      sampleRequest,
      { decisionId: DECISION_ID, requestHash: REQUEST_HASH },
      {
        providers: [makeProvider("p1")],
        routing: { default: policy },
        circuit: createCircuitBreaker(policy),
        health: { getHealth: async () => ({ available: true }) },
        observations,
      },
    );
    const snap = observations.snapshot("p1");
    expect(snap.sampleCount).toBe(1);
    expect(snap.errorRate).toBe(0);
  });

  it("records observations after a FAILED execute (error rate increases)", async () => {
    const policy = { ...baseRouting.default, providerIds: ["p1"] };
    const observations = createObservationStore();
    await expect(
      executeRoute(
        sampleRequest,
        { decisionId: DECISION_ID, requestHash: REQUEST_HASH },
        {
          providers: [
            makeProvider("p1", {
              execute: async () => {
                throw Object.assign(new Error("502"), { status: 502 });
              },
            }),
          ],
          routing: { default: policy },
          circuit: createCircuitBreaker(policy),
          health: { getHealth: async () => ({ available: true }) },
          observations,
        },
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_FAILURE" });
    const snap = observations.snapshot("p1");
    expect(snap.sampleCount).toBe(1);
    expect(snap.errorRate).toBe(1);
  });
});

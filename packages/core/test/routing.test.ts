import { describe, it, expect, vi } from "vitest";
import { createCircuitBreaker, executeRoute } from "../src/routing.js";
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
});

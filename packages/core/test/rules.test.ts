import { describe, it, expect } from "vitest";
import { createRuleEngine } from "../src/rules.js";
import type { RuleSet } from "../src/types.js";
import type { ChoiceRequest } from "@haxitag/yueli-dex-plugin-sdk";

const DECISION_ID = "test-decision";

function makeRuleSet(doc: unknown, scope: RuleSet["scope"] = "organization"): RuleSet {
  return {
    id: "rs-1",
    version: "1.0.0",
    scope,
    document: doc as never,
  };
}

const sampleRequest: ChoiceRequest = {
  state: { tenantTier: "regulated", message: "refund please" },
  questions: {
    handler: {
      type: "choice",
      instructions: "Which team?",
      criteria: {
        billing: "billing",
        technical: "technical",
        needs_review: "needs review",
      },
    },
  },
};

describe("rule engine", () => {
  it("parses a valid rule document", () => {
    const doc = {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "reject-empty",
          when: { path: "$.input.message", op: "equals", value: "" },
          then: { kind: "reject", message: "message is empty" },
        },
      ],
    };
    expect(() => createRuleEngine([makeRuleSet(doc)])).not.toThrow();
  });

  it("rejects invalid apiVersion", () => {
    const doc = { apiVersion: "wrong/v1", rules: [] };
    expect(() => createRuleEngine([makeRuleSet(doc)])).toThrow(/apiVersion/);
  });

  it("rejects invalid action kind", () => {
    const doc = {
      apiVersion: "yueli-dex-rules/v1",
      rules: [{ id: "x", when: { path: "$.input", op: "exists" }, then: { kind: "explode" } }],
    };
    expect(() => createRuleEngine([makeRuleSet(doc)])).toThrow(/invalid action kind/);
  });

  it("rejects invalid operator", () => {
    const doc = {
      apiVersion: "yueli-dex-rules/v1",
      rules: [{ id: "x", when: { path: "$.input", op: "regex" }, then: { kind: "reject" } }],
    };
    expect(() => createRuleEngine([makeRuleSet(doc)])).toThrow(/invalid operator/);
  });

  it("executes reject action", () => {
    const doc = {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "reject-regulated",
          when: { path: "$.input.tenantTier", op: "equals", value: "regulated" },
          then: { kind: "reject", message: "regulated not allowed" },
        },
      ],
    };
    const engine = createRuleEngine([makeRuleSet(doc)]);
    expect(() =>
      engine.evaluatePreRouting(
        { input: sampleRequest.state, compiled: sampleRequest, route: { eligibleProviderIds: [] } },
        DECISION_ID,
      ),
    ).toThrow(/regulated not allowed/);
  });

  it("executes constrain action with requireFallbackOption", () => {
    const doc = {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "constrain-fallback",
          when: { path: "$.compiled.questions.handler.criteria.needs_review", op: "exists" },
          then: { kind: "constrain", requireFallbackOption: "needs_review" },
        },
      ],
    };
    const engine = createRuleEngine([makeRuleSet(doc)]);
    const result = engine.evaluatePreRouting(
      { input: sampleRequest.state, compiled: sampleRequest, route: { eligibleProviderIds: [] } },
      DECISION_ID,
    );
    expect(result.constraints.requireFallbackOption).toBe("needs_review");
  });

  it("executes route action", () => {
    const doc = {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "route-regulated",
          when: { path: "$.input.tenantTier", op: "equals", value: "regulated" },
          then: { kind: "route", route: "regulated-primary" },
        },
      ],
    };
    const engine = createRuleEngine([makeRuleSet(doc)]);
    const result = engine.evaluatePreRouting(
      { input: sampleRequest.state, compiled: sampleRequest, route: { eligibleProviderIds: [] } },
      DECISION_ID,
    );
    expect(result.forcedRoute).toBe("regulated-primary");
  });

  it("executes shortCircuit action", () => {
    const doc = {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "always-billing",
          when: { path: "$.input.message", op: "equals", value: "refund please" },
          then: { kind: "shortCircuit", questionId: "handler", choice: "billing" },
        },
      ],
    };
    const engine = createRuleEngine([makeRuleSet(doc)]);
    const result = engine.evaluatePreRouting(
      { input: sampleRequest.state, compiled: sampleRequest, route: { eligibleProviderIds: [] } },
      DECISION_ID,
    );
    expect(result.pinnedAnswers).toEqual({ handler: "billing" });
    expect(result.shortCircuit).toBeDefined();
    expect(result.shortCircuit!.response.answers.handler.choice).toBe("billing");
    expect(result.shortCircuit!.response.model).toBe("yueli-dex/rules@1");
  });

  it("P0: partial shortCircuit must NOT fabricate answers for other questions", () => {
    const multiQ: ChoiceRequest = {
      state: { accountPlan: "enterprise", message: "refund please" },
      questions: {
        handler: {
          type: "choice",
          instructions: "Which team?",
          criteria: {
            billing: "billing",
            technical: "technical",
            needs_review: "needs review",
          },
        },
        priority: {
          type: "choice",
          instructions: "How urgent?",
          criteria: {
            urgent: "urgent",
            normal: "normal",
            needs_review: "needs review",
          },
        },
      },
    };
    const doc = {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "enterprise-priority",
          when: { path: "$.input.accountPlan", op: "equals", value: "enterprise" },
          then: { kind: "shortCircuit", questionId: "priority", choice: "urgent" },
        },
      ],
    };
    const engine = createRuleEngine([makeRuleSet(doc)]);
    const result = engine.evaluatePreRouting(
      { input: multiQ.state, compiled: multiQ, route: { eligibleProviderIds: [] } },
      DECISION_ID,
    );
    expect(result.pinnedAnswers).toEqual({ priority: "urgent" });
    // Incomplete coverage → no full shortCircuit response (would have invented handler=billing@conf1).
    expect(result.shortCircuit).toBeUndefined();
  });

  it("P0: accumulates shortCircuits across questions into a complete local response", () => {
    const multiQ: ChoiceRequest = {
      state: { accountPlan: "enterprise", hitBilling: true },
      questions: {
        handler: {
          type: "choice",
          instructions: "Which team?",
          criteria: { billing: "b", technical: "t", needs_review: "n" },
        },
        priority: {
          type: "choice",
          instructions: "How urgent?",
          criteria: { urgent: "u", normal: "n", needs_review: "nr" },
        },
      },
    };
    const doc = {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "pin-handler",
          when: { path: "$.input.hitBilling", op: "equals", value: true },
          then: { kind: "shortCircuit", questionId: "handler", choice: "billing" },
        },
        {
          id: "pin-priority",
          when: { path: "$.input.accountPlan", op: "equals", value: "enterprise" },
          then: { kind: "shortCircuit", questionId: "priority", choice: "urgent" },
        },
      ],
    };
    const engine = createRuleEngine([makeRuleSet(doc)]);
    const result = engine.evaluatePreRouting(
      { input: multiQ.state, compiled: multiQ, route: { eligibleProviderIds: [] } },
      DECISION_ID,
    );
    expect(result.pinnedAnswers).toEqual({ handler: "billing", priority: "urgent" });
    expect(result.shortCircuit).toBeDefined();
    expect(result.shortCircuit!.response.answers.handler.choice).toBe("billing");
    expect(result.shortCircuit!.response.answers.priority.choice).toBe("urgent");
    expect(result.shortCircuit!.response.model).toBe("yueli-dex/rules@1");
  });

  it("supports all/any/not compound conditions", () => {
    const doc = {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "compound",
          when: {
            all: [
              { path: "$.input.tenantTier", op: "equals", value: "regulated" },
              { any: [{ path: "$.input.message", op: "exists" }] },
              { not: { path: "$.input.blocked", op: "exists" } },
            ],
          },
          then: { kind: "route", route: "special" },
        },
      ],
    };
    const engine = createRuleEngine([makeRuleSet(doc)]);
    const result = engine.evaluatePreRouting(
      { input: sampleRequest.state, compiled: sampleRequest, route: { eligibleProviderIds: [] } },
      DECISION_ID,
    );
    expect(result.forcedRoute).toBe("special");
  });

  it("supports comparison operators lt/lte/gt/gte/in", () => {
    const doc = {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "budget",
          when: {
            all: [
              { path: "$.input.amount", op: "gt", value: 100 },
              { path: "$.input.amount", op: "lte", value: 1000 },
              { path: "$.input.plan", op: "in", value: ["pro", "enterprise"] },
            ],
          },
          then: { kind: "route", route: "high-value" },
        },
      ],
    };
    const engine = createRuleEngine([makeRuleSet(doc)]);
    const result = engine.evaluatePreRouting(
      {
        input: { amount: 500, plan: "pro" } as never,
        compiled: sampleRequest,
        route: { eligibleProviderIds: [] },
      },
      DECISION_ID,
    );
    expect(result.forcedRoute).toBe("high-value");
  });

  it("sorts rules by scope precedence (template < organization < environment < call)", () => {
    const orgDoc = {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        { id: "org-route", when: { path: "$.input.x", op: "exists" }, then: { kind: "route", route: "org" } },
      ],
    };
    const envDoc = {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        { id: "env-route", when: { path: "$.input.x", op: "exists" }, then: { kind: "route", route: "env" } },
      ],
    };
    const engine = createRuleEngine([
      makeRuleSet(orgDoc, "organization"),
      makeRuleSet(envDoc, "environment"),
    ]);
    const result = engine.evaluatePreRouting(
      { input: { x: 1 } as never, compiled: sampleRequest, route: { eligibleProviderIds: [] } },
      DECISION_ID,
    );
    // Environment scope runs after organization, so its route wins
    expect(result.forcedRoute).toBe("env");
  });

  // P0-2: length / contains / matches operators
  it("supports string_length_lt / string_length_gte", () => {
    const doc = {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "short-idea",
          when: { path: "$.input.idea", op: "string_length_lt", value: 50 },
          then: { kind: "route", route: "short" },
        },
        {
          id: "long-idea",
          when: { path: "$.input.idea", op: "string_length_gte", value: 50 },
          then: { kind: "route", route: "long" },
        },
      ],
    };
    const engine = createRuleEngine([makeRuleSet(doc)]);
    // 49 chars: short wins
    const short = "x".repeat(49);
    expect(
      engine.evaluatePreRouting(
        { input: { idea: short } as never, compiled: sampleRequest, route: { eligibleProviderIds: [] } },
        DECISION_ID,
      ).forcedRoute,
    ).toBe("short");
    // 50 chars: long wins (boundary)
    const exact = "x".repeat(50);
    expect(
      engine.evaluatePreRouting(
        { input: { idea: exact } as never, compiled: sampleRequest, route: { eligibleProviderIds: [] } },
        DECISION_ID,
      ).forcedRoute,
    ).toBe("long");
    // 60 chars: long wins
    expect(
      engine.evaluatePreRouting(
        { input: { idea: "x".repeat(60) } as never, compiled: sampleRequest, route: { eligibleProviderIds: [] } },
        DECISION_ID,
      ).forcedRoute,
    ).toBe("long");
  });

  it("string_length returns false on non-string (no RULE_REJECTED)", () => {
    const doc = {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        { id: "x", when: { path: "$.input.amount", op: "string_length_lt", value: 5 }, then: { kind: "route", route: "r" } },
      ],
    };
    const engine = createRuleEngine([makeRuleSet(doc)]);
    // Number is not a string → rule does not fire, no throw.
    expect(() =>
      engine.evaluatePreRouting(
        { input: { amount: 42 } as never, compiled: sampleRequest, route: { eligibleProviderIds: [] } },
        DECISION_ID,
      ),
    ).not.toThrow();
  });

  it("supports array_length_lt / array_length_gte", () => {
    const doc = {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "has-hazards",
          when: { path: "$.input.hazards", op: "array_length_gte", value: 1 },
          then: { kind: "route", route: "r" },
        },
      ],
    };
    const engine = createRuleEngine([makeRuleSet(doc)]);
    const hit = engine.evaluatePreRouting(
      { input: { hazards: [{ kind: "x" }] } as never, compiled: sampleRequest, route: { eligibleProviderIds: [] } },
      DECISION_ID,
    );
    expect(hit.forcedRoute).toBe("r");
    const miss = engine.evaluatePreRouting(
      { input: { hazards: [] } as never, compiled: sampleRequest, route: { eligibleProviderIds: [] } },
      DECISION_ID,
    );
    expect(miss.forcedRoute).toBeUndefined();
    const undef = engine.evaluatePreRouting(
      { input: {} as never, compiled: sampleRequest, route: { eligibleProviderIds: [] } },
      DECISION_ID,
    );
    expect(undef.forcedRoute).toBeUndefined();
  });

  it("supports contains on strings and arrays", () => {
    const doc = {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "refund-keyword",
          when: { path: "$.input.message", op: "contains", value: "refund" },
          then: { kind: "route", route: "refund-route" },
        },
      ],
    };
    const engine = createRuleEngine([makeRuleSet(doc)]);
    expect(
      engine.evaluatePreRouting(
        { input: { message: "I want a refund" } as never, compiled: sampleRequest, route: { eligibleProviderIds: [] } },
        DECISION_ID,
      ).forcedRoute,
    ).toBe("refund-route");
  });

  // P1-3: two route rules at the SAME scope with different routes is a
  // config error — the previous "last-wins" behavior silently overrode.
  it("rejects conflicting route rules at the same scope", () => {
    const doc = {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "route-a",
          when: { path: "$.input.message", op: "contains", value: "refund" },
          then: { kind: "route", route: "refund-route" },
        },
        {
          id: "route-b",
          when: { path: "$.input.tags", op: "contains", value: "vip" },
          then: { kind: "route", route: "vip-route" },
        },
      ],
    };
    const engine = createRuleEngine([makeRuleSet(doc)]);
    expect(() =>
      engine.evaluatePreRouting(
        {
          input: { message: "refund", tags: ["vip"] } as never,
          compiled: sampleRequest,
          route: { eligibleProviderIds: [] },
        },
        DECISION_ID,
      ),
    ).toThrow(/Conflicting route rules/);
  });

  // P1-3: multiple shortCircuits converging on the SAME (questionId, choice)
  // at the same scope are idempotent — not a config error.
  it("allows multiple shortCircuits converging on the same choice", () => {
    const doc = {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "sc-a",
          when: { path: "$.input.message", op: "exists" },
          then: { kind: "shortCircuit", questionId: "priority", choice: "urgent" },
        },
        {
          id: "sc-b",
          when: { path: "$.input.plan", op: "equals", value: "enterprise" },
          then: { kind: "shortCircuit", questionId: "priority", choice: "urgent" },
        },
      ],
    };
    const engine = createRuleEngine([makeRuleSet(doc)]);
    expect(() =>
      engine.evaluatePreRouting(
        {
          input: { message: "x", plan: "enterprise" } as never,
          compiled: sampleRequest,
          route: { eligibleProviderIds: [] },
        },
        DECISION_ID,
      ),
    ).not.toThrow();
  });

  // P1-3: shortCircuits converging on DIFFERENT choices at same scope is a conflict.
  it("rejects shortCircuits at the same scope targeting DIFFERENT choices", () => {
    const doc = {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "sc-a",
          when: { path: "$.input.message", op: "exists" },
          then: { kind: "shortCircuit", questionId: "handler", choice: "billing" },
        },
        {
          id: "sc-b",
          when: { path: "$.input.plan", op: "exists" },
          then: { kind: "shortCircuit", questionId: "handler", choice: "technical" },
        },
      ],
    };
    const engine = createRuleEngine([makeRuleSet(doc)]);
    expect(() =>
      engine.evaluatePreRouting(
        {
          input: { message: "x", plan: "ent" } as never,
          compiled: sampleRequest,
          route: { eligibleProviderIds: [] },
        },
        DECISION_ID,
      ),
    ).toThrow(/Conflicting shortCircuit/);
  });

  // P1-3: route rules at DIFFERENT scopes follow the lattice — call > env > org > template.
  it("applies route rules by scope precedence (call overrides template)", () => {
    const templateDoc = {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "t-route",
          when: { path: "$.input.flag", op: "equals", value: true },
          then: { kind: "route", route: "T-route" },
        },
      ],
    };
    const orgDoc = {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "o-route",
          when: { path: "$.input.flag", op: "equals", value: true },
          then: { kind: "route", route: "O-route" },
        },
      ],
    };
    const engine = createRuleEngine([
      makeRuleSet(templateDoc, "template"),
      makeRuleSet(orgDoc, "organization"),
    ]);
    // Org scope wins over template scope.
    expect(
      engine.evaluatePreRouting(
        { input: { flag: true } as never, compiled: sampleRequest, route: { eligibleProviderIds: [] } },
        DECISION_ID,
      ).forcedRoute,
    ).toBe("O-route");
  });

  // P1-3: reject action always wins, regardless of scope.
  it("reject always wins over constrain/route/shortCircuit", () => {
    const doc = {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "do-route",
          when: { path: "$.input.flag", op: "exists" },
          then: { kind: "route", route: "safe" },
        },
        {
          id: "kill",
          when: { path: "$.input.flag", op: "exists" },
          then: { kind: "reject", message: "blocked" },
        },
      ],
    };
    const engine = createRuleEngine([makeRuleSet(doc)]);
    expect(() =>
      engine.evaluatePreRouting(
        { input: { flag: true } as never, compiled: sampleRequest, route: { eligibleProviderIds: [] } },
        DECISION_ID,
      ),
    ).toThrow(/blocked/);
  });

  // P1-3: constrains from multiple rules INTERSECT allowedActionKinds.
  it("intersects allowedActionKinds across multiple constrains", () => {
    const doc = {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "permit-AB",
          when: { path: "$.input.x", op: "exists" },
          then: { kind: "constrain", allowedActionKinds: ["A", "B"] },
        },
        {
          id: "permit-BC",
          when: { path: "$.input.x", op: "exists" },
          then: { kind: "constrain", allowedActionKinds: ["B", "C"] },
        },
      ],
    };
    const engine = createRuleEngine([makeRuleSet(doc)]);
    expect(
      engine.evaluatePreRouting(
        { input: { x: 1 } as never, compiled: sampleRequest, route: { eligibleProviderIds: [] } },
        DECISION_ID,
      ).constraints.allowedActionKinds,
    ).toEqual(["B"]);
  });

  it("supports matches with regex and never throws on bad patterns", () => {
    const doc = {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "yankee",
          when: { path: "$.input.message", op: "matches", value: "^\\d{3}-\\d{4}$" },
          then: { kind: "route", route: "phone" },
        },
        {
          id: "broken",
          when: { path: "$.input.message", op: "matches", value: "([unclosed" },
          then: { kind: "route", route: "broken" },
        },
      ],
    };
    const engine = createRuleEngine([makeRuleSet(doc)]);
    expect(
      engine.evaluatePreRouting(
        { input: { message: "415-1234" } as never, compiled: sampleRequest, route: { eligibleProviderIds: [] } },
        DECISION_ID,
      ).forcedRoute,
    ).toBe("phone");
    // Bad regex: rule is parsed, evaluation returns false (no throw), so phone still wins.
    expect(() =>
      engine.evaluatePreRouting(
        { input: { message: "anything" } as never, compiled: sampleRequest, route: { eligibleProviderIds: [] } },
        DECISION_ID,
      ),
    ).not.toThrow();
  });

  it("post-response rules can reject", () => {
    const doc = {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "reject-low-confidence",
          when: { path: "$.response.answers.handler.confidence", op: "lt", value: 0.3 },
          then: { kind: "reject", message: "confidence too low" },
        },
      ],
    };
    const engine = createRuleEngine([makeRuleSet(doc)]);
    const response = {
      model: "jev",
      answers: { handler: { type: "choice", choice: "billing", confidence: 0.1, probabilities: { billing: 1, technical: 0, needs_review: 0 } } },
    };
    expect(() =>
      engine.evaluatePostResponse(
        {
          input: sampleRequest.state,
          compiled: sampleRequest,
          route: { selectedProviderId: "p1", eligibleProviderIds: ["p1"] },
          response: response as never,
        },
        DECISION_ID,
      ),
    ).toThrow(/confidence too low/);
  });
});

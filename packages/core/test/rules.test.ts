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
    expect(result.shortCircuit).toBeDefined();
    expect(result.shortCircuit!.response.answers.handler.choice).toBe("billing");
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

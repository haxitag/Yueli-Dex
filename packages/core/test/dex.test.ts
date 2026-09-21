import { describe, it, expect, vi } from "vitest";
import { createDex, DexError } from "../src/index.js";
import type { ChoiceProvider, ChoiceRequest, ChoiceResponse, TemplatePack } from "@haxitag/yueli-dex-plugin-sdk";
import type { RuleSet, RoutingConfig } from "../src/types.js";

const validResponse: ChoiceResponse = {
  model: "jev-1.13.0",
  answers: {
    handler: {
      type: "choice",
      choice: "billing",
      confidence: 0.81,
      probabilities: { billing: 0.87, technical: 0.08, needs_review: 0.05 },
    },
  },
  usage: { input_tokens: 250, output_tokens: 28 },
};

function makeProvider(id: string, response: ChoiceResponse = validResponse): ChoiceProvider {
  return {
    manifest: {
      id,
      apiVersion: "yueli-dex-plugin/v1",
      kind: "provider",
      version: "0.1.0",
      capabilities: ["choice"],
    },
    health: async () => ({ available: true }),
    execute: async () => response,
  };
}

const sampleRequest: ChoiceRequest = {
  state: "My payment was charged twice and I need a refund.",
  model: "jev-latest",
  questions: {
    handler: {
      type: "choice",
      instructions: "Which team should handle this request?",
      criteria: {
        billing: "Payments, invoices, refunds, and subscriptions",
        technical: "Product bugs, incidents, and integrations",
        needs_review: "Evidence is insufficient or does not fit another option",
      },
    },
  },
};

const defaultRouting: RoutingConfig = {
  default: {
    providerIds: ["p1"],
    maxAttempts: 2,
    circuitFailureThreshold: 3,
    circuitCooldownMs: 60000,
  },
};

describe("createDex", () => {
  it("throws when no providers are configured", () => {
    expect(() =>
      createDex({ providers: [], routing: defaultRouting }),
    ).toThrow(/provider/);
  });

  it("throws when routing.default is missing", () => {
    expect(() =>
      createDex({ providers: [makeProvider("p1")], routing: {} as RoutingConfig }),
    ).toThrow(/routing.default/);
  });

  it("rejects providers without choice capability", () => {
    const badProvider = {
      ...makeProvider("p1"),
      manifest: { ...makeProvider("p1").manifest, capabilities: ["score"] as unknown as ["choice", ...string[]] },
    };
    expect(() =>
      createDex({ providers: [badProvider], routing: defaultRouting }),
    ).toThrow(/choice/);
  });
});

describe("Dex.choice", () => {
  it("returns the provider's Choice response", async () => {
    const dex = createDex({
      providers: [makeProvider("p1")],
      routing: defaultRouting,
    });
    const response = await dex.choice(sampleRequest);
    expect(response.answers.handler.choice).toBe("billing");
    expect(response.answers.handler.confidence).toBe(0.81);
    expect(response.model).toBe("jev-1.13.0");
  });

  it("emits choice.completed with a receipt", async () => {
    const dex = createDex({
      providers: [makeProvider("p1")],
      routing: defaultRouting,
    });
    const events: Array<{ request: ChoiceRequest; response?: ChoiceResponse; receipt: unknown }> = [];
    dex.on("choice.completed", (e) => events.push(e));

    await dex.choice(sampleRequest);

    expect(events).toHaveLength(1);
    const receipt = events[0].receipt as { decisionId: string; route: { selectedProviderId: string } };
    expect(receipt.decisionId).toMatch(/^dex_/);
    expect(receipt.route.selectedProviderId).toBe("p1");
  });

  it("emits choice.failed on invalid request", async () => {
    const dex = createDex({
      providers: [makeProvider("p1")],
      routing: defaultRouting,
    });
    const events: unknown[] = [];
    dex.on("choice.failed", (e) => events.push(e));

    await expect(dex.choice({ state: "x" } as ChoiceRequest)).rejects.toThrow(DexError);
    expect(events).toHaveLength(1);
  });

  it("short-circuits when a rule returns shortCircuit action", async () => {
    const ruleSet: RuleSet = {
      id: "rs1",
      version: "1.0.0",
      scope: "organization",
      document: {
        apiVersion: "yueli-dex-rules/v1",
        rules: [
          {
            id: "always-billing",
            when: { path: "$.input", op: "exists" },
            then: { kind: "shortCircuit", questionId: "handler", choice: "billing" },
          },
        ],
      },
    };
    const providerExecute = vi.fn(async () => validResponse);
    const dex = createDex({
      providers: [makeProvider("p1")],
      routing: defaultRouting,
      ruleSets: [ruleSet],
    });
    // Override execute to track calls
    (dex as unknown as { providers: ChoiceProvider[] });

    const response = await dex.choice(sampleRequest);
    expect(response.model).toBe("yueli-dex/rules@1");
    expect(response.answers.handler.choice).toBe("billing");
  });

  it("rejects when a rule returns reject action", async () => {
    const ruleSet: RuleSet = {
      id: "rs1",
      version: "1.0.0",
      scope: "organization",
      document: {
        apiVersion: "yueli-dex-rules/v1",
        rules: [
          {
            id: "reject-all",
            when: { path: "$.input", op: "exists" },
            then: { kind: "reject", message: "blocked" },
          },
        ],
      },
    };
    const dex = createDex({
      providers: [makeProvider("p1")],
      routing: defaultRouting,
      ruleSets: [ruleSet],
    });
    await expect(dex.choice(sampleRequest)).rejects.toMatchObject({ code: "RULE_REJECTED" });
  });

  it("supports template prepare -> choice -> toActionIntent flow", async () => {
    const pack: TemplatePack = {
      id: "support-pack",
      version: "1.0.0",
      templates: [
        {
          apiVersion: "yueli-dex-template/v1",
          id: "support-triage",
          version: "1.0.0",
          state: { from: { message: "$.message" } },
          choices: [
            {
              id: "handler",
              instructions: "Which team?",
              criteria: {
                billing: "billing",
                technical: "technical",
                needs_review: "needs review",
              },
            },
          ],
          constraints: { requireFallbackOption: "needs_review" },
          actions: {
            handler: {
              billing: { kind: "queue.assign", queue: "billing" },
              technical: { kind: "queue.assign", queue: "technical" },
              needs_review: { kind: "review.request" },
            },
          },
        },
      ],
    };
    const dex = createDex({
      providers: [makeProvider("p1")],
      routing: defaultRouting,
      templates: [pack],
    });

    const request = await dex.templates.prepare({
      template: "support-triage",
      input: { message: "I was charged twice." },
    });
    expect(request.questions.handler).toBeDefined();

    const response = await dex.choice(request);
    const intents = dex.templates.toActionIntent({
      template: "support-triage",
      request,
      response,
    });
    expect(intents).toHaveLength(1);
    expect(intents[0].kind).toBe("queue.assign");
  });

  it("persists receipt to receiptStore", async () => {
    const receipts: unknown[] = [];
    const receiptStore = {
      append: async (r: unknown) => { receipts.push(r); },
    };
    const dex = createDex({
      providers: [makeProvider("p1")],
      routing: defaultRouting,
      receiptStore,
    });
    await dex.choice(sampleRequest);
    expect(receipts).toHaveLength(1);
    const r = receipts[0] as { decisionId: string; usage: { input_tokens: number } };
    expect(r.decisionId).toMatch(/^dex_/);
    expect(r.usage.input_tokens).toBe(250);
  });

  it("accepts a deadlineMs option", async () => {
    const dex = createDex({
      providers: [makeProvider("p1")],
      routing: defaultRouting,
    });
    const response = await dex.choice(sampleRequest, { deadlineMs: 5000 });
    expect(response.answers.handler.choice).toBe("billing");
  });

  it("rejects an unknown route option", async () => {
    const dex = createDex({
      providers: [makeProvider("p1")],
      routing: defaultRouting,
    });
    await expect(dex.choice(sampleRequest, { route: "nonexistent" })).rejects.toMatchObject({
      code: "UNKNOWN_ROUTE",
    });
  });
});

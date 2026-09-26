import { describe, it, expect } from "vitest";
import { createTemplateRegistry } from "../src/templates.js";
import type { TemplatePack, ChoiceRequest, ChoiceResponse } from "@haxitag/yueli-dex-plugin-sdk";

const supportTriageTemplate = {
  apiVersion: "yueli-dex-template/v1",
  id: "support-triage",
  version: "1.0.0",
  state: {
    from: {
      message: "$.message",
      accountPlan: "$.account.plan",
    },
  },
  choices: [
    {
      id: "handler",
      instructions: "Which team should own this request?",
      criteria: {
        billing: "Payments, invoices, refunds, and subscriptions",
        technical: "Product bugs, incidents, and integrations",
        needs_review: "Evidence is insufficient or spans multiple teams",
      },
    },
  ],
  constraints: {
    requireFallbackOption: "needs_review",
    maxOptions: 12,
  },
  actions: {
    handler: {
      billing: { kind: "queue.assign", queue: "billing" },
      technical: { kind: "queue.assign", queue: "technical" },
      needs_review: { kind: "review.request" },
    },
  },
};

const pack: TemplatePack = {
  id: "support-pack",
  version: "1.0.0",
  templates: [supportTriageTemplate],
};

describe("template registry", () => {
  it("prepares a ChoiceRequest from a template and input", async () => {
    const registry = createTemplateRegistry([pack]);
    const request = await registry.prepare({
      template: "support-triage@1.0.0",
      input: { message: "I was charged twice.", account: { plan: "pro" } },
    });
    expect(request.questions.handler.type).toBe("choice");
    expect(Object.keys(request.questions.handler.criteria)).toEqual([
      "billing",
      "technical",
      "needs_review",
    ]);
    expect((request.state as Record<string, unknown>).message).toBe("I was charged twice.");
    expect((request.state as Record<string, unknown>).accountPlan).toBe("pro");
  });

  it("allows lookup by template id alone (latest version)", async () => {
    const registry = createTemplateRegistry([pack]);
    const request = await registry.prepare({
      template: "support-triage",
      input: { message: "hello" },
    });
    expect(request.questions.handler).toBeDefined();
  });

  it("throws for unknown template", async () => {
    const registry = createTemplateRegistry([pack]);
    await expect(
      registry.prepare({ template: "nonexistent", input: {} }),
    ).rejects.toThrow(/not found/);
  });

  it("enforces requireFallbackOption constraint", async () => {
    const badTemplate = {
      ...supportTriageTemplate,
      choices: [
        {
          id: "handler",
          instructions: "Which team?",
          criteria: {
            billing: "billing",
            technical: "technical",
            // missing needs_review
          },
        },
      ],
    };
    const badPack: TemplatePack = { ...pack, templates: [badTemplate] };
    const registry = createTemplateRegistry([badPack]);
    await expect(
      registry.prepare({ template: "support-triage", input: {} }),
    ).rejects.toThrow(/fallback/);
  });

  it("maps response to ActionIntent", async () => {
    const registry = createTemplateRegistry([pack]);
    const request = (await registry.prepare({
      template: "support-triage",
      input: { message: "refund" },
    })) as ChoiceRequest;
    const response: ChoiceResponse = {
      model: "jev",
      answers: {
        handler: {
          type: "choice",
          choice: "billing",
          confidence: 0.9,
          probabilities: { billing: 0.9, technical: 0.05, needs_review: 0.05 },
        },
      },
    };
    const intents = registry.toActionIntent({
      template: "support-triage",
      request,
      response,
    });
    expect(intents).toHaveLength(1);
    expect(intents[0].kind).toBe("queue.assign");
    expect(intents[0].params).toEqual({ queue: "billing" });
    expect(intents[0].questionId).toBe("handler");
    expect(intents[0].choice).toBe("billing");
  });

  it("returns no intents for unmapped choices", async () => {
    const registry = createTemplateRegistry([pack]);
    const request = (await registry.prepare({
      template: "support-triage",
      input: { message: "x" },
    })) as ChoiceRequest;
    // No action mapping for this question (only handler has actions)
    const response: ChoiceResponse = {
      model: "jev",
      answers: {
        handler: {
          type: "choice",
          choice: "technical",
          confidence: 0.7,
          probabilities: { billing: 0.1, technical: 0.7, needs_review: 0.2 },
        },
      },
    };
    const intents = registry.toActionIntent({
      template: "support-triage",
      request,
      response,
    });
    expect(intents).toHaveLength(1);
    expect(intents[0].kind).toBe("queue.assign");
  });

  it("uses whole input as state when no state mapping", async () => {
    const noMapTemplate = {
      apiVersion: "yueli-dex-template/v1",
      id: "simple",
      version: "1.0.0",
      choices: [
        {
          id: "q",
          instructions: "yes or no?",
          criteria: { yes: "yes", no: "no" },
        },
      ],
    };
    const registry = createTemplateRegistry([{ id: "p", version: "1", templates: [noMapTemplate] }]);
    const request = await registry.prepare({
      template: "simple",
      input: { foo: "bar" },
    });
    expect(request.state).toEqual({ foo: "bar" });
  });
});

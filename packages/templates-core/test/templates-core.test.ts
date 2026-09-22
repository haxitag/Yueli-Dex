import { describe, it, expect } from "vitest";
import { createTemplateRegistry, createDex } from "@haxitag/yueli-dex";
import { createHttpProvider } from "@haxitag/yueli-dex-provider-http";
import type { ChoiceResponse } from "@haxitag/yueli-dex-plugin-sdk";
import {
  CATALOG,
  TEMPLATES,
  TEMPLATES_CORE_PACK,
  THEME_LABELS,
  buildAllCallExamples,
  buildCallExample,
  findTemplates,
  getLocalRuleSets,
} from "../src/index.js";

const registry = createTemplateRegistry([TEMPLATES_CORE_PACK]);

describe("templates-core catalog", () => {
  it("has one catalog entry per template", () => {
    expect(CATALOG).toHaveLength(TEMPLATES.length);
    expect(new Set(CATALOG.map((e) => e.id))).toEqual(new Set(TEMPLATES.map((t) => t.id)));
  });

  it("labels every template on all four dimensions", () => {
    for (const t of TEMPLATES) {
      expect(THEME_LABELS).toContain(t.meta.theme);
      expect(t.meta.scenario.length).toBeGreaterThan(0);
      expect(t.meta.useCase.length).toBeGreaterThan(0);
      expect(t.meta.utility.length).toBeGreaterThan(0);
      expect(t.meta.references.length).toBeGreaterThan(0);
    }
  });

  it("finds templates by theme and free-text dimensions", () => {
    expect(findTemplates({ theme: "agent-infrastructure" }).length).toBeGreaterThanOrEqual(4);
    expect(findTemplates({ theme: "security" })).toHaveLength(2);
    expect(findTemplates({ scenario: "routing" }).map((e) => e.id)).toContain("support-triage");
    expect(findTemplates({ utility: "verbatim" }).map((e) => e.id)).toEqual([
      "context-compaction",
    ]);
    expect(findTemplates({})).toHaveLength(TEMPLATES.length);
  });
});

describe("templates-core compilation", () => {
  it("compiles every template into the registry without errors", () => {
    for (const t of TEMPLATES) {
      expect(() => registry.getCompiled(t.id), t.id).not.toThrow();
      expect(registry.getCompiled(t.id)).toBeDefined();
    }
  });

  it("prepares a ChoiceRequest from each template's example input", async () => {
    for (const t of TEMPLATES) {
      const request = await registry.prepare({
        template: `${t.id}@${t.version}`,
        input: t.meta.exampleInput,
      });
      expect(Object.keys(request.questions).length, t.id).toBeGreaterThanOrEqual(1);
      for (const question of Object.values(request.questions)) {
        expect(question.type).toBe("choice");
        expect(Object.keys(question.criteria).length).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("maps a support-triage response to ActionIntents", async () => {
    const request = await registry.prepare({
      template: "support-triage",
      input: TEMPLATES[0].meta.exampleInput,
    });
    const response: ChoiceResponse = {
      model: "jev-1.0.0",
      answers: {
        handler: {
          type: "choice",
          choice: "billing",
          confidence: 0.9,
          probabilities: { billing: 0.9, technical: 0.05, account: 0.02, needs_review: 0.03 },
        },
        priority: {
          type: "choice",
          choice: "urgent",
          confidence: 0.8,
          probabilities: { urgent: 0.8, high: 0.1, normal: 0.07, needs_review: 0.03 },
        },
      },
    };
    const intents = registry.toActionIntent({ template: "support-triage", request, response });
    expect(intents).toHaveLength(2);
    expect(intents.map((i) => i.kind).sort()).toEqual(["priority.set", "queue.assign"]);
    expect(intents.find((i) => i.kind === "queue.assign")?.params).toEqual({ queue: "billing" });
  });

  it("honors allowedActionKinds on gated templates", async () => {
    const request = await registry.prepare({
      template: "security-gate",
      input: {
        command: "rm",
        args: "-rf node_modules",
        environment: "development",
        actor: "claude-code",
      },
    });
    const response: ChoiceResponse = {
      model: "jev-1.0.0",
      answers: {
        verdict: {
          type: "choice",
          choice: "require_confirmation",
          confidence: 0.7,
          probabilities: {
            approve: 0.1,
            require_confirmation: 0.7,
            block: 0.15,
            needs_review: 0.05,
          },
        },
      },
    };
    const intents = registry.toActionIntent({ template: "security-gate", request, response });
    expect(intents).toHaveLength(1);
    expect(intents[0].kind).toBe("gate.verdict");
    expect(intents[0].params).toEqual({ verdict: "require_confirmation" });
  });

  it("exposes modeling permissions on extensible templates", () => {
    const toolSelection = registry.getCompiled("agent-tool-selection");
    expect(toolSelection?.modeling.mode).toBe("optional");
    expect(toolSelection?.modeling.allow.addCriteria).toBe(true);

    const securityGate = registry.getCompiled("security-gate");
    expect(securityGate?.modeling.mode).toBe("off");
  });
});

describe("templates-core local rules (rule-able decisions run locally)", () => {
  // Provider points at an unreachable endpoint: any provider call fails,
  // so a passing test proves the decision was resolved locally.
  const unreachable = createHttpProvider({
    id: "unreachable",
    endpoint: "http://127.0.0.1:1/choice",
  });

  function dexWithRules(templateId: string) {
    return createDex({
      providers: [unreachable],
      routing: {
        default: {
          providerIds: ["unreachable"],
          maxAttempts: 1,
          circuitFailureThreshold: 3,
          circuitCooldownMs: 60_000,
        },
      },
      templates: [TEMPLATES_CORE_PACK],
      ruleSets: getLocalRuleSets(templateId),
    });
  }

  it("short-circuits enterprise priority without any provider call", async () => {
    const dex = dexWithRules("support-triage");
    const request = await dex.templates.prepare({
      template: "support-triage",
      input: { message: "Anything", account: { plan: "enterprise" } },
    });
    const response = await dex.choice(request);
    expect(response.model).toBe("yueli-dex/rules@1");
    expect(response.answers.priority.choice).toBe("urgent");
    // Short-circuit targets one question; others get the deterministic
    // first-criterion fill ("billing" is support-triage's first handler key).
    expect(response.answers.handler.choice).toBe("billing");
  });

  it("rejects destructive commands in production locally", async () => {
    const dex = dexWithRules("security-gate");
    const request = await dex.templates.prepare({
      template: "security-gate",
      input: { command: "rm", args: "-rf /", environment: "production", actor: "agent" },
    });
    await expect(dex.choice(request)).rejects.toThrow(/production/i);
  });

  it("short-circuits directory-listing drops in compaction", async () => {
    const dex = dexWithRules("context-compaction");
    const request = await dex.templates.prepare({
      template: "context-compaction",
      input: {
        conversation: ["user: hi"],
        tool: { name: "list_dir", input: "src", result: "30 entries" },
      },
    });
    const response = await dex.choice(request);
    expect(response.model).toBe("yueli-dex/rules@1");
    expect(response.answers.disposition.choice).toBe("drop");
  });

  it("unmatched requests are not short-circuited (rule miss → remote)", async () => {
    const dex = dexWithRules("support-triage");
    const request = await dex.templates.prepare({
      template: "support-triage",
      input: { message: "I was charged twice.", account: { plan: "pro" } },
    });
    // No local rule matches pro plans → the call must reach the (unreachable)
    // provider and fail, proving non-rule-able traffic still routes remotely.
    await expect(dex.choice(request)).rejects.toThrow();
  });

  it("open-world templates ship no local rules", () => {
    expect(getLocalRuleSets("content-moderation")).toHaveLength(0);
    expect(getLocalRuleSets("browser-action")).toHaveLength(0);
  });
});

describe("templates-core call examples", () => {
  it("generates a runnable example for every template", () => {
    const examples = buildAllCallExamples();
    expect(Object.keys(examples)).toHaveLength(TEMPLATES.length);
    for (const t of TEMPLATES) {
      const example = examples[t.id];
      expect(example, t.id).toContain(`template: "${t.id}"`);
      expect(example, t.id).toContain("dex.templates.prepare");
      expect(example, t.id).toContain("dex.choice(request)");
      expect(example, t.id).toContain("toActionIntent");
      if (getLocalRuleSets(t.id).length > 0) {
        expect(example, t.id).toContain("getLocalRuleSets");
      }
    }
  });

  it("throws for an unknown template id", () => {
    expect(() => buildCallExample("nonexistent")).toThrow(/not found/);
  });
});

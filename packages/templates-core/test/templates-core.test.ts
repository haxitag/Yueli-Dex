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
  // so a passing test proves the decision was resolved locally (FULL shortCircuit).
  const unreachable = createHttpProvider({
    id: "unreachable",
    endpoint: "http://127.0.0.1:1/choice",
  });

  /** Stub provider for PARTIAL-pin cases (rule pins some questions; remainder needs a host). */
  function stubProvider(response: ChoiceResponse) {
    return {
      manifest: {
        id: "stub",
        apiVersion: "yueli-dex-plugin/v1" as const,
        kind: "provider" as const,
        version: "0.0.0",
        capabilities: ["choice" as const],
      },
      health: async () => ({ available: true }),
      execute: async () => response,
    };
  }

  function dexWithRules(templateId: string, provider = unreachable as ReturnType<typeof stubProvider> | typeof unreachable) {
    return createDex({
      providers: [provider as never],
      routing: {
        default: {
          providerIds: [provider.manifest.id],
          maxAttempts: 1,
          circuitFailureThreshold: 3,
          circuitCooldownMs: 60_000,
        },
      },
      templates: [TEMPLATES_CORE_PACK],
      ruleSets: getLocalRuleSets(templateId),
    });
  }

  it("P0: enterprise priority is a PARTIAL pin — provider still classifies handler", async () => {
    const stub = stubProvider({
      model: "jev-stub",
      answers: {
        handler: {
          type: "choice",
          choice: "technical",
          confidence: 0.72,
          probabilities: { billing: 0.1, technical: 0.72, account: 0.08, needs_review: 0.1 },
        },
        priority: {
          type: "choice",
          choice: "normal",
          confidence: 0.6,
          probabilities: { urgent: 0.2, high: 0.15, normal: 0.6, needs_review: 0.05 },
        },
      },
    });
    const dex = dexWithRules("support-triage", stub);
    const request = await dex.templates.prepare({
      template: "support-triage",
      input: { message: "Anything", account: { plan: "enterprise" } },
    });
    const response = await dex.choice(request);
    // Must NOT claim full local resolution (would fabricate handler=billing@conf1).
    expect(response.model).toBe("jev-stub");
    expect(response.answers.priority.choice).toBe("urgent");
    expect(response.answers.priority.confidence).toBe(1);
    // Handler comes from the provider, not the first criterion.
    expect(response.answers.handler.choice).toBe("technical");
    expect(response.answers.handler.confidence).toBe(0.72);
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

  // P0-1 regression: realtime-action must not defend when there is no hazard.
  // Without the hazards check, this deterministic rule becomes wrong-by-construction.
  // The rule message says "Jev only sets the risk level" → PARTIAL pin of action.
  it("realtime-action: grounded=false with hazards PARTIAL-pins action=defend, provider sets risk", async () => {
    const stub = stubProvider({
      model: "jev-stub",
      answers: {
        action: {
          type: "choice",
          choice: "noop",
          confidence: 0.4,
          probabilities: {
            noop: 0.4,
            advance: 0.1,
            advance_jump: 0.1,
            retreat: 0.1,
            defend: 0.2,
            use_ability: 0.05,
            needs_review: 0.05,
          },
        },
        risk: {
          type: "choice",
          choice: "imminent",
          confidence: 0.88,
          probabilities: { clear: 0.02, narrow: 0.08, imminent: 0.88, needs_review: 0.02 },
        },
      },
    });
    const dex = dexWithRules("realtime-action", stub);
    const request = await dex.templates.prepare({
      template: "realtime-action",
      input: {
        tickHz: 9,
        actionSpace: ["noop", "advance", "defend"],
        state: {
          player: { grounded: false },
          hazards: [{ kind: "goomba", dx: 42, dy: 0 }],
          goal: "reach flagpole",
        },
      },
    });
    const response = await dex.choice(request);
    expect(response.model).toBe("jev-stub");
    expect(response.answers.action.choice).toBe("defend");
    expect(response.answers.action.confidence).toBe(1);
    expect(response.answers.risk.choice).toBe("imminent");
    expect(response.answers.risk.confidence).toBe(0.88);
  });

  it("realtime-action: grounded=false with NO hazards field does NOT short-circuit", async () => {
    const dex = dexWithRules("realtime-action");
    const request = await dex.templates.prepare({
      template: "realtime-action",
      input: {
        tickHz: 9,
        actionSpace: ["noop", "advance", "defend"],
        state: {
          player: { grounded: false },
          goal: "reach flagpole",
        },
      },
    });
    // No local rule should match → must hit the (unreachable) provider.
    await expect(dex.choice(request)).rejects.toThrow();
  });

  it("realtime-action: grounded=true with hazards does NOT short-circuit (player is on the ground)", async () => {
    const dex = dexWithRules("realtime-action");
    const request = await dex.templates.prepare({
      template: "realtime-action",
      input: {
        tickHz: 9,
        actionSpace: ["noop", "advance", "defend"],
        state: {
          player: { grounded: true },
          hazards: [{ kind: "goomba", dx: 42, dy: 0 }],
          goal: "reach flagpole",
        },
      },
    });
    await expect(dex.choice(request)).rejects.toThrow();
  });

  // P0-2 regression: startup-pitch must short-circuit ONLY when idea.length < 50.
  // The original `op: "exists"` short-circuited every idea regardless of length.
  it("startup-pitch: short idea (<50 chars) IS short-circuited to needs_review", async () => {
    const dex = dexWithRules("startup-pitch");
    const request = await dex.templates.prepare({
      template: "startup-pitch",
      input: { idea: "AI todo app", goal: "money" }, // ~11 chars
    });
    const response = await dex.choice(request);
    expect(response.model).toBe("yueli-dex/rules@1");
    expect(response.answers.verdict.choice).toBe("needs_review");
  });

  it("startup-pitch: long idea (>=50 chars) does NOT short-circuit and reaches provider", async () => {
    const dex = dexWithRules("startup-pitch");
    const longIdea =
      "A TypeScript ORM that runs in the browser and syncs via CRDTs for offline-first apps";
    const request = await dex.templates.prepare({
      template: "startup-pitch",
      input: { idea: longIdea, goal: "money" }, // well over 50 chars
    });
    // No local rule matches → reaches (unreachable) provider and fails.
    await expect(dex.choice(request)).rejects.toThrow();
  });

  it("startup-pitch: missing idea field does NOT short-circuit (rule requires the field)", async () => {
    const dex = dexWithRules("startup-pitch");
    const request = await dex.templates.prepare({
      template: "startup-pitch",
      input: { goal: "money" }, // no idea at all
    });
    await expect(dex.choice(request)).rejects.toThrow();
  });

  // P1-5: ActionIntent surfaces evidence fields when supplied.
  it("toActionIntent carries decisionId/model/ruleRefs/confidence/probabilities", async () => {
    const stub = stubProvider({
      model: "jev-stub",
      answers: {
        action: {
          type: "choice",
          choice: "noop",
          confidence: 0.5,
          probabilities: {
            noop: 0.5,
            advance: 0.1,
            advance_jump: 0.1,
            retreat: 0.1,
            defend: 0.1,
            use_ability: 0.05,
            needs_review: 0.05,
          },
        },
        risk: {
          type: "choice",
          choice: "narrow",
          confidence: 0.7,
          probabilities: { clear: 0.1, narrow: 0.7, imminent: 0.15, needs_review: 0.05 },
        },
      },
    });
    const dex = dexWithRules("realtime-action", stub);
    const request = await dex.templates.prepare({
      template: "realtime-action",
      input: {
        tickHz: 9,
        actionSpace: ["noop", "advance", "defend"],
        state: {
          player: { grounded: false },
          hazards: [{ kind: "goomba" }],
          goal: "reach flagpole",
        },
      },
    });
    const response = await dex.choice(request);
    const intents = dex.templates.toActionIntent({
      template: "realtime-action",
      request,
      response,
      decisionId: "dex_test_1",
      model: response.model,
      ruleRefs: [{ id: "realtime-action-local-rules", version: "1.0.0" }],
    });
    expect(intents.length).toBeGreaterThan(0);
    const actionIntent = intents.find((i) => i.questionId === "action") ?? intents[0];
    expect(actionIntent.decisionId).toBe("dex_test_1");
    expect(actionIntent.model).toBe(response.model);
    expect(actionIntent.ruleRefs).toEqual([{ id: "realtime-action-local-rules", version: "1.0.0" }]);
    // Pinned action answer has confidence 1 after merge.
    expect(actionIntent.confidence).toBe(1);
    expect(actionIntent.choice).toBe("defend");
  });

  it("toActionIntent omits evidence fields when not supplied (backward compat)", async () => {
    const stub = stubProvider({
      model: "jev-stub",
      answers: {
        action: {
          type: "choice",
          choice: "noop",
          confidence: 0.5,
          probabilities: {
            noop: 0.5,
            advance: 0.1,
            advance_jump: 0.1,
            retreat: 0.1,
            defend: 0.1,
            use_ability: 0.05,
            needs_review: 0.05,
          },
        },
        risk: {
          type: "choice",
          choice: "clear",
          confidence: 0.6,
          probabilities: { clear: 0.6, narrow: 0.2, imminent: 0.1, needs_review: 0.1 },
        },
      },
    });
    const dex = dexWithRules("realtime-action", stub);
    const request = await dex.templates.prepare({
      template: "realtime-action",
      input: {
        tickHz: 9,
        actionSpace: ["noop", "advance", "defend"],
        state: {
          player: { grounded: false },
          hazards: [{ kind: "goomba" }],
          goal: "reach flagpole",
        },
      },
    });
    const response = await dex.choice(request);
    const intents = dex.templates.toActionIntent({
      template: "realtime-action",
      request,
      response,
    });
    expect(intents.length).toBeGreaterThan(0);
    expect(intents[0].decisionId).toBeUndefined();
    expect(intents[0].model).toBeUndefined();
    expect(intents[0].ruleRefs).toBeUndefined();
  });

  // P2-1: fixtures are accessible via getFixtures() and have a name + input.
  it("templates expose examples.fixtures via getFixtures()", async () => {
    const dex = dexWithRules("realtime-action");
    const fixtures = dex.templates.getFixtures("realtime-action");
    expect(fixtures).toBeDefined();
    expect(fixtures!.length).toBeGreaterThan(0);
    const fixture = fixtures![0];
    expect(fixture.name).toBe("airborne-with-hazard");
    expect(fixture.input).toBeDefined();
    expect(fixture.expected).toEqual({ action: "defend" });
  });

  it("templates without examples.fixtures return undefined", async () => {
    const dex = dexWithRules("email-triage");
    expect(dex.templates.getFixtures("email-triage")).toBeUndefined();
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

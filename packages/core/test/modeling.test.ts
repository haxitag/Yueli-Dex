import { describe, it, expect, vi } from "vitest";
import { createModelingRegistry } from "../src/modeling.js";
import type { CompiledTemplate } from "../src/types.js";
import type { ChoiceRequest, Modeler, ModelingProposal } from "@haxitag/yueli-dex-plugin-sdk";

const sampleTemplate: CompiledTemplate = {
  id: "support-triage",
  version: "1.0.0",
  apiVersion: "yueli-dex-template/v1",
  stateMap: { message: "$.message" },
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
  actions: {},
  modeling: {
    mode: "optional",
    allow: { refineInstructions: true, addCriteria: false, changeActionKinds: false },
    requireEvidenceRefs: true,
  },
};

function makeModeler(proposal: Partial<ModelingProposal>): Modeler {
  return {
    id: "test-modeler",
    propose: vi.fn(async (input) => ({
      id: "proposal-1",
      modelerId: "test-modeler",
      template: input.template,
      proposedRequest: {
        state: "test",
        questions: {
          handler: {
            type: "choice",
            instructions: "Refined question?",
            criteria: { billing: "b", technical: "t", needs_review: "nr" },
          },
        },
      } as ChoiceRequest,
      evidenceRefs: ["ctx://repo/file.ts"],
      ...proposal,
    })),
  };
}

describe("modeling registry", () => {
  it("proposes via a registered modeler", async () => {
    const modeler = makeModeler({});
    const registry = createModelingRegistry({
      modelers: [modeler],
      resolveTemplate: () => sampleTemplate,
    });
    const proposal = await registry.propose({
      modeler: "test-modeler",
      template: "support-triage",
      input: { message: "hello" },
    });
    expect(proposal.id).toBe("proposal-1");
    expect(proposal.modelerId).toBe("test-modeler");
  });

  it("throws for unknown modeler", async () => {
    const registry = createModelingRegistry({
      modelers: [],
      resolveTemplate: () => sampleTemplate,
    });
    await expect(
      registry.propose({ modeler: "nope", input: {} }),
    ).rejects.toMatchObject({ code: "MODELER_NOT_FOUND" });
  });

  it("accepts a valid proposal with refined instructions", async () => {
    const modeler = makeModeler({});
    const registry = createModelingRegistry({
      modelers: [modeler],
      resolveTemplate: () => sampleTemplate,
    });
    const proposal = await registry.propose({
      modeler: "test-modeler",
      template: "support-triage",
      input: { message: "hello" },
    });
    const request = await registry.accept(proposal);
    expect(request.questions.handler.instructions).toBe("Refined question?");
  });

  it("rejects proposal adding criteria when not allowed", async () => {
    const modeler = makeModeler({
      proposedRequest: {
        state: "test",
        questions: {
          handler: {
            type: "choice",
            instructions: "Which team?",
            criteria: {
              billing: "b",
              technical: "t",
              needs_review: "nr",
              new_option: "not allowed",
            },
          },
        },
      } as ChoiceRequest,
    });
    const registry = createModelingRegistry({
      modelers: [modeler],
      resolveTemplate: () => sampleTemplate,
    });
    const proposal = await registry.propose({
      modeler: "test-modeler",
      template: "support-triage",
      input: {},
    });
    await expect(registry.accept(proposal)).rejects.toMatchObject({
      code: "MODELING_PROPOSAL_REJECTED",
    });
  });

  it("rejects proposal when template modeling mode is off", async () => {
    const offTemplate: CompiledTemplate = {
      ...sampleTemplate,
      modeling: { ...sampleTemplate.modeling, mode: "off" },
    };
    const modeler = makeModeler({});
    const registry = createModelingRegistry({
      modelers: [modeler],
      resolveTemplate: () => offTemplate,
    });
    const proposal = await registry.propose({
      modeler: "test-modeler",
      template: "support-triage",
      input: {},
    });
    await expect(registry.accept(proposal)).rejects.toMatchObject({
      code: "MODELING_PROPOSAL_REJECTED",
    });
  });

  it("rejects proposal missing evidence refs when required", async () => {
    const modeler = makeModeler({ evidenceRefs: [] });
    const registry = createModelingRegistry({
      modelers: [modeler],
      resolveTemplate: () => sampleTemplate,
    });
    const proposal = await registry.propose({
      modeler: "test-modeler",
      template: "support-triage",
      input: {},
    });
    await expect(registry.accept(proposal)).rejects.toMatchObject({
      code: "MODELING_PROPOSAL_REJECTED",
    });
  });

  it("accepts proposal without template (no action intent mapping)", async () => {
    const modeler = makeModeler({ template: undefined });
    const registry = createModelingRegistry({
      modelers: [modeler],
      resolveTemplate: () => undefined,
    });
    const proposal = await registry.propose({
      modeler: "test-modeler",
      input: {},
    });
    const request = await registry.accept(proposal);
    expect(request.questions.handler).toBeDefined();
  });

  it("rejects proposal referencing unknown template", async () => {
    const modeler = makeModeler({
      template: { id: "unknown", version: "1.0.0" },
    });
    const registry = createModelingRegistry({
      modelers: [modeler],
      resolveTemplate: () => undefined,
    });
    const proposal = await registry.propose({
      modeler: "test-modeler",
      input: {},
    });
    await expect(registry.accept(proposal)).rejects.toMatchObject({
      code: "MODELING_PROPOSAL_REJECTED",
    });
  });
});

import type {
  Modeler,
  ModelingProposal,
} from "@haxitag/yueli-dex-plugin-sdk";
import { DexError } from "./errors.js";
import type { ModelingRegistry } from "./types.js";
import { validateChoiceRequest } from "./validation.js";
import type { CompiledTemplate } from "./types.js";

export interface ModelingRegistryDeps {
  readonly modelers: readonly Modeler[];
  readonly resolveTemplate: (ref: string) => CompiledTemplate | undefined;
  readonly validateProposalRules?: (
    proposal: ModelingProposal,
    decisionId: string,
  ) => void;
}

export function createModelingRegistry(deps: ModelingRegistryDeps): ModelingRegistry {
  const modelerMap = new Map(deps.modelers.map((m) => [m.id, m]));

  return {
    async propose({ modeler, template, brief, input, context }) {
      const modelerImpl = modelerMap.get(modeler);
      if (!modelerImpl) {
        throw new DexError("MODELER_NOT_FOUND", `Modeler "${modeler}" not found`, {
          decisionId: "modeling",
          recoveryHint: "Register the modeler in DexConfig.modelers.",
        });
      }

      const templateRef = template ? deps.resolveTemplate(template) : undefined;
      const proposal = await modelerImpl.propose({
        template: templateRef ? { id: templateRef.id, version: templateRef.version } : undefined,
        brief,
        input,
        context: context ?? [],
      });

      // Basic structural validation of the proposal
      if (!proposal || typeof proposal !== "object") {
        throw new DexError("MODELING_PROPOSAL_REJECTED", "Modeler returned an invalid proposal", {
          decisionId: "modeling",
        });
      }
      if (typeof proposal.id !== "string" || typeof proposal.modelerId !== "string") {
        throw new DexError("MODELING_PROPOSAL_REJECTED", "Proposal must have id and modelerId", {
          decisionId: "modeling",
        });
      }
      if (!proposal.proposedRequest) {
        throw new DexError("MODELING_PROPOSAL_REJECTED", "Proposal must include proposedRequest", {
          decisionId: "modeling",
        });
      }
      if (!Array.isArray(proposal.evidenceRefs)) {
        throw new DexError("MODELING_PROPOSAL_REJECTED", "Proposal evidenceRefs must be an array", {
          decisionId: "modeling",
        });
      }

      return proposal;
    },

    async accept(proposal) {
      const decisionId = `modeling:${proposal.id}`;

      // If the proposal references a template, validate against its extension policy
      if (proposal.template) {
        const key = `${proposal.template.id}@${proposal.template.version}`;
        const t = deps.resolveTemplate(key) ?? deps.resolveTemplate(proposal.template.id);
        if (!t) {
          throw new DexError(
            "MODELING_PROPOSAL_REJECTED",
            `Proposal references unknown template "${proposal.template.id}@${proposal.template.version}"`,
            { decisionId },
          );
        }
        validateProposalAgainstTemplate(proposal, t, decisionId);
      }

      // Validate the proposed request structurally
      const request = validateChoiceRequest(proposal.proposedRequest, decisionId);

      // Run any rule-based validation
      if (deps.validateProposalRules) {
        deps.validateProposalRules(proposal, decisionId);
      }

      return request;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Template extension policy validation                                */
/* ------------------------------------------------------------------ */

function validateProposalAgainstTemplate(
  proposal: ModelingProposal,
  template: CompiledTemplate,
  decisionId: string,
): void {
  const cfg = template.modeling;

  // If modeling is off, proposal cannot be accepted against this template
  if (cfg.mode === "off") {
    throw new DexError(
      "MODELING_PROPOSAL_REJECTED",
      `Template "${template.id}" does not allow dynamic modeling`,
      { decisionId },
    );
  }

  // Evidence refs requirement
  if (cfg.requireEvidenceRefs && proposal.evidenceRefs.length === 0) {
    throw new DexError(
      "MODELING_PROPOSAL_REJECTED",
      `Template "${template.id}" requires evidence references`,
      { decisionId },
    );
  }

  const proposed = proposal.proposedRequest;
  if (!proposed || !proposed.questions) return;

  // Compare each proposed question against the template
  for (const choice of template.choices) {
    const proposedQ = proposed.questions[choice.id];
    if (!proposedQ) continue;

    // Check criteria changes
    const templateKeys = Object.keys(choice.criteria);
    const proposedKeys = Object.keys(proposedQ.criteria);

    const added = proposedKeys.filter((k) => !templateKeys.includes(k));
    if (added.length > 0 && !cfg.allow.addCriteria) {
      throw new DexError(
        "MODELING_PROPOSAL_REJECTED",
        `Template "${template.id}" does not allow adding criteria: ${added.join(", ")}`,
        { decisionId },
      );
    }

    // Instructions refinement
    if (proposedQ.instructions !== choice.instructions && !cfg.allow.refineInstructions) {
      throw new DexError(
        "MODELING_PROPOSAL_REJECTED",
        `Template "${template.id}" does not allow refining instructions`,
        { decisionId },
      );
    }
  }

  // Action kinds check: verify that any new criteria have a mappable action
  if (!cfg.allow.changeActionKinds && template.constraints.allowedActionKinds) {
    // Already enforced at action mapping time; here we just ensure proposal doesn't
    // introduce action kinds not in the allowlist. We can't see actions in the proposal,
    // but we can check that new criteria are within allowed action kinds if the template
    // defines actions. This is enforced at toActionIntent time.
  }
}

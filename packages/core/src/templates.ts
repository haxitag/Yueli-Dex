import type {
  ActionIntent,
  ChoiceRequest,
  JsonValue,
} from "@haxitag/yueli-dex-plugin-sdk";
import { DexError } from "./errors.js";
import { validateChoiceRequest } from "./validation.js";
import type {
  CompiledChoice,
  CompiledTemplate,
  TemplateFixture,
  TemplateModelingConfig,
  TemplatePack,
  TemplateRegistry,
} from "./types.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* ------------------------------------------------------------------ */
/* Template parsing & compilation                                      */
/* ------------------------------------------------------------------ */

function parseTemplate(raw: JsonValue, packId: string, packVersion: string): CompiledTemplate {
  if (!isPlainObject(raw)) {
    throw new DexError("TEMPLATE_INVALID", `Template in pack "${packId}" must be an object`, {
      decisionId: "template-engine",
    });
  }
  const t = raw as Record<string, unknown>;

  if (t.apiVersion !== "yueli-dex-template/v1") {
    throw new DexError(
      "TEMPLATE_INVALID",
      `Template "${String(t.id)}" has unsupported apiVersion "${String(t.apiVersion)}"`,
      { decisionId: "template-engine" },
    );
  }

  const id = t.id;
  const version = t.version ?? packVersion;
  if (typeof id !== "string") {
    throw new DexError("TEMPLATE_INVALID", `Template in pack "${packId}" must have a string id`, {
      decisionId: "template-engine",
    });
  }

  // State mapping
  const stateMap: Record<string, string> = {};
  if (t.state !== undefined) {
    if (!isPlainObject(t.state)) {
      throw new DexError("TEMPLATE_INVALID", `Template "${id}" state must be an object`, {
        decisionId: "template-engine",
      });
    }
    const from = (t.state as Record<string, unknown>).from;
    if (from !== undefined) {
      if (!isPlainObject(from)) {
        throw new DexError("TEMPLATE_INVALID", `Template "${id}" state.from must be an object`, {
          decisionId: "template-engine",
        });
      }
      for (const [target, source] of Object.entries(from as Record<string, unknown>)) {
        if (typeof source !== "string") {
          throw new DexError(
            "TEMPLATE_INVALID",
            `Template "${id}" state.from.${target} must be a JSON path string`,
            { decisionId: "template-engine" },
          );
        }
        stateMap[target] = source;
      }
    }
  }

  // Choices
  const rawChoices = t.choices ?? t.choice;
  const choices: CompiledChoice[] = [];
  if (Array.isArray(rawChoices)) {
    for (const c of rawChoices) {
      choices.push(parseChoice(c, id));
    }
  } else if (isPlainObject(rawChoices)) {
    choices.push(parseChoice(rawChoices, id));
  } else {
    throw new DexError("TEMPLATE_INVALID", `Template "${id}" must define choices`, {
      decisionId: "template-engine",
    });
  }

  if (choices.length === 0) {
    throw new DexError("TEMPLATE_INVALID", `Template "${id}" must define at least one choice`, {
      decisionId: "template-engine",
    });
  }

  // Constraints
  const constraints: {
    requireFallbackOption?: string;
    maxOptions?: number;
    allowedActionKinds?: readonly string[];
  } = {};
  if (t.constraints !== undefined) {
    if (!isPlainObject(t.constraints)) {
      throw new DexError("TEMPLATE_INVALID", `Template "${id}" constraints must be an object`, {
        decisionId: "template-engine",
      });
    }
    const c = t.constraints as Record<string, unknown>;
    if (c.requireFallbackOption !== undefined) {
      if (typeof c.requireFallbackOption !== "string") {
        throw new DexError("TEMPLATE_INVALID", `Template "${id}" requireFallbackOption must be a string`, {
          decisionId: "template-engine",
        });
      }
      constraints.requireFallbackOption = c.requireFallbackOption;
    }
    if (c.maxOptions !== undefined) {
      if (typeof c.maxOptions !== "number") {
        throw new DexError("TEMPLATE_INVALID", `Template "${id}" maxOptions must be a number`, {
          decisionId: "template-engine",
        });
      }
      constraints.maxOptions = c.maxOptions;
    }
    if (c.allowedActionKinds !== undefined) {
      if (!Array.isArray(c.allowedActionKinds) || !c.allowedActionKinds.every((x) => typeof x === "string")) {
        throw new DexError("TEMPLATE_INVALID", `Template "${id}" allowedActionKinds must be a string array`, {
          decisionId: "template-engine",
        });
      }
      constraints.allowedActionKinds = c.allowedActionKinds;
    }
  }

  // Actions
  const actions: Record<string, Record<string, JsonValue>> = {};
  if (t.actions !== undefined) {
    if (!isPlainObject(t.actions)) {
      throw new DexError("TEMPLATE_INVALID", `Template "${id}" actions must be an object`, {
        decisionId: "template-engine",
      });
    }
    for (const [qid, qactions] of Object.entries(t.actions as Record<string, unknown>)) {
      if (!isPlainObject(qactions)) {
        throw new DexError("TEMPLATE_INVALID", `Template "${id}" actions.${qid} must be an object`, {
          decisionId: "template-engine",
        });
      }
      actions[qid] = {};
      for (const [opt, intent] of Object.entries(qactions as Record<string, unknown>)) {
        if (!isPlainObject(intent)) {
          throw new DexError("TEMPLATE_INVALID", `Template "${id}" actions.${qid}.${opt} must be an object`, {
            decisionId: "template-engine",
          });
        }
        actions[qid][opt] = intent as JsonValue;
      }
    }
  }

  // Modeling config
  let mode: TemplateModelingConfig["mode"] = "off";
  let allow: TemplateModelingConfig["allow"] = {
    refineInstructions: false,
    addCriteria: false,
    changeActionKinds: false,
  };
  let requireEvidenceRefs = false;
  if (t.modeling !== undefined) {
    if (!isPlainObject(t.modeling)) {
      throw new DexError("TEMPLATE_INVALID", `Template "${id}" modeling must be an object`, {
        decisionId: "template-engine",
      });
    }
    const m = t.modeling as Record<string, unknown>;
    if (m.mode !== undefined) {
      if (m.mode !== "off" && m.mode !== "optional" && m.mode !== "required") {
        throw new DexError("TEMPLATE_INVALID", `Template "${id}" modeling.mode must be off|optional|required`, {
          decisionId: "template-engine",
        });
      }
      mode = m.mode;
    }
    if (m.allow !== undefined) {
      if (!isPlainObject(m.allow)) {
        throw new DexError("TEMPLATE_INVALID", `Template "${id}" modeling.allow must be an object`, {
          decisionId: "template-engine",
        });
      }
      const a = m.allow as Record<string, unknown>;
      allow = {
        refineInstructions: a.refineInstructions === true,
        addCriteria: a.addCriteria === true,
        changeActionKinds: a.changeActionKinds === true,
      };
    }
    if (m.requireEvidenceRefs !== undefined) {
      requireEvidenceRefs = m.requireEvidenceRefs === true;
    }
  }
  const modeling: TemplateModelingConfig = { mode, allow, requireEvidenceRefs };

  // P2-1: optional examples.fixtures attached to the template.
  const fixtures = parseExamples(t, id);

  return {
    id,
    version: typeof version === "string" ? version : packVersion,
    apiVersion: t.apiVersion as string,
    stateMap,
    choices,
    constraints,
    actions,
    modeling,
    ...(fixtures && fixtures.length > 0 ? { fixtures } : {}),
  };
}

/**
 * Parse the optional `examples.fixtures` array. Each fixture is a named
 * input/expected pair. We validate names and basic shape; expected values
 * are kept loose (any JSON object) so fixtures can assert partial state.
 */
function parseExamples(t: Record<string, unknown>, templateId: string): TemplateFixture[] | undefined {
  const examples = t.examples;
  if (examples === undefined) return undefined;
  if (!isPlainObject(examples)) {
    throw new DexError(
      "TEMPLATE_INVALID",
      `Template "${templateId}" examples must be an object`,
      { decisionId: "template-engine" },
    );
  }
  const rawFixtures = (examples as Record<string, unknown>).fixtures;
  if (rawFixtures === undefined) return undefined;
  if (!Array.isArray(rawFixtures)) {
    throw new DexError(
      "TEMPLATE_INVALID",
      `Template "${templateId}" examples.fixtures must be an array`,
      { decisionId: "template-engine" },
    );
  }
  return rawFixtures.map((f, i) => {
    if (!isPlainObject(f)) {
      throw new DexError(
        "TEMPLATE_INVALID",
        `Template "${templateId}" fixture #${i} must be an object`,
        { decisionId: "template-engine" },
      );
    }
    const name = (f as Record<string, unknown>).name;
    if (typeof name !== "string" || name.length === 0) {
      throw new DexError(
        "TEMPLATE_INVALID",
        `Template "${templateId}" fixture #${i} must have a non-empty name`,
        { decisionId: "template-engine" },
      );
    }
    const input = (f as Record<string, unknown>).input;
    if (input === undefined) {
      throw new DexError(
        "TEMPLATE_INVALID",
        `Template "${templateId}" fixture "${name}" must have an input field`,
        { decisionId: "template-engine" },
      );
    }
    const expected = (f as Record<string, unknown>).expected;
    return {
      name,
      input: input as JsonValue,
      ...(isPlainObject(expected) ? { expected: expected as Readonly<Record<string, unknown>> } : {}),
    };
  });
}

function parseChoice(raw: unknown, templateId: string): CompiledChoice {
  if (!isPlainObject(raw)) {
    throw new DexError("TEMPLATE_INVALID", `Template "${templateId}" choice must be an object`, {
      decisionId: "template-engine",
    });
  }
  const c = raw as Record<string, unknown>;
  if (typeof c.id !== "string") {
    throw new DexError("TEMPLATE_INVALID", `Template "${templateId}" choice must have a string id`, {
      decisionId: "template-engine",
    });
  }
  if (c.instructions === undefined) {
    throw new DexError("TEMPLATE_INVALID", `Template "${templateId}" choice "${c.id}" must have instructions`, {
      decisionId: "template-engine",
    });
  }
  if (!isPlainObject(c.criteria)) {
    throw new DexError("TEMPLATE_INVALID", `Template "${templateId}" choice "${c.id}" must have criteria object`, {
      decisionId: "template-engine",
    });
  }
  const criteria: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(c.criteria as Record<string, unknown>)) {
    criteria[k] = v as JsonValue;
  }
  return {
    id: c.id,
    instructions: c.instructions as JsonValue,
    criteria,
  };
}

/* ------------------------------------------------------------------ */
/* JSON path resolution for template state mapping                     */
/* ------------------------------------------------------------------ */

function resolveJsonPath(path: string, input: JsonValue): JsonValue | undefined {
  if (!path.startsWith("$.")) return path as JsonValue;
  const segments = path.slice(2).split(".");
  let current: unknown = input;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    const parts = seg.split(/\[(\d+)\]/).filter((p) => p !== "");
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (/^\d+$/.test(part)) {
        if (Array.isArray(current)) current = current[Number(part)];
        else return undefined;
      } else if (isPlainObject(current)) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
  }
  return current as JsonValue | undefined;
}

/* ------------------------------------------------------------------ */
/* Registry implementation                                             */
/* ------------------------------------------------------------------ */

export function createTemplateRegistry(
  packs: readonly TemplatePack[],
): TemplateRegistry & { getCompiled: (ref: string) => CompiledTemplate | undefined } {
  const templates = new Map<string, CompiledTemplate>();

  for (const pack of packs) {
    for (const raw of pack.templates) {
      const compiled = parseTemplate(raw, pack.id, pack.version);
      const key = `${compiled.id}@${compiled.version}`;
      templates.set(key, compiled);
      // Also allow lookup by id alone (latest version)
      templates.set(compiled.id, compiled);
    }
  }

  function resolveTemplate(ref: string): CompiledTemplate {
    const t = templates.get(ref);
    if (!t) {
      throw new DexError("TEMPLATE_NOT_FOUND", `Template "${ref}" not found`, {
        decisionId: "template-engine",
        recoveryHint: "Install the template pack or check the template id/version.",
      });
    }
    return t;
  }

  return {
    async prepare({ template, input, context: _context }) {
      const compiled = resolveTemplate(template);
      const decisionId = `template:${compiled.id}@${compiled.version}`;

      // Build state from mapping
      const state: Record<string, JsonValue> = {};
      for (const [target, sourcePath] of Object.entries(compiled.stateMap)) {
        const val = resolveJsonPath(sourcePath, input);
        if (val !== undefined) {
          state[target] = val;
        }
      }
      // If no state mapping, use the whole input as state
      let finalState: JsonValue;
      if (Object.keys(state).length > 0) {
        finalState = state;
      } else {
        finalState = input;
      }

      // Build questions
      const questions: Record<string, { type: "choice"; instructions: JsonValue; criteria: Record<string, JsonValue> }> = {};
      for (const choice of compiled.choices) {
        questions[choice.id] = {
          type: "choice",
          instructions: choice.instructions,
          criteria: { ...choice.criteria },
        };
      }

      // Enforce constraints
      for (const choice of compiled.choices) {
        const criteriaKeys = Object.keys(choice.criteria);
        if (compiled.constraints.maxOptions && criteriaKeys.length > compiled.constraints.maxOptions) {
          throw new DexError(
            "TEMPLATE_INVALID",
            `Template "${compiled.id}" choice "${choice.id}" exceeds maxOptions`,
            { decisionId },
          );
        }
        if (compiled.constraints.requireFallbackOption &&
            !criteriaKeys.includes(compiled.constraints.requireFallbackOption)) {
          throw new DexError(
            "TEMPLATE_INVALID",
            `Template "${compiled.id}" choice "${choice.id}" missing required fallback option "${compiled.constraints.requireFallbackOption}"`,
            { decisionId },
          );
        }
      }

      const request: ChoiceRequest = {
        state: finalState,
        questions,
      };

      // Validate before returning
      return validateChoiceRequest(request, decisionId);
    },

    toActionIntent({ template, request: _request, response, decisionId, model, ruleRefs }) {
      const compiled = resolveTemplate(template);
      const intents: ActionIntent[] = [];

      for (const [qid, qactions] of Object.entries(compiled.actions)) {
        const answer = response.answers[qid];
        if (!answer) continue;
        const intentDef = qactions[answer.choice];
        if (!intentDef || !isPlainObject(intentDef)) continue;

        const kind = (intentDef as Record<string, unknown>).kind;
        if (typeof kind !== "string") continue;

        // Enforce allowed action kinds
        if (compiled.constraints.allowedActionKinds &&
            !compiled.constraints.allowedActionKinds.includes(kind)) {
          continue;
        }

        const params: Record<string, JsonValue> = {};
        for (const [k, v] of Object.entries(intentDef as Record<string, unknown>)) {
          if (k !== "kind") params[k] = v as JsonValue;
        }

        intents.push({
          template: { id: compiled.id, version: compiled.version },
          questionId: qid,
          choice: answer.choice,
          kind,
          params: Object.keys(params).length > 0 ? params : undefined,
          // P1-5: evidence fields — only emitted when supplied.
          ...(decisionId ? { decisionId } : {}),
          ...(model ? { model } : {}),
          ...(answer.confidence !== undefined ? { confidence: answer.confidence } : {}),
          ...(answer.probabilities ? { probabilities: answer.probabilities } : {}),
          ...(ruleRefs && ruleRefs.length > 0 ? { ruleRefs } : {}),
        });
      }

      return intents;
    },

    getCompiled(ref: string): CompiledTemplate | undefined {
      return templates.get(ref);
    },

    /** P2-1: expose fixtures for CLI / playground regression runs. */
    getFixtures(ref: string): readonly TemplateFixture[] | undefined {
      return templates.get(ref)?.fixtures;
    },
  };
}

/**
 * @haxitag/yueli-dex-plugin-sdk
 *
 * Versioned contracts for Yueli DEX plugins:
 * providers, template-packs, modelers, and context-providers.
 *
 * These contracts are deliberately stable. A plugin written against
 * yueli-dex-plugin/v1 must remain loadable by any compatible DEX runtime.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

/* ------------------------------------------------------------------ */
/* Canonical Jev Choice contract                                       */
/* ------------------------------------------------------------------ */

export interface ChoiceQuestion {
  readonly type: "choice";
  readonly instructions: JsonValue;
  readonly criteria: Readonly<Record<string, JsonValue>>;
}

/** Optional yes/no criteria, mirroring the Decisions API noul question shape. */
export interface NoulCriteria {
  readonly true_description?: string;
  readonly false_description?: string;
}

/** Yes/no question. The answer is the calibrated probability that it holds. */
export interface NoulQuestion {
  readonly type: "noul";
  readonly instructions: JsonValue;
  readonly criteria?: NoulCriteria;
}

/** Ordered rubric question. Levels are lowest first; index 0 is the lowest. */
export interface ScoreQuestion {
  readonly type: "score";
  readonly instructions: JsonValue;
  readonly criteria: readonly string[];
}

export type DecisionQuestion = ChoiceQuestion | NoulQuestion | ScoreQuestion;
export type DecisionQuestionType = DecisionQuestion["type"];

export interface ChoiceRequest {
  readonly state: JsonValue;
  readonly model?: string;
  readonly questions: Readonly<Record<string, DecisionQuestion>>;
}

export interface ChoiceAnswer {
  readonly type: "choice";
  readonly choice: string;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

export interface NoulAnswer {
  readonly type: "noul";
  /** Probability that the condition holds. */
  readonly noul: number;
  readonly confidence: number;
}

export interface ScoreAnswer {
  readonly type: "score";
  /** Probability-weighted average of the level indices (may fall between levels). */
  readonly score: number;
  readonly confidence: number;
  /** Level index as a string ("0", "1", …) mapped to its probability; sums to 1. */
  readonly probabilities: Readonly<Record<string, number>>;
  /** Level index mapped back to its description, when the provider returns it. */
  readonly legend?: Readonly<Record<string, string>>;
}

export type DecisionAnswer = ChoiceAnswer | NoulAnswer | ScoreAnswer;

export interface DecisionUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
  /** Optional per-modality breakdown (text, image, audio, …). */
  readonly input_tokens_by_modality?: readonly {
    readonly modality: string;
    readonly tokens: number;
  }[];
}

export interface ChoiceResponse {
  readonly model: string;
  readonly answers: Readonly<Record<string, DecisionAnswer>>;
  readonly usage?: DecisionUsage;
}

/** Aliases for callers that treat the contract as a general decision API. */
export type DecisionRequest = ChoiceRequest;
export type DecisionResponse = ChoiceResponse;

/* ------------------------------------------------------------------ */
/* Provider contract                                                   */
/* ------------------------------------------------------------------ */

export interface ProviderManifest {
  readonly id: string;
  readonly apiVersion: "yueli-dex-plugin/v1";
  readonly kind: "provider";
  readonly version: string;
  /**
   * Question types the provider can answer first, followed by any additional
   * capability tags (e.g. "multimodal"). Routing only sends a request to a
   * provider whose capabilities cover every question type in the request.
   */
  readonly capabilities: readonly [DecisionQuestionType, ...string[]];
}

export interface ProviderHealthContext {
  readonly now: string;
  readonly deadlineMs: number;
}

export interface ProviderHealth {
  readonly available: boolean;
  readonly observedP95LatencyMs?: number;
  readonly recentErrorRate?: number;
}

export interface ProviderCallContext {
  readonly decisionId: string;
  readonly requestHash: string;
  readonly deadlineMs: number;
  readonly attempt: number;
}

export interface ChoiceProvider {
  readonly manifest: ProviderManifest;
  /**
   * P1-1: optional cost estimate per request. Used by routing scoring.
   * When absent, the router treats the provider as zero-cost.
   */
  readonly estimate?: { readonly costUsd?: number };
  health(context: ProviderHealthContext): Promise<ProviderHealth>;
  execute(
    request: ChoiceRequest,
    context: ProviderCallContext,
  ): Promise<ChoiceResponse>;
}

/* ------------------------------------------------------------------ */
/* Template-pack contract                                              */
/* ------------------------------------------------------------------ */

export interface TemplatePackManifest {
  readonly apiVersion: "yueli-dex-plugin/v1";
  readonly id: string;
  readonly kind: "template-pack";
  readonly version: string;
  readonly templates: readonly JsonValue[];
}

/* ------------------------------------------------------------------ */
/* Modeler contract                                                    */
/* ------------------------------------------------------------------ */

export interface ModelingProposal {
  readonly id: string;
  readonly modelerId: string;
  readonly template?: { readonly id: string; readonly version: string };
  readonly proposedRequest: ChoiceRequest;
  readonly evidenceRefs: readonly string[];
  readonly routeHint?: string;
}

export interface Modeler {
  readonly id: string;
  propose(input: {
    readonly template?: { readonly id: string; readonly version: string };
    readonly brief?: string;
    readonly input: JsonValue;
    readonly context: readonly ContextSnapshot[];
  }): Promise<ModelingProposal>;
}

/* ------------------------------------------------------------------ */
/* Context-provider contract                                           */
/* ------------------------------------------------------------------ */

export interface ContextSnapshot {
  readonly providerId: string;
  readonly uri: string;
  readonly content: JsonValue;
  readonly redactionApplied: boolean;
}

export interface ContextProvider {
  readonly id: string;
  snapshot(request: {
    readonly paths: readonly string[];
    readonly maxTokens: number;
    readonly redact: readonly string[];
  }): Promise<readonly ContextSnapshot[]>;
}

/* ------------------------------------------------------------------ */
/* ActionIntent (template -> downstream)                               */
/* ------------------------------------------------------------------ */

export interface ActionIntent {
  readonly template: { readonly id: string; readonly version: string };
  readonly questionId: string;
  readonly choice: string;
  readonly kind: string;
  readonly params?: JsonValue;
  /** P1-5: evidence fields. All optional — older callers are unaffected. */
  /** Unique decision ID from DecisionReceipt.decisionId. */
  readonly decisionId?: string;
  /** Confidence score from the underlying ChoiceAnswer. */
  readonly confidence?: number;
  /** Per-choice probabilities from ChoiceAnswer.probabilities. */
  readonly probabilities?: Readonly<Record<string, number>>;
  /** Rule sets that fired during this decision (shortCircuit or constrain). */
  readonly ruleRefs?: readonly { readonly id: string; readonly version: string }[];
  /** Decision source identifier — local rule model id, or provider model id. */
  readonly model?: string;
}

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

export interface ChoiceRequest {
  readonly state: JsonValue;
  readonly model?: string;
  readonly questions: Readonly<Record<string, ChoiceQuestion>>;
}

export interface ChoiceAnswer {
  readonly type: "choice";
  readonly choice: string;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

export interface ChoiceResponse {
  readonly model: string;
  readonly answers: Readonly<Record<string, ChoiceAnswer>>;
  readonly usage?: {
    readonly input_tokens: number;
    readonly output_tokens: number;
  };
}

/* ------------------------------------------------------------------ */
/* Provider contract                                                   */
/* ------------------------------------------------------------------ */

export interface ProviderManifest {
  readonly id: string;
  readonly apiVersion: "yueli-dex-plugin/v1";
  readonly kind: "provider";
  readonly version: string;
  readonly capabilities: readonly ["choice", ...string[]];
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

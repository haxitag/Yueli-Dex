import type {
  ActionIntent,
  ChoiceProvider,
  ChoiceRequest,
  ChoiceResponse,
  ContextProvider,
  ContextSnapshot,
  JsonValue,
  Modeler,
  ModelingProposal,
} from "@haxitag/yueli-dex-plugin-sdk";
import type { RouteFailureReason } from "./errors.js";

// Re-export plugin-sdk types that internal modules import from here.
export type {
  ActionIntent,
  ChoiceProvider,
  ChoiceRequest,
  ChoiceResponse,
  ContextProvider,
  ContextSnapshot,
  JsonValue,
  Modeler,
  ModelingProposal,
};
export type { RouteFailureReason };

/* ------------------------------------------------------------------ */
/* Public API types                                                    */
/* ------------------------------------------------------------------ */

export interface ChoiceCallOptions {
  /** A route name declared in DexConfig.routing; an unknown name is rejected. */
  readonly route?: string;
  /** Positive wall-clock deadline in milliseconds; policy may impose a smaller maximum. */
  readonly deadlineMs?: number;
}

export type DexEventName = "choice.completed" | "choice.failed";

export type Unsubscribe = () => void;

export interface DexEvent {
  readonly request: ChoiceRequest;
  readonly response?: ChoiceResponse;
  readonly receipt: DecisionReceipt;
  readonly error?: Error;
}

export type DexEventListener = (event: DexEvent) => void;

export interface Dex {
  choice(request: ChoiceRequest, options?: ChoiceCallOptions): Promise<ChoiceResponse>;
  on(event: DexEventName, listener: DexEventListener): Unsubscribe;
  templates: TemplateRegistry;
  modeling: ModelingRegistry;
}

export interface DexConfig {
  readonly providers: readonly ChoiceProvider[];
  readonly routing: RoutingConfig;
  readonly ruleSets?: readonly RuleSet[];
  readonly templates?: readonly TemplatePack[];
  readonly modelers?: readonly Modeler[];
  readonly contextProviders?: readonly ContextProvider[];
  readonly receiptStore?: ReceiptStore;
}

/* ------------------------------------------------------------------ */
/* Routing types                                                       */
/* ------------------------------------------------------------------ */

export interface RoutePolicy {
  readonly providerIds: readonly string[];
  readonly maxEstimatedCostUsd?: number;
  readonly p95LatencyMs?: number;
  readonly maxAttempts: number;
  readonly circuitFailureThreshold: number;
  readonly circuitCooldownMs: number;
  readonly retryableStatusCodes?: readonly number[];
  /**
   * P0-5: how long a half-open probe may hang before the circuit is treated
   * as failed. Defaults to `circuitCooldownMs / 2`.
   */
  readonly probeTimeoutMs?: number;
  /**
   * P1-1: scoring penalties. Weights are applied additively to a per-provider
   * score (lower is better). Defaults: latency 1.0, error 2.0, cost 1.5.
   */
  readonly scoring?: {
    readonly latencyWeight?: number;
    readonly errorWeight?: number;
    readonly costWeight?: number;
    /** Threshold above which p95 penalty kicks in. */
    readonly latencyPenaltyFloorMs?: number;
    /** Threshold above which errorRate penalty kicks in (0..1). */
    readonly errorPenaltyFloorRate?: number;
  };
}

/**
 * P1-1: per-candidate routing decision. Lower score = higher preference.
 * Surface on `DecisionReceipt.route.routing.decisions` so callers can audit
 * why a provider was selected — the original implementation only sorted by
 * static `providerIds` order and silently ignored cost/latency/error.
 */
export interface RouteDecision {
  readonly providerId: string;
  readonly score: number;
  readonly eligible: boolean;
  readonly reasons: readonly RouteDecisionReason[];
  readonly observation: {
    readonly sampleCount: number;
    readonly p95Ms?: number;
    readonly errorRate?: number;
    readonly avgLatencyMs?: number;
  };
}

export type RouteDecisionReason =
  | { readonly factor: "priority"; readonly delta: number; readonly note: string }
  | { readonly factor: "latency"; readonly delta: number; readonly note: string }
  | { readonly factor: "error"; readonly delta: number; readonly note: string }
  | { readonly factor: "cost"; readonly delta: number; readonly note: string }
  | { readonly factor: "circuit"; readonly delta: number; readonly note: string }
  | { readonly factor: "health"; readonly delta: number; readonly note: string }
  | { readonly factor: "ineligible"; readonly delta: number; readonly note: string };

export interface RoutingTrace {
  readonly policy: string; // route name or "default"
  readonly candidates: readonly string[];
  readonly decisions: readonly RouteDecision[];
  readonly selectedProviderId: string;
}

export interface RoutingConfig {
  readonly default: RoutePolicy;
  readonly named?: Readonly<Record<string, RoutePolicy>>;
}

/* ------------------------------------------------------------------ */
/* Rules types                                                         */
/* ------------------------------------------------------------------ */

export type RuleScope = "template" | "organization" | "environment" | "call";

export interface RuleSet {
  readonly id: string;
  readonly version: string;
  readonly scope: RuleScope;
  readonly document: JsonValue;
}

/* ------------------------------------------------------------------ */
/* Template types                                                      */
/* ------------------------------------------------------------------ */

export interface TemplatePack {
  readonly id: string;
  readonly version: string;
  readonly templates: readonly JsonValue[];
}

export interface TemplateRegistry {
  prepare(input: {
    readonly template: string;
    readonly input: JsonValue;
    readonly context?: readonly ContextSnapshot[];
  }): Promise<ChoiceRequest>;
  toActionIntent(input: {
    readonly template: string;
    readonly request: ChoiceRequest;
    readonly response: ChoiceResponse;
    /**
     * P1-5: optional evidence carried into each emitted ActionIntent.
     * `decisionId`/`model`/`ruleRefs` are typically derived from the
     * DecisionReceipt; `confidence`/`probabilities` mirror ChoiceAnswer.
     */
    readonly decisionId?: string;
    readonly model?: string;
    readonly ruleRefs?: readonly { readonly id: string; readonly version: string }[];
  }): readonly ActionIntent[];

  /** P2-1: read evaluation fixtures attached to a template. */
  getFixtures(ref: string): readonly TemplateFixture[] | undefined;
}

/* ------------------------------------------------------------------ */
/* Modeling types                                                      */
/* ------------------------------------------------------------------ */

export interface ModelingRegistry {
  propose(input: {
    readonly modeler: string;
    readonly template?: string;
    readonly brief?: string;
    readonly input: JsonValue;
    readonly context?: readonly ContextSnapshot[];
  }): Promise<ModelingProposal>;
  accept(proposal: ModelingProposal): Promise<ChoiceRequest>;
}

/* ------------------------------------------------------------------ */
/* Audit / receipt types                                               */
/* ------------------------------------------------------------------ */

export interface ProviderAttempt {
  readonly providerId: string;
  readonly startedAt: string;
  readonly elapsedMs: number;
  readonly outcome: "success" | "failed" | "timed_out" | "rate_limited";
  readonly failureCode?: string;
}

export interface DecisionReceipt {
  readonly decisionId: string;
  readonly requestHash: string;
  readonly template?: { readonly id: string; readonly version: string };
  readonly rules: readonly { readonly id: string; readonly version: string }[];
  readonly route: {
    readonly eligibleProviderIds: readonly string[];
    readonly selectedProviderId: string;
    readonly attempts: readonly ProviderAttempt[];
    /** Why this route exited. Absent on success; populated on every failure. */
    readonly reason?: RouteFailureReason;
    /** P1-1: routing scoring trace. Absent on hard failures before ordering. */
    readonly routing?: RoutingTrace;
  };
  readonly timing: { readonly startedAt: string; readonly elapsedMs: number };
  readonly usage?: ChoiceResponse["usage"];
}

export interface ReceiptStore {
  append(receipt: DecisionReceipt): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Internal: compiled template shape                                   */
/* ------------------------------------------------------------------ */

export interface CompiledTemplate {
  readonly id: string;
  readonly version: string;
  readonly apiVersion: string;
  readonly stateMap: Readonly<Record<string, string>>;
  readonly choices: readonly CompiledChoice[];
  readonly constraints: TemplateConstraints;
  readonly actions: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>;
  readonly modeling: TemplateModelingConfig;
  /** P2-1: optional evaluation fixtures attached to the template. */
  readonly fixtures?: readonly TemplateFixture[];
}

/**
 * P2-1: a named input/expected pair for regression. Used by `cli` and the
 * playground to verify a template's local rules and provider selection.
 * `expected` is intentionally untyped — fixtures may assert partial state
 * (e.g. just `priority`) or full answers.
 */
export interface TemplateFixture {
  readonly name: string;
  readonly input: JsonValue;
  readonly expected?: Readonly<Record<string, unknown>>;
}

export interface CompiledChoice {
  readonly id: string;
  readonly instructions: JsonValue;
  readonly criteria: Readonly<Record<string, JsonValue>>;
}

export interface TemplateConstraints {
  readonly requireFallbackOption?: string;
  readonly maxOptions?: number;
  readonly allowedActionKinds?: readonly string[];
}

export interface TemplateModelingConfig {
  readonly mode: "off" | "optional" | "required";
  readonly allow: {
    readonly refineInstructions: boolean;
    readonly addCriteria: boolean;
    readonly changeActionKinds: boolean;
  };
  readonly requireEvidenceRefs: boolean;
}

/* ------------------------------------------------------------------ */
/* Internal: rule evaluation result                                    */
/* ------------------------------------------------------------------ */

export type RuleActionKind = "reject" | "constrain" | "route" | "shortCircuit";

export interface RuleMatch {
  readonly ruleId: string;
  readonly ruleSetId: string;
  readonly ruleSetVersion: string;
  /** P1-3: the scope of the rule set that produced this match. */
  readonly scope: RuleScope;
  readonly action: {
    readonly kind: RuleActionKind;
    readonly message?: string;
    readonly requireFallbackOption?: string;
    readonly route?: string;
    readonly questionId?: string;
    readonly choice?: string;
    readonly allowedActionKinds?: readonly string[];
  };
}

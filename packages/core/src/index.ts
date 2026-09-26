/**
 * @haxitag/yueli-dex
 *
 * Yueli DEX — Choice-only Decision Execution Framework for AI Agents.
 *
 * Public API surface:
 * - createDex(config): Dex
 * - Dex.choice(request, options?): Promise<ChoiceResponse>
 * - Dex.on(event, listener): Unsubscribe
 * - Dex.templates.prepare / toActionIntent
 * - Dex.modeling.propose / accept
 */

// Re-export canonical Jev Choice types and plugin contracts
export type {
  ActionIntent,
  ChoiceAnswer,
  ChoiceProvider,
  ChoiceQuestion,
  ChoiceRequest,
  ChoiceResponse,
  ContextProvider,
  ContextSnapshot,
  JsonValue,
  Modeler,
  ModelingProposal,
  ProviderCallContext,
  ProviderHealth,
  ProviderHealthContext,
  ProviderManifest,
} from "@haxitag/yueli-dex-plugin-sdk";

// DEX public types
export type {
  ChoiceCallOptions,
  DecisionReceipt,
  Dex,
  DexConfig,
  DexEvent,
  DexEventListener,
  DexEventName,
  ProviderAttempt,
  ReceiptStore,
  RoutePolicy,
  RoutingConfig,
  RuleScope,
  RuleSet,
  TemplatePack,
  TemplateRegistry,
  ModelingRegistry,
  Unsubscribe,
} from "./types.js";

export { DexError, isDexError } from "./errors.js";
export type { DexErrorCode } from "./errors.js";
export { createDex } from "./dex.js";

// Re-export rule engine and template compiler for advanced users / testing
export { createRuleEngine } from "./rules.js";
export { createTemplateRegistry } from "./templates.js";
export { validateChoiceRequest, validateChoiceResponse, buildShortCircuitResponse, buildPinnedAnswer, applyPinnedAnswers } from "./validation.js";

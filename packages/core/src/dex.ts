import type {
  ChoiceRequest,
} from "@haxitag/yueli-dex-plugin-sdk";
import { DexEventEmitter } from "./events.js";
import { DexError, isDexError } from "./errors.js";
import { createModelingRegistry } from "./modeling.js";
import { createRuleEngine } from "./rules.js";
import { createCircuitBreaker, createHealthCache, executeRoute } from "./routing.js";
import { createTemplateRegistry } from "./templates.js";
import type {
  DecisionReceipt,
  Dex,
  DexConfig,
  ProviderAttempt,
} from "./types.js";
import { generateDecisionId, hashRequest } from "./utils.js";
import { validateChoiceRequest } from "./validation.js";

/**
 * Create a DEX instance.
 *
 * The instance owns provider routing, the rule engine, template and modeling
 * registries, and an event emitter for audit receipts.
 */
export function createDex(config: DexConfig): Dex {
  if (!config.providers || config.providers.length === 0) {
    throw new DexError("NO_ELIGIBLE_PROVIDER", "DexConfig must include at least one provider", {
      decisionId: "config",
      recoveryHint: "Add a provider (typesafe, cloudflare, vercel, or http).",
    });
  }

  // Validate provider manifests
  const providerIds = new Set<string>();
  for (const p of config.providers) {
    if (!p.manifest || !p.manifest.id) {
      throw new DexError("NO_ELIGIBLE_PROVIDER", "Provider is missing a manifest with id", {
        decisionId: "config",
      });
    }
    if (providerIds.has(p.manifest.id)) {
      throw new DexError("NO_ELIGIBLE_PROVIDER", `Duplicate provider id "${p.manifest.id}"`, {
        decisionId: "config",
      });
    }
    providerIds.add(p.manifest.id);
    if (p.manifest.apiVersion !== "yueli-dex-plugin/v1") {
      throw new DexError(
        "NO_ELIGIBLE_PROVIDER",
        `Provider "${p.manifest.id}" has unsupported apiVersion "${p.manifest.apiVersion}"`,
        { decisionId: "config" },
      );
    }
    if (!p.manifest.capabilities.includes("choice")) {
      throw new DexError(
        "NO_ELIGIBLE_PROVIDER",
        `Provider "${p.manifest.id}" does not support the "choice" capability`,
        { decisionId: "config" },
      );
    }
  }

  // Validate routing config
  if (!config.routing || !config.routing.default) {
    throw new DexError("NO_ELIGIBLE_PROVIDER", "DexConfig.routing.default is required", {
      decisionId: "config",
    });
  }

  // Build components
  const ruleEngine = createRuleEngine(config.ruleSets ?? []);
  const templates = createTemplateRegistry(config.templates ?? []);
  const emitter = new DexEventEmitter();
  const circuit = createCircuitBreaker(config.routing.default);
  const health = createHealthCache();

  const modeling = createModelingRegistry({
    modelers: config.modelers ?? [],
    resolveTemplate: (ref) => templates.getCompiled(ref),
  });

  const dex: Dex = {
    async choice(rawRequest, options) {
      const decisionId = generateDecisionId();
      const startedAt = new Date().toISOString();
      const startMs = Date.now();

      let request: ChoiceRequest;
      try {
        request = validateChoiceRequest(rawRequest, decisionId);
      } catch (err) {
        const receipt = buildEmptyReceipt(decisionId, startedAt, startMs);
        emitter.emit("choice.failed", {
          request: rawRequest as ChoiceRequest,
          receipt,
          error: err as Error,
        });
        throw err;
      }

      const requestHash = hashRequest(request);

      // Run pre-routing rules
      const ruleResult = ruleEngine.evaluatePreRouting(
        {
          input: request.state,
          compiled: request,
          route: { eligibleProviderIds: [] },
        },
        decisionId,
      );

      // shortCircuit: return synthetic response immediately
      if (ruleResult.shortCircuit) {
        const elapsedMs = Date.now() - startMs;
        const receipt: DecisionReceipt = {
          decisionId,
          requestHash,
          rules: ruleResult.matches.map((m) => ({ id: m.ruleSetId, version: m.ruleSetVersion })),
          route: {
            eligibleProviderIds: [],
            selectedProviderId: "yueli-dex/rules@1",
            attempts: [],
          },
          timing: { startedAt, elapsedMs },
        };
        emitter.emit("choice.completed", {
          request,
          response: ruleResult.shortCircuit.response,
          receipt,
        });
        return ruleResult.shortCircuit.response;
      }

      // Determine route name: explicit option > forced by rule > default
      const routeName = options?.route ?? ruleResult.forcedRoute;

      // Execute route
      try {
        const result = await executeRoute(
          request,
          {
            decisionId,
            requestHash,
            routeName,
            deadlineMs: options?.deadlineMs,
          },
          {
            providers: config.providers,
            routing: config.routing,
            circuit,
            health,
          },
        );

        // Post-response rules
        ruleEngine.evaluatePostResponse(
          {
            input: request.state,
            compiled: request,
            route: {
              selectedProviderId: result.selectedProviderId,
              eligibleProviderIds: result.eligibleProviderIds,
            },
            response: result.response,
          },
          decisionId,
        );

        const elapsedMs = Date.now() - startMs;
        const receipt: DecisionReceipt = {
          decisionId,
          requestHash,
          rules: ruleResult.matches.map((m) => ({ id: m.ruleSetId, version: m.ruleSetVersion })),
          route: {
            eligibleProviderIds: result.eligibleProviderIds,
            selectedProviderId: result.selectedProviderId,
            attempts: result.attempts,
          },
          timing: { startedAt, elapsedMs },
          usage: result.usage,
        };

        // Persist receipt
        if (config.receiptStore) {
          try {
            await config.receiptStore.append(receipt);
          } catch {
            // Receipt store failure must not break the decision flow.
          }
        }

        emitter.emit("choice.completed", {
          request,
          response: result.response,
          receipt,
        });

        return result.response;
      } catch (err) {
        const elapsedMs = Date.now() - startMs;
        const attempts: ProviderAttempt[] = [];
        // We don't have direct access to attempts on error path; build minimal receipt.
        const receipt: DecisionReceipt = {
          decisionId,
          requestHash,
          rules: ruleResult.matches.map((m) => ({ id: m.ruleSetId, version: m.ruleSetVersion })),
          route: {
            eligibleProviderIds: [],
            selectedProviderId: "",
            attempts,
          },
          timing: { startedAt, elapsedMs },
        };

        emitter.emit("choice.failed", {
          request,
          receipt,
          error: err as Error,
        });

        if (isDexError(err)) throw err;
        throw new DexError("PROVIDER_FAILURE", `Decision failed: ${(err as Error).message}`, {
          decisionId,
          cause: err,
        });
      }
    },

    on(event, listener) {
      return emitter.on(event, listener);
    },

    templates,
    modeling,
  };

  return dex;
}

function buildEmptyReceipt(
  decisionId: string,
  startedAt: string,
  startMs: number,
): DecisionReceipt {
  return {
    decisionId,
    requestHash: "",
    rules: [],
    route: {
      eligibleProviderIds: [],
      selectedProviderId: "",
      attempts: [],
    },
    timing: { startedAt, elapsedMs: Date.now() - startMs },
  };
}

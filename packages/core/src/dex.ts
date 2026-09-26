import type {
  ChoiceRequest,
} from "@haxitag/yueli-dex-plugin-sdk";
import { DexEventEmitter } from "./events.js";
import { DexError, isDexError, isRouteExecutionFailure } from "./errors.js";
import { createModelingRegistry } from "./modeling.js";
import { createRuleEngine } from "./rules.js";
import { createCircuitBreaker, createHealthCache, executeRoute } from "./routing.js";
import { createObservationStore } from "./observations.js";
import { createTemplateRegistry } from "./templates.js";
import type {
  DecisionReceipt,
  Dex,
  DexConfig,
  ProviderAttempt,
  RouteFailureReason,
} from "./types.js";
import { generateDecisionId, hashRequest } from "./utils.js";
import { applyPinnedAnswers, validateChoiceRequest } from "./validation.js";

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
  // P1-4: passive observation store used by routing scoring (P1-1).
  const observations = createObservationStore(64);

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

      const requestHash = (() => {
        try {
          return hashRequest(request);
        } catch (err) {
          // P0: deeply-nested or non-JSON input must fail as a controlled
          // DexError (with a failure receipt + event), not as a raw
          // RangeError/TypeError that escapes without a decisionId trail.
          const wrapped = new DexError(
            "INVALID_CHOICE_REQUEST",
            (err as Error).message,
            { decisionId, recoveryHint: "Reduce the nesting depth of state/questions (max 512 levels)." },
          );
          const receipt = buildFailureReceipt(
            decisionId,
            "",
            startedAt,
            Date.now() - startMs,
            wrapped,
          );
          emitter.emit("choice.failed", { request, receipt, error: wrapped });
          throw wrapped;
        }
      })();

      // Run pre-routing rules. A `reject` action throws here; we must catch it
      // (P0-3 audit consistency) so the choice.failed event still fires with a
      // reason-tagged receipt.
      let ruleResult;
      try {
        ruleResult = ruleEngine.evaluatePreRouting(
          {
            input: request.state,
            compiled: request,
            route: { eligibleProviderIds: [] },
          },
          decisionId,
        );
      } catch (err) {
        const elapsedMs = Date.now() - startMs;
        const receipt = buildFailureReceipt(
          decisionId,
          requestHash,
          startedAt,
          elapsedMs,
          err,
          [],
        );
        emitter.emit("choice.failed", {
          request,
          receipt,
          error: err as Error,
        });
        throw err;
      }

      // Full shortCircuit: every question is pinned → synthetic response, zero remote.
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

      // Partial pins: force those answers after the provider returns. Do NOT
      // invent confidence-1 answers for undecided questions (P0 honesty).
      const pinnedAnswers = ruleResult.pinnedAnswers;

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
            observations,
          },
        );

        const mergedResponse = applyPinnedAnswers(request, result.response, pinnedAnswers);

        // Post-response rules. A `reject` here also throws; surface it as a
        // post-route failure with reason=rule_rejected so the audit trail is
        // consistent with pre-routing rejects.
        try {
          ruleEngine.evaluatePostResponse(
            {
              input: request.state,
              compiled: request,
              route: {
                selectedProviderId: result.selectedProviderId,
                eligibleProviderIds: result.eligibleProviderIds,
              },
              response: mergedResponse,
            },
            decisionId,
          );
        } catch (postErr) {
          const elapsedMs = Date.now() - startMs;
          const receipt = buildFailureReceipt(
            decisionId,
            requestHash,
            startedAt,
            elapsedMs,
            postErr,
            result.attempts,
            result.eligibleProviderIds,
            result.selectedProviderId,
          );
          emitter.emit("choice.failed", {
            request,
            receipt,
            error: postErr as Error,
          });
          throw postErr;
        }

        const elapsedMs = Date.now() - startMs;
        const receipt: DecisionReceipt = {
          decisionId,
          requestHash,
          rules: ruleResult.matches.map((m) => ({ id: m.ruleSetId, version: m.ruleSetVersion })),
          route: {
            eligibleProviderIds: result.eligibleProviderIds,
            selectedProviderId: result.selectedProviderId,
            attempts: result.attempts,
            ...(result.routing ? { routing: result.routing } : {}),
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
          response: mergedResponse,
          receipt,
        });

        return mergedResponse;
      } catch (err) {
        const elapsedMs = Date.now() - startMs;
        // P0-3: shared failure-receipt builder preserves the routing layer's
        // attempt trace and tags the reason. See buildFailureReceipt for
        // details.
        const receipt = buildFailureReceipt(
          decisionId,
          requestHash,
          startedAt,
          elapsedMs,
          err,
        );

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

/**
 * Build a failure receipt from any thrown error. P0-3 audit consistency:
 * failures from every layer (pre-routing rule, route, post-routing rule)
 * emit the same receipt shape, with attempts preserved when available
 * and a RouteFailureReason attached when the error carries one.
 */
function buildFailureReceipt(
  decisionId: string,
  requestHash: string,
  startedAt: string,
  elapsedMs: number,
  err: unknown,
  prefilledAttempts: readonly ProviderAttempt[] = [],
  prefilledEligibleProviderIds: readonly string[] = [],
  prefilledSelectedProviderId = "",
): DecisionReceipt {
  let attempts: readonly ProviderAttempt[] = prefilledAttempts;
  let eligibleProviderIds: readonly string[] = prefilledEligibleProviderIds;
  let selectedProviderId = prefilledSelectedProviderId;
  let reason: RouteFailureReason | undefined;
  if (isRouteExecutionFailure(err)) {
    if (attempts.length === 0) attempts = err.attempts;
    reason = err.reason;
    if (err.code === "NO_ELIGIBLE_PROVIDER" || err.code === "UNKNOWN_ROUTE") {
      // No providers were tried.
    } else {
      eligibleProviderIds = Array.from(new Set(attempts.map((a) => a.providerId)));
      if (attempts.length > 0 && selectedProviderId === "") {
        selectedProviderId = attempts[attempts.length - 1].providerId;
      }
    }
  } else if (isDexError(err)) {
    reason = mapDexErrorToReason(err.code);
  }
  return {
    decisionId,
    requestHash,
    rules: [],
    route: {
      eligibleProviderIds,
      selectedProviderId,
      attempts,
      ...(reason !== undefined ? { reason } : {}),
    },
    timing: { startedAt, elapsedMs },
  };
}

/**
 * Map a top-level `DexErrorCode` that escapes the routing layer to a
 * `RouteFailureReason` for receipt audit. Only codes that originate *above*
 * the router reach this branch (TEMPLATE_*, MODELER_*, RULE_REJECTED,
 * INVALID_CHOICE_REQUEST).
 */
function mapDexErrorToReason(code: string): RouteFailureReason | undefined {
  switch (code) {
    case "TEMPLATE_INVALID":
    case "TEMPLATE_NOT_FOUND":
      return "template_invalid";
    case "MODELING_PROPOSAL_REJECTED":
    case "MODELER_NOT_FOUND":
      return "modeling_rejected";
    case "RULE_REJECTED":
      return "rule_rejected";
    case "INVALID_CHOICE_REQUEST":
      return "invalid_request";
    default:
      return undefined;
  }
}

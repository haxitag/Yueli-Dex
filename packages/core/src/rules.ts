import type { JsonValue } from "@haxitag/yueli-dex-plugin-sdk";
import { DexError } from "./errors.js";
import type { ChoiceRequest, RuleMatch, RuleSet } from "./types.js";
import { buildShortCircuitResponse } from "./validation.js";
import type { ChoiceResponse } from "@haxitag/yueli-dex-plugin-sdk";

/**
 * Restricted, declarative rule engine for Yueli DEX.
 *
 * Rules never execute arbitrary JavaScript. The grammar supports JSON-path
 * leaf comparisons with the operators: exists, equals, in, lt, lte, gt, gte.
 * Condition trees use exactly one of: all, any, not, or a leaf comparison.
 *
 * Actions: reject, constrain, route, shortCircuit.
 */

interface LeafCondition {
  readonly path: string;
  readonly op:
    | "exists"
    | "equals"
    | "in"
    | "lt"
    | "lte"
    | "gt"
    | "gte"
    | "string_length_lt"
    | "string_length_gte"
    | "array_length_lt"
    | "array_length_gte"
    | "contains"
    | "matches";
  readonly value?: JsonValue;
}

interface CompoundCondition {
  readonly all?: readonly RuleCondition[];
  readonly any?: readonly RuleCondition[];
  readonly not?: RuleCondition;
}

type RuleCondition = LeafCondition | CompoundCondition;

interface RuleDef {
  readonly id: string;
  readonly when: RuleCondition;
  readonly then: {
    readonly kind: "reject" | "constrain" | "route" | "shortCircuit";
    readonly message?: string;
    readonly requireFallbackOption?: string;
    readonly allowedActionKinds?: readonly string[];
    readonly route?: string;
    readonly questionId?: string;
    readonly choice?: string;
  };
}

interface RuleDocument {
  readonly apiVersion: string;
  readonly rules: readonly RuleDef[];
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRuleDocument(doc: JsonValue, ruleSetId: string): RuleDocument {
  if (!isPlainObject(doc)) {
    throw new DexError("RULE_REJECTED", `Rule set "${ruleSetId}" document must be an object`, {
      decisionId: "rule-engine",
    });
  }
  const apiVersion = (doc as Record<string, unknown>).apiVersion;
  if (apiVersion !== "yueli-dex-rules/v1") {
    throw new DexError(
      "RULE_REJECTED",
      `Rule set "${ruleSetId}" has unsupported apiVersion "${String(apiVersion)}"`,
      { decisionId: "rule-engine" },
    );
  }
  const rules = (doc as Record<string, unknown>).rules;
  if (!Array.isArray(rules)) {
    throw new DexError("RULE_REJECTED", `Rule set "${ruleSetId}" must define a rules array`, {
      decisionId: "rule-engine",
    });
  }
  return {
    apiVersion: apiVersion as string,
    rules: rules.map((r) => parseRule(r, ruleSetId)),
  };
}

function parseRule(raw: unknown, ruleSetId: string): RuleDef {
  if (!isPlainObject(raw)) {
    throw new DexError("RULE_REJECTED", `Rule in "${ruleSetId}" must be an object`, {
      decisionId: "rule-engine",
    });
  }
  const { id, when, then } = raw as Record<string, unknown>;
  if (typeof id !== "string" || id === "") {
    throw new DexError("RULE_REJECTED", `Rule in "${ruleSetId}" must have a string id`, {
      decisionId: "rule-engine",
    });
  }
  if (when === undefined) {
    throw new DexError("RULE_REJECTED", `Rule "${id}" must have a "when" condition`, {
      decisionId: "rule-engine",
    });
  }
  if (!isPlainObject(then)) {
    throw new DexError("RULE_REJECTED", `Rule "${id}" must have a "then" action object`, {
      decisionId: "rule-engine",
    });
  }
  const kind = (then as Record<string, unknown>).kind;
  if (
    kind !== "reject" && kind !== "constrain" && kind !== "route" && kind !== "shortCircuit"
  ) {
    throw new DexError(
      "RULE_REJECTED",
      `Rule "${id}" has invalid action kind "${String(kind)}"`,
      { decisionId: "rule-engine" },
    );
  }
  return {
    id,
    when: parseCondition(when, id),
    then: parseAction(then as Record<string, unknown>, id),
  };
}

function parseCondition(raw: unknown, ruleId: string): RuleCondition {
  if (!isPlainObject(raw)) {
    throw new DexError("RULE_REJECTED", `Rule "${ruleId}" condition must be an object`, {
      decisionId: "rule-engine",
    });
  }
  const keys = Object.keys(raw);
  if (keys.length === 0) {
    throw new DexError("RULE_REJECTED", `Rule "${ruleId}" condition must not be empty`, {
      decisionId: "rule-engine",
    });
  }

  if ("all" in raw) {
    const all = (raw as Record<string, unknown>).all;
    if (!Array.isArray(all) || all.length === 0) {
      throw new DexError("RULE_REJECTED", `Rule "${ruleId}" all must be a non-empty array`, {
        decisionId: "rule-engine",
      });
    }
    return { all: all.map((c) => parseCondition(c, ruleId)) };
  }
  if ("any" in raw) {
    const any = (raw as Record<string, unknown>).any;
    if (!Array.isArray(any) || any.length === 0) {
      throw new DexError("RULE_REJECTED", `Rule "${ruleId}" any must be a non-empty array`, {
        decisionId: "rule-engine",
      });
    }
    return { any: any.map((c) => parseCondition(c, ruleId)) };
  }
  if ("not" in raw) {
    return { not: parseCondition((raw as Record<string, unknown>).not, ruleId) };
  }
  // Leaf
  const { path, op, value } = raw as Record<string, unknown>;
  if (typeof path !== "string") {
    throw new DexError("RULE_REJECTED", `Rule "${ruleId}" leaf must have a string path`, {
      decisionId: "rule-engine",
    });
  }
  const validOps = [
    "exists",
    "equals",
    "in",
    "lt",
    "lte",
    "gt",
    "gte",
    "string_length_lt",
    "string_length_gte",
    "array_length_lt",
    "array_length_gte",
    "contains",
    "matches",
  ] as const;
  if (!validOps.includes(op as (typeof validOps)[number])) {
    throw new DexError(
      "RULE_REJECTED",
      `Rule "${ruleId}" has invalid operator "${String(op)}"`,
      { decisionId: "rule-engine" },
    );
  }
  return { path, op: op as LeafCondition["op"], value: value as JsonValue | undefined };
}

function parseAction(
  then: Record<string, unknown>,
  ruleId: string,
): RuleDef["then"] {
  const kind = then.kind as RuleDef["then"]["kind"];
  const action: Record<string, unknown> = { kind };

  if (then.message !== undefined && typeof then.message === "string") {
    action.message = then.message;
  }
  if (kind === "constrain") {
    if (then.requireFallbackOption !== undefined) {
      if (typeof then.requireFallbackOption !== "string") {
        throw new DexError("RULE_REJECTED", `Rule "${ruleId}" requireFallbackOption must be a string`, {
          decisionId: "rule-engine",
        });
      }
      action.requireFallbackOption = then.requireFallbackOption;
    }
    if (then.allowedActionKinds !== undefined) {
      if (!Array.isArray(then.allowedActionKinds) || !then.allowedActionKinds.every((x) => typeof x === "string")) {
        throw new DexError("RULE_REJECTED", `Rule "${ruleId}" allowedActionKinds must be a string array`, {
          decisionId: "rule-engine",
        });
      }
      action.allowedActionKinds = then.allowedActionKinds;
    }
  }
  if (kind === "route") {
    if (typeof then.route !== "string") {
      throw new DexError("RULE_REJECTED", `Rule "${ruleId}" route action must name a route`, {
        decisionId: "rule-engine",
      });
    }
    action.route = then.route;
  }
  if (kind === "shortCircuit") {
    if (typeof then.questionId !== "string") {
      throw new DexError("RULE_REJECTED", `Rule "${ruleId}" shortCircuit must have questionId`, {
        decisionId: "rule-engine",
      });
    }
    if (typeof then.choice !== "string") {
      throw new DexError("RULE_REJECTED", `Rule "${ruleId}" shortCircuit must have choice`, {
        decisionId: "rule-engine",
      });
    }
    action.questionId = then.questionId;
    action.choice = then.choice;
  }

  return action as RuleDef["then"];
}

/* ------------------------------------------------------------------ */
/* Evaluation context                                                  */
/* ------------------------------------------------------------------ */

interface RuleContext {
  readonly input: JsonValue;
  readonly compiled: ChoiceRequest;
  readonly route: {
    readonly selectedProviderId?: string;
    readonly eligibleProviderIds: readonly string[];
  };
  readonly response?: ChoiceResponse;
}

/* ------------------------------------------------------------------ */
/* JSON-path resolution                                                */
/* ------------------------------------------------------------------ */

/**
 * Resolve a restricted JSON path against the rule context.
 * Paths start with `$.` and support dot-notation into objects and bracket
 * indexing into arrays. No functions, filters, or recursive descent.
 *
 * Root keys: input, compiled, route, response.
 */
function resolvePath(path: string, ctx: RuleContext): { found: boolean; value: unknown } {
  if (!path.startsWith("$.")) {
    return { found: false, value: undefined };
  }
  const segments = path.slice(2).split(".");
  let current: unknown = ctx;
  for (const seg of segments) {
    if (current === null || current === undefined) {
      return { found: false, value: undefined };
    }
    // Bracket index support, e.g. questions.handler.criteria.needs_review
    // For simplicity, split on brackets
    const parts = seg.split(/\[(\d+)\]/).filter((p) => p !== "");
    for (const part of parts) {
      if (current === null || current === undefined) {
        return { found: false, value: undefined };
      }
      if (/^\d+$/.test(part)) {
        if (Array.isArray(current)) {
          current = current[Number(part)];
        } else {
          return { found: false, value: undefined };
        }
      } else if (isPlainObject(current)) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return { found: false, value: undefined };
      }
    }
  }
  return { found: current !== undefined, value: current };
}

/* ------------------------------------------------------------------ */
/* Condition evaluation                                                */
/* ------------------------------------------------------------------ */

function evalCondition(cond: RuleCondition, ctx: RuleContext): boolean {
  if ("all" in cond && cond.all) {
    return cond.all.every((c) => evalCondition(c, ctx));
  }
  if ("any" in cond && cond.any) {
    return cond.any.some((c) => evalCondition(c, ctx));
  }
  if ("not" in cond && cond.not) {
    return !evalCondition(cond.not, ctx);
  }
  // Leaf
  const leaf = cond as LeafCondition;
  const { found, value } = resolvePath(leaf.path, ctx);
  switch (leaf.op) {
    case "exists":
      return found;
    case "equals":
      return found && value === leaf.value;
    case "in":
      return found && Array.isArray(leaf.value) && leaf.value.includes(value as never);
    case "lt":
      return found && typeof value === "number" && typeof leaf.value === "number" && value < leaf.value;
    case "lte":
      return found && typeof value === "number" && typeof leaf.value === "number" && value <= leaf.value;
    case "gt":
      return found && typeof value === "number" && typeof leaf.value === "number" && value > leaf.value;
    case "gte":
      return found && typeof value === "number" && typeof leaf.value === "number" && value >= leaf.value;
    case "string_length_lt":
      return (
        found &&
        typeof value === "string" &&
        typeof leaf.value === "number" &&
        value.length < leaf.value
      );
    case "string_length_gte":
      return (
        found &&
        typeof value === "string" &&
        typeof leaf.value === "number" &&
        value.length >= leaf.value
      );
    case "array_length_lt":
      return (
        found &&
        Array.isArray(value) &&
        typeof leaf.value === "number" &&
        value.length < leaf.value
      );
    case "array_length_gte":
      return (
        found &&
        Array.isArray(value) &&
        typeof leaf.value === "number" &&
        value.length >= leaf.value
      );
    case "contains":
      return (
        found &&
        Array.isArray(value)
          ? leaf.value !== undefined && value.includes(leaf.value as never)
          : typeof value === "string" &&
            typeof leaf.value === "string" &&
            value.includes(leaf.value)
      );
    case "matches":
      return (
        found &&
        typeof value === "string" &&
        typeof leaf.value === "string" &&
        safeRegexTest(leaf.value, value)
      );
    default:
      return false;
  }
}

/**
 * Compile and run a regex against the candidate string. A malformed pattern
 * returns `false` (matches returns false) rather than throwing — this keeps
 * rule evaluation total and prevents one bad rule from blocking an entire
 * decision. We still emit nothing here; the parser catches illegal `value`
 * types at parse time. Throwing regexes (e.g. backreferences) are a known
 * v1 limitation.
 */
function safeRegexTest(pattern: string, candidate: string): boolean {
  try {
    return new RegExp(pattern).test(candidate);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Rule engine                                                         */
/* ------------------------------------------------------------------ */

export interface RuleEngine {
  /**
   * Evaluate rules against the pre-routing context (input + compiled request).
   * Returns matched actions in precedence order. A `reject` action throws.
   *
   * shortCircuit semantics (P0 honesty):
   * - `pinnedAnswers` accumulates every matched shortCircuit (questionId → choice).
   * - `shortCircuit` is only set when pinned answers cover ALL questions in the
   *   request (full local resolution, zero remote call).
   * - Partial pins must NOT fabricate answers for undecided questions; callers
   *   (dex.choice) route the remainder to a provider and merge pins afterward.
   */
  evaluatePreRouting(
    ctx: Omit<RuleContext, "route" | "response"> & {
      route: { eligibleProviderIds: readonly string[] };
    },
    decisionId: string,
  ): {
    readonly matches: readonly RuleMatch[];
    /** questionId → choice for every shortCircuit that fired. */
    readonly pinnedAnswers: Readonly<Record<string, string>>;
    /**
     * Present only when every question is pinned. Contains the synthetic
     * ChoiceResponse (`model: "yueli-dex/rules@1"`) and the last matching rule.
     */
    readonly shortCircuit?: { response: ChoiceResponse; match: RuleMatch };
    readonly forcedRoute?: string;
    readonly constraints: {
      readonly requireFallbackOption?: string;
      readonly allowedActionKinds?: readonly string[];
    };
  };

  /**
   * Evaluate rules against the post-response context. May reject or return
   * constraint matches. Cannot alter the provider response.
   */
  evaluatePostResponse(
    ctx: RuleContext,
    decisionId: string,
  ): readonly RuleMatch[];
}

export function createRuleEngine(ruleSets: readonly RuleSet[]): RuleEngine {
  // Parse all rule sets at construction time (fail fast).
  const parsed = ruleSets.map((rs) => ({
    ruleSet: rs,
    document: parseRuleDocument(rs.document, rs.id),
  }));

  // Sort by scope precedence: template < organization < environment < call.
  // Higher scope narrows permission (runs later, can override constrain/route).
  const scopeOrder: Record<string, number> = {
    template: 0,
    organization: 1,
    environment: 2,
    call: 3,
  };
  parsed.sort((a, b) => scopeOrder[a.ruleSet.scope] - scopeOrder[b.ruleSet.scope]);

  function evaluateAll(ctx: RuleContext, _decisionId: string): RuleMatch[] {
    const matches: RuleMatch[] = [];
    for (const { ruleSet, document } of parsed) {
      for (const rule of document.rules) {
        if (evalCondition(rule.when, ctx)) {
          matches.push({
            ruleId: rule.id,
            ruleSetId: ruleSet.id,
            ruleSetVersion: ruleSet.version,
            scope: ruleSet.scope,
            action: rule.then,
          });
        }
      }
    }
    return matches;
  }

  return {
    evaluatePreRouting(ctx, decisionId) {
      const matches = evaluateAll(ctx as RuleContext, decisionId);

      // P1-3: action precedence lattice — reject > constrain > route > shortCircuit.
      // We sort the matches accordingly before processing so that the
      // strongest action is applied first and weaker ones never overwrite
      // stronger ones.
      const lattice: Record<RuleDef["then"]["kind"], number> = {
        reject: 0,
        constrain: 1,
        route: 2,
        shortCircuit: 3,
      };
      // Stable sort by (lattice rank, original order). Array.prototype.sort
      // is stable in modern engines (Node ≥12).
      matches.sort((a, b) => lattice[a.action.kind] - lattice[b.action.kind]);

      let forcedRoute: string | undefined;
      let requireFallbackOption: string | undefined;
      let allowedActionKinds: readonly string[] | undefined;

      // Track (kind, scope, value) we've applied so same-scope conflicts
      // can be detected. Two rules with the SAME value at the same scope
      // are idempotent and ignored; different values raise RULE_REJECTED.
      const routeSeenAt: Map<number, string> = new Map();
      // (scope, questionId) -> chosen choice (for shortCircuit conflict detection)
      const shortCircuitSeenAt: Map<string, string> = new Map();
      // Accumulated pins across questions (questionId → choice). Last matching
      // rule per question wins after conflict checks; higher scopes run later.
      const pinned: Record<string, string> = {};
      let lastShortCircuitMatch: RuleMatch | undefined;

      for (const match of matches) {
        switch (match.action.kind) {
          case "reject":
            // First reject wins — anything else is discarded.
            throw new DexError(
              "RULE_REJECTED",
              match.action.message || `Rule "${match.ruleId}" rejected the request`,
              {
                decisionId,
                recoveryHint: "Adjust the input or request to satisfy the rule.",
              },
            );
          case "constrain":
            if (match.action.requireFallbackOption !== undefined) {
              if (requireFallbackOption === undefined) {
                requireFallbackOption = match.action.requireFallbackOption;
              } else if (requireFallbackOption !== match.action.requireFallbackOption) {
                throw new DexError(
                  "RULE_REJECTED",
                  `Conflicting requireFallbackOption between rules: "${requireFallbackOption}" vs "${match.action.requireFallbackOption}"`,
                  { decisionId },
                );
              }
            }
            if (match.action.allowedActionKinds !== undefined) {
              if (allowedActionKinds === undefined) {
                allowedActionKinds = [...match.action.allowedActionKinds];
              } else {
                const setA = new Set(allowedActionKinds);
                allowedActionKinds = match.action.allowedActionKinds.filter((k) => setA.has(k));
              }
            }
            break;
          case "route":
            if (match.action.route !== undefined) {
              const scopeIdx = scopeOrder[match.scope];
              const prior = routeSeenAt.get(scopeIdx);
              if (prior !== undefined && prior !== match.action.route) {
                throw new DexError(
                  "RULE_REJECTED",
                  `Conflicting route rules at scope "${match.scope}": "${prior}" vs "${match.action.route}"`,
                  { decisionId },
                );
              }
              forcedRoute = match.action.route;
              routeSeenAt.set(scopeIdx, match.action.route);
            }
            break;
          case "shortCircuit": {
            if (!match.action.questionId || !match.action.choice) break;
            const question = ctx.compiled.questions[match.action.questionId];
            // If the question doesn't exist OR the choice isn't valid for
            // this template's question, the rule belongs to a different
            // template — silently skip without participating in conflict
            // detection.
            if (!question) break;
            if (!Object.prototype.hasOwnProperty.call(question.criteria, match.action.choice)) {
              break;
            }
            const scopeIdx = scopeOrder[match.scope];
            const scopeKey = `${scopeIdx}|${match.action.questionId}`;
            const priorChoice = shortCircuitSeenAt.get(scopeKey);
            if (priorChoice !== undefined && priorChoice !== match.action.choice) {
              throw new DexError(
                "RULE_REJECTED",
                `Conflicting shortCircuit rules at scope "${match.scope}" for question "${match.action.questionId}": "${priorChoice}" vs "${match.action.choice}"`,
                { decisionId },
              );
            }
            if (priorChoice === match.action.choice) {
              // Idempotent convergence — already applied, skip.
              break;
            }
            pinned[match.action.questionId] = match.action.choice;
            lastShortCircuitMatch = match;
            shortCircuitSeenAt.set(scopeKey, match.action.choice);
            break;
          }
        }
      }

      const questionIds = Object.keys(ctx.compiled.questions);
      const complete =
        questionIds.length > 0 && questionIds.every((qid) => Object.prototype.hasOwnProperty.call(pinned, qid));

      let shortCircuit: { response: ChoiceResponse; match: RuleMatch } | undefined;
      if (complete && lastShortCircuitMatch) {
        shortCircuit = {
          response: buildShortCircuitResponse(ctx.compiled, pinned),
          match: lastShortCircuitMatch,
        };
      }

      return {
        matches,
        pinnedAnswers: pinned,
        shortCircuit,
        forcedRoute,
        constraints: { requireFallbackOption, allowedActionKinds },
      };
    },

    evaluatePostResponse(ctx, decisionId) {
      const matches = evaluateAll(ctx, decisionId);
      for (const match of matches) {
        if (match.action.kind === "reject") {
          throw new DexError(
            "RULE_REJECTED",
            match.action.message || `Rule "${match.ruleId}" rejected the response`,
            { decisionId },
          );
        }
      }
      return matches;
    },
  };
}

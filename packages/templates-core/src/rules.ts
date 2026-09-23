import type { RuleSet } from "@haxitag/yueli-dex";

/**
 * Local rule sets shipped with the base template pack.
 *
 * Design principle (from the project's three-layer decision chain):
 * **anything that can be rule-ified runs in the local rule engine and never
 * touches a remote Jev-class model** — but only when the rule set covers
 * *every* question in the Choice request. A single-question shortCircuit on a
 * multi-question template is a *partial pin*: undecided questions still route
 * to a provider, and pinned answers are merged afterward with confidence 1.
 * Never invent confidence-1 answers for uncovered questions.
 *
 * Rule conditions are restricted JSON-path comparisons evaluated against the
 * *compiled Choice state* (`$.input.*` — the fields produced by the template's
 * `state.from` mapping), not the raw business input.
 *
 * Templates whose decisions are open-world or dynamic (`content-moderation`,
 * `browser-action`) deliberately ship no local rules — those must go to a
 * remote model.
 */

type RuleDoc = {
  readonly apiVersion: "yueli-dex-rules/v1";
  readonly rules: readonly {
    readonly id: string;
    readonly when: Record<string, unknown>;
    readonly then: Record<string, unknown>;
  }[];
};

function ruleSet(id: string, doc: RuleDoc): RuleSet {
  return { id, version: "1.0.0", scope: "template", document: doc as never };
}

export const LOCAL_RULE_SETS: Readonly<Record<string, readonly RuleSet[]>> = {
  // state: { message, accountPlan, region }
  "support-triage": [
    ruleSet("support-triage-local-rules", {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "enterprise-priority",
          when: { path: "$.input.accountPlan", op: "equals", value: "enterprise" },
          then: {
            kind: "shortCircuit",
            questionId: "priority",
            choice: "urgent",
            message: "Enterprise accounts are always urgent — decided locally",
          },
        },
      ],
    }),
  ],

  // state: { subject, sender, snippet }
  "email-triage": [
    ruleSet("email-triage-local-rules", {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "known-transactional-senders",
          when: {
            any: [
              { path: "$.input.sender", op: "equals", value: "no-reply@github.com" },
              { path: "$.input.sender", op: "equals", value: "noreply@vercel.com" },
              { path: "$.input.sender", op: "equals", value: "billing@stripe.com" },
            ],
          },
          then: {
            kind: "shortCircuit",
            questionId: "category",
            choice: "notification",
            message: "Known transactional sender — decided locally without a model call",
          },
        },
      ],
    }),
  ],

  // state: { goal, availableTools, recentSteps }
  "agent-tool-selection": [
    ruleSet("agent-tool-selection-local-rules", {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "goal-required",
          when: { any: [
            { not: { path: "$.input.goal", op: "exists" } },
            { path: "$.input.goal", op: "equals", value: "" },
          ] },
          then: {
            kind: "reject",
            message: "A non-empty goal is required before selecting a tool",
          },
        },
      ],
    }),
  ],

  // state: { goal, attempts, lastAction, lastError }
  "agent-loop-control": [
    ruleSet("agent-loop-control-local-rules", {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "max-attempts",
          when: { path: "$.input.attempts", op: "gte", value: 5 },
          then: {
            kind: "shortCircuit",
            questionId: "next_step",
            choice: "escalate",
            message: "Hard loop ceiling — escalate instead of burning more model calls",
          },
        },
      ],
    }),
  ],

  // state: { conversation, toolName, toolInput, toolResult }
  "context-compaction": [
    ruleSet("context-compaction-local-rules", {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "drop-directory-listings",
          when: { path: "$.input.toolName", op: "in", value: ["list_dir", "ls", "readdir", "find"] },
          then: {
            kind: "shortCircuit",
            questionId: "disposition",
            choice: "drop",
            message: "Directory listings are deterministically droppable — decided locally",
          },
        },
      ],
    }),
  ],

  // state: { command, args, environment, actor }
  "security-gate": [
    ruleSet("security-gate-local-rules", {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "prod-destructive-commands",
          when: {
            all: [
              { path: "$.input.command", op: "in", value: ["rm", "mkfs", "dd", "shred", "format"] },
              { path: "$.input.environment", op: "equals", value: "production" },
            ],
          },
          then: {
            kind: "reject",
            message: "Destructive command in production is rejected by local policy — no model call",
          },
        },
        {
          id: "dev-rm-node-modules",
          when: {
            all: [
              { path: "$.input.command", op: "equals", value: "rm" },
              { path: "$.input.args", op: "equals", value: "-rf node_modules" },
              { path: "$.input.environment", op: "in", value: ["development", "ci"] },
            ],
          },
          then: {
            kind: "shortCircuit",
            questionId: "verdict",
            choice: "approve",
            message: "Routine dev cleanup — approved locally",
          },
        },
      ],
    }),
  ],

  // state: { prompt, taskType, historyTokens }
  "model-routing": [
    ruleSet("model-routing-local-rules", {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "tiny-contexts",
          when: { path: "$.input.historyTokens", op: "lte", value: 512 },
          then: {
            kind: "shortCircuit",
            questionId: "tier",
            choice: "nano",
            message: "Tiny context is deterministically nano — decided locally",
          },
        },
      ],
    }),
  ],

  // state: { title, description, diff, testDelta }
  "code-review-gate": [
    ruleSet("code-review-gate-local-rules", {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "tests-required",
          when: { not: { path: "$.input.testDelta", op: "exists" } },
          then: {
            kind: "shortCircuit",
            questionId: "verdict",
            choice: "request_tests",
            message: "No test delta in the diff — request tests deterministically",
          },
        },
      ],
    }),
  ],

  /* ----------------------------------------------------------------- */
  /*   Local rules for the 6 newly-added templates.                    */
  /*   Pattern: each captures a deterministic fact the README / docs   */
  /*   call out as "always true" — so it can short-circuit (or be     */
  /*   rejected) without consuming a Jev-class model call.               */
  /* ----------------------------------------------------------------- */

  // state: { chunkId, goal, toolName, chunkSize }
  // Winnow / fast-jev-compaction: error output is always keep_verbatim
  // (the chunk may be needed to diagnose the very next step).
  "chunk-triage": [
    ruleSet("chunk-triage-local-rules", {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "error-output-must-stay-verbatim",
          when: {
            any: [
              { path: "$.input.toolName", op: "equals", value: "Bash" },
              { path: "$.input.toolName", op: "equals", value: "run_command" },
              { path: "$.input.toolName", op: "equals", value: "execute" },
            ],
          },
          then: {
            kind: "shortCircuit",
            questionId: "disposition",
            choice: "keep_verbatim",
            message:
              "Command/tool output is kept verbatim — error context must never be hidden",
          },
        },
      ],
    }),
  ],

  // state: { claim, evidence, threshold }
  // No evidence → always unsupported; no point asking Jev.
  "claim-verify": [
    ruleSet("claim-verify-local-rules", {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "missing-evidence",
          when: {
            any: [
              { not: { path: "$.input.evidence", op: "exists" } },
              { path: "$.input.evidence", op: "equals", value: "" },
            ],
          },
          then: {
            kind: "shortCircuit",
            questionId: "verdict",
            choice: "unsupported",
            message: "Empty evidence — claim is unsupported by construction",
          },
        },
      ],
    }),
  ],

  // state: { tickHz, grounded, hazards, goal }
  // If the player is airborne and there is at least one hazard, defend is the
  // only safe reflexive answer that any second-line logic can rely on.
  //
  // Important: this rule must check BOTH conditions. A bare `grounded=false`
  // test (the original bug) would fire even when `hazards` is absent/empty,
  // turning a deterministic rule into a wrong-by-construction decision.
  "realtime-action": [
    ruleSet("realtime-action-local-rules", {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "airborne-with-hazard-defend",
          when: {
            all: [
              { path: "$.input.grounded", op: "equals", value: false },
              { path: "$.input.hazards", op: "exists" },
            ],
          },
          then: {
            kind: "shortCircuit",
            questionId: "action",
            choice: "defend",
            message:
              "Airborne state with hazards — defensive reflex chosen locally, Jev only sets the risk level",
          },
        },
      ],
    }),
  ],

  // state: { goal, nodeLabel, depth, candidates, found, maxDepth }
  // At depth limit, always backtrack — walker must not blow the budget.
  "graph-traverse": [
    ruleSet("graph-traverse-local-rules", {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "depth-budget-backtrack",
          when: { path: "$.input.depth", op: "gte", value: 5 },
          then: {
            kind: "shortCircuit",
            questionId: "next_move",
            choice: "backtrack",
            message: "Depth budget exhausted — walker backtracks locally",
          },
        },
        {
          id: "already-found-stop",
          when: { path: "$.input.found", op: "equals", value: true },
          then: {
            kind: "shortCircuit",
            questionId: "next_move",
            choice: "stay",
            message: "Goal already reached — walker stops locally",
          },
        },
      ],
    }),
  ],

  // state: { field, candidates, context }
  // No candidates → not_found by construction.
  "extract-field": [
    ruleSet("extract-field-local-rules", {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "no-candidates-not-found",
          when: {
            any: [
              { not: { path: "$.input.candidates", op: "exists" } },
            ],
          },
          then: {
            kind: "shortCircuit",
            questionId: "match",
            choice: "not_found",
            message: "Empty candidate list — no match by construction",
          },
        },
      ],
    }),
  ],

  // state: { idea, goal, context }
  // killmyidea's clarity floor: ideas shorter than ~50 chars can't be scored.
  // NOTE: the original implementation used `op: "exists"` which short-circuited
  // EVERY idea to `needs_review` regardless of length — a deterministic rule
  // producing a wrong-by-construction decision. We use `string_length_lt` (an
  // operator added in P0-2) to enforce the actual length floor.
  "startup-pitch": [
    ruleSet("startup-pitch-local-rules", {
      apiVersion: "yueli-dex-rules/v1",
      rules: [
        {
          id: "too-short-to-score",
          when: { path: "$.input.idea", op: "string_length_lt", value: 50 },
          then: {
            kind: "shortCircuit",
            questionId: "verdict",
            choice: "needs_review",
            message:
              "Idea below clarity floor — caller must supply more context before scoring",
          },
        },
      ],
    }),
  ],
};

/**
 * Local rule sets for a template id. Empty array means the template's
 * decisions are not rule-able and must go to a remote model.
 */
export function getLocalRuleSets(templateId: string): readonly RuleSet[] {
  return LOCAL_RULE_SETS[templateId] ?? [];
}

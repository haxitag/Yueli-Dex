# yueli-dex

Agent skill for integrating Yueli DEX (`@haxitag/yueli-dex`) — the Choice-only
Decision Execution Framework for AI agents — into apps, agents, and pipelines.

---
name: yueli-dex
description: >-
  Use when adding structured, typed AI decisions to software: routing
  (tickets, email, tools, models), classification, gating (security, review,
  moderation), agent loop control, or context compaction — anywhere code must
  "pick one option with calibrated probabilities" instead of parsing LLM text.
  Covers the Yueli DEX SDK, the Jev Choice request/response contract, the
  labeled template catalog, multi-provider routing (TypeSafe, Cloudflare,
  Vercel, self-hosted), and decision-modeling best practices.
---

## What this skill knows

Yueli DEX wraps the Jev `Choice` primitive — a fast, non-generative decision
model that returns one selected option, a full probability distribution, and
a confidence score. DEX adds what the raw API lacks:

1. **Decision modeling** — turn a fuzzy business need into a well-formed
   `state + question + criteria` request (template packs, optional LLM modeler).
2. **Stable routing** — send the same canonical request across TypeSafe,
   Cloudflare, Vercel, and self-hosted hosts with policy, budget, retry,
   circuit breaking, and failover.
3. **Auditability** — `DecisionReceipt` sidecar plus declarative `ActionIntent`
   output, without mutating the provider response.

Core equation: **Decision Quality = Model Quality × Decision Modeling Quality.**
The hard part is rarely the call — it is authoring the right question and
options. This skill exists to prevent that failure.

## When to use Choice vs an LLM

Use Choice (this skill) when the code needs a **fast, typed, bounded pick**:
routing, triage, gating, ranking, keep/drop. Latency is 70–500 ms and the
output can never be a wrong type.

Keep the LLM when the task is **generative or needs human oversight**: prose,
drafting, multi-step reasoning with supervision. Best systems combine both:
LLM writes, Jev chooses.

## Core workflow

1. **Identify the decision point.** Find where code parses text, regex-routes,
   or hard-codes if/else chains on fuzzy input. Each becomes a candidate Choice.
2. **Check the template catalog first.** `@haxitag/yueli-dex-templates-core`
   ships 16 curated templates labeled 主题/场景/用例/效用
   (theme / scenario / use case / utility). Pick the closest match before
   writing anything. See `references/template-catalog.md`.
3. **Prepare → decide → map.**

   ```ts
   import { createDex } from "@haxitag/yueli-dex";
   import { TEMPLATES_CORE_PACK } from "@haxitag/yueli-dex-templates-core";

   const dex = createDex({
     providers: [typesafeProvider, cloudflareProvider],
     routing: { default: { providerIds: ["typesafe-primary", "cf-edge"], maxAttempts: 2, circuitFailureThreshold: 3, circuitCooldownMs: 60_000 } },
     templates: [TEMPLATES_CORE_PACK],
   });

   const request = await dex.templates.prepare({
     template: "support-triage",
     input: { message: "I was charged twice.", account: { plan: "pro" } },
   });
   const response = await dex.choice(request);
   const intents = dex.templates.toActionIntent({ template: "support-triage", request, response });
   ```

4. **Branch on confidence with thresholds set per action, not per model.**
   Read-only actions tolerate ~0.7; destructive actions need ≥0.9 plus a
   confirmation step; below threshold, route to `needs_review` / human.
5. **Consume `ActionIntent` as a request, not an authorization.** Downstream
   executors own permission and approval.

## Hard rules (do not violate)

- **One question per question.** Do not merge "diagnose, assign, and fix"
  into a single `instructions` string.
- **Descriptions, not labels.** `"Blocking with no workaround"` beats `"high"`.
- **Always keep a fallback option** (`needs_review` / `other`) for open-world
  classification; ≤255 options per question.
- **A valid low-confidence response is never retried or re-routed.** Low
  confidence is decision information, not a service failure.
- **Classification ≠ authorization.** "Customer asks for a refund" does not
  mean "approve the refund" — that check lives in your rules.
- **`state` must be focused and authorized.** No secrets, no unredacted PII,
  no data the selected host may not see.
- DEX outputs intents; it never executes tools, queues, or repo code.

## References

Load these only when needed:

- `references/choice-contract.md` — exact request/response shapes and the
  validation DEX enforces before surfacing a provider answer.
- `references/template-catalog.md` — the four-dimension catalog, how to pick a
  template, and how to author a new `yueli-dex-template/v1` document.
- `references/question-design.md` — modeling best practices: atomic questions,
  state focus, threshold policy, calibration.
- `references/providers-and-routing.md` — the four hosts, credentials, routing
  policy, and failover semantics.
- `references/plugin-architecture.md` — component framework and the open
  plugin system (provider / template-pack / modeler / context-provider).
- `references/agent-integration.md` — bilingual (中文 / English) cookbook for
  integrating yueli-dex into agent projects (LangGraph / OpenAI Agents SDK /
  hand-rolled loops): four canonical insertion patterns, three framework
  recipes, do & don't, and the verification habit.

## Verification habit

Before declaring an integration done: run the deterministic local
`jev-choice/v1` fixture path, validate the compiled request with
`validateChoiceRequest`, assert thresholds on both confidence and selected
probability, and keep template/rule versions in the receipt. A single live
success is not a stability claim.

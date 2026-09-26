import { TEMPLATES } from "./templates.js";
import { getLocalRuleSets } from "./rules.js";

/**
 * Generate a runnable TypeScript call example for a template.
 *
 * The example encodes the framework's core execution policy:
 * 1. Deterministic, rule-able policies run in the LOCAL rule engine and
 *    short-circuit without calling a remote Jev-class model.
 * 2. Only un-matched requests route to a remote provider.
 * 3. Answers map to ActionIntents for downstream executors.
 */
export function buildCallExample(templateId: string): string {
  const t = TEMPLATES.find((x) => x.id === templateId);
  if (!t) {
    throw new Error(`Template "${templateId}" not found`);
  }
  const rules = getLocalRuleSets(templateId);
  const hasRules = rules.length > 0;
  const inputJson = JSON.stringify(t.meta.exampleInput, null, 2)
    .split("\n")
    .map((line, i) => (i === 0 ? line : `  ${line}`))
    .join("\n");

  const lines: string[] = [];
  lines.push(`// ─────────────────────────────────────────────────────────────────`);
  lines.push(`// 模板 / Template: ${t.id} — ${t.meta.useCase}`);
  lines.push(`// 场景 / Scenario: ${t.meta.scenario}  ·  效用 / Utility: ${t.meta.utility}`);
  lines.push(`// ─────────────────────────────────────────────────────────────────`);
  lines.push(`// 中文：核心 SDK（决策 API、规则引擎、路由、回执）`);
  lines.push(`// English: Core SDK (decision API, rule engine, routing, receipts)`);
  lines.push(`import { createDex } from "@haxitag/yueli-dex";`);
  lines.push(`// 中文：模板包（16 个场景模板 + 本地规则集）`);
  lines.push(`// English: Template pack (16 scenarios + local rule sets)`);
  lines.push(`import { TEMPLATES_CORE_PACK${hasRules ? ", getLocalRuleSets" : ""} } from "@haxitag/yueli-dex-templates-core";`);
  lines.push("");
  lines.push(`// 中文：构造一次 dex 实例，整个进程复用`);
  lines.push(`// English: Build the dex instance once and reuse it for the process`);
  lines.push(`const dex = createDex({`);
  lines.push(`  // providers: typesafe | cloudflare | vercel | http | mock-jev (dev)`);
  lines.push(`  providers: [typesafeProvider /* typesafe | cloudflare | vercel | http */],`);
  lines.push(`  routing: { default: { providerIds: ["typesafe"], maxAttempts: 2, circuitFailureThreshold: 3, circuitCooldownMs: 60_000 } },`);
  lines.push(`  templates: [TEMPLATES_CORE_PACK],`);
  if (hasRules) {
    lines.push(`  // ① 中文：可规则化的策略本地处理：命中即短路，不调用远程模型`);
    lines.push(`  // ① English: Rule-able policies short-circuit locally — zero remote calls`);
    lines.push(`  ruleSets: getLocalRuleSets("${templateId}"),`);
  } else {
    lines.push(`  // 中文：该模板无本地规则：决策全部路由到远程 Jev 模型`);
    lines.push(`  // English: No local rules — every decision routes to a remote Jev model`);
  }
  lines.push(`});`);
  lines.push("");
  lines.push(`// ② 中文：从场景模板编译 ChoiceRequest（${t.id}）`);
  lines.push(`// ② English: Compile the scenario template into a ChoiceRequest (${t.id})`);
  lines.push(`const request = await dex.templates.prepare({`);
  lines.push(`  template: "${templateId}",`);
  lines.push(`  input: ${inputJson},`);
  lines.push(`});`);
  lines.push("");
  lines.push(`// ③ 中文：决策`);
  lines.push(`//      · 本地规则命中 → model: "yueli-dex/rules@1"（零远程调用）`);
  lines.push(`//      · 未命中         → 路由到 provider，返回校准的概率分布`);
  lines.push(`// ③ English: Decide`);
  lines.push(`//      · Local rule hit  → model: "yueli-dex/rules@1" (zero remote call)`);
  lines.push(`//      · No local rule   → routed to provider, returns calibrated probabilities`);
  lines.push(`const response = await dex.choice(request);`);
  lines.push("");
  lines.push(`// ④ 中文：映射为可审计的 ActionIntent（请求，而非授权——执行方负责权限）`);
  lines.push(`// ④ English: Map to auditable ActionIntent (request, not authorization — executor owns authz)`);
  lines.push(`const intents = dex.templates.toActionIntent({`);
  lines.push(`  template: "${templateId}",`);
  lines.push(`  request,`);
  lines.push(`  response,`);
  lines.push(`});`);
  if (hasRules) {
    lines.push("");
    lines.push(`// 中文：分支提示`);
    lines.push(`//   · 按动作风险设阈值（只读 ~0.7；破坏性 ≥0.9 需确认）`);
    lines.push(`//   · 低于阈值走 needs_review 人工路径`);
    lines.push(`//   · 低置信是决策信息，不要重试`);
    lines.push(`// English: Branching tips`);
    lines.push(`//   · Thresholds by action risk (read-only ~0.7; destructive ≥0.9 + confirm)`);
    lines.push(`//   · Below threshold → needs_review (human path)`);
    lines.push(`//   · Low confidence is decision information — do NOT retry`);
  }
  return lines.join("\n");
}

/**
 * Examples for every template in the pack.
 */
export function buildAllCallExamples(): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of TEMPLATES) {
    out[t.id] = buildCallExample(t.id);
  }
  return out;
}

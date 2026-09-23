"use client";

import { useEffect, useMemo, useState } from "react";
import { JsonEditor } from "@/components/JsonEditor";
import { useI18n } from "@/components/I18nProvider";
import type { ChoiceRequest, ChoiceResponse } from "@haxitag/yueli-dex";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface CatalogEntry {
  id: string;
  version: string;
  theme: string;
  scenario: string;
  useCase: string;
  utility: string;
  references: string[];
  exampleInput: Record<string, unknown>;
  template: Record<string, unknown>;
  localRules: Array<{ id: string; version: string; scope: string; document: unknown }>;
  hasLocalRules: boolean;
  example: string;
}

interface RuleEvalResult {
  matched: Array<{ ruleId: string; ruleSetId: string; action: Record<string, unknown> }>;
  pinnedAnswers?: Record<string, string>;
  shortCircuit: {
    questionId?: string;
    choice?: string;
    message?: string;
    response: ChoiceResponse | null;
    complete?: boolean;
    pinnedAnswers?: Record<string, string>;
  } | null;
  forcedRoute: string | null;
  resolvedLocally: boolean;
  rejected?: { code: string; message: string; recoveryHint?: string };
}

interface E2EResult {
  response?: ChoiceResponse;
  receipt?: {
    route?: { selectedProviderId?: string; eligibleProviderIds?: string[] };
    rules?: Array<{ id: string; version: string }>;
    timing?: { elapsedMs?: number };
  };
  error?: { code: string; message: string; providerId?: string; recoveryHint?: string };
  durationMs?: number;
}

interface GenerateResult {
  template?: Record<string, unknown>;
  source?: "llm" | "scaffold";
  model?: string;
  generator?: string;
  note?: string;
  error?: string;
}

type Tier = "L1" | "L2" | "L3";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const THEME_ZH: Record<string, string> = {
  "customer-operations": "客户运营",
  communication: "沟通协作",
  "agent-infrastructure": "Agent 基础设施",
  "developer-tooling": "开发者工具",
  security: "安全风控",
  automation: "自动化",
};

// THEME_ZH is only used when locale === "zh". The English locale uses
// `t("td.theme.<id>")` so a missing translation key never falls back to a
// mixed-label string.

const THEME_ICON: Record<string, string> = {
  "customer-operations": "🎧",
  communication: "✉️",
  "agent-infrastructure": "🤖",
  "developer-tooling": "</>",
  security: "🛡",
  automation: "⚡",
};

const TIERS: { id: Tier; name: string; desc: string; badge: string }[] = [
  {
    id: "L1",
    name: "L1 · 规则引擎",
    desc: "非常确定和稳定的情况。命中即短路，零远程调用，零成本、零延迟。",
    badge: "确定性",
  },
  {
    id: "L2",
    name: "L2 · JEV 模型 API",
    desc: "开放式 jev 类模型接口。可以每个请求按接口手写 ChoiceRequest，也可以用场景模板编译。",
    badge: "开放接口",
  },
  {
    id: "L3",
    name: "L3 · LLM 生成模板",
    desc: "描述企业场景与期望效用，由 LLM 生成 yueli-dex-template/v1 场景效用模板并验证运行。",
    badge: "生成式",
  },
];

// English-only tier definitions for the en locale. The zh strings above act as
// the canonical default so a translation gap never renders a blank card.
const TIERS_EN: { id: Tier; name: string; desc: string; badge: string }[] = [
  {
    id: "L1",
    name: "L1 · Rule Engine",
    desc: "Highly certain and stable cases. Hit → short-circuit, zero remote call, zero latency.",
    badge: "Deterministic",
  },
  {
    id: "L2",
    name: "L2 · Jev Model API",
    desc: "Open Jev-class model interface. Hand-write ChoiceRequest per call, or compile from a scenario template.",
    badge: "Open API",
  },
  {
    id: "L3",
    name: "L3 · LLM-Generated Template",
    desc: "Describe the business scenario and expected utility; let the LLM generate and verify a yueli-dex-template/v1.",
    badge: "Generative",
  },
];

const DEFAULT_RUNTIME = {
  providers: [
    // Built-in deterministic mock JEV — zero credentials, zero network. Out of the box.
    // Switch `kind` to "typesafe" / "cloudflare" / "vercel" once env vars are set
    // to route to a real provider.
    { id: "mock-jev", kind: "mock" },
  ],
  routing: {
    default: {
      providerIds: ["mock-jev"],
      maxAttempts: 1,
      circuitFailureThreshold: 3,
      circuitCooldownMs: 60000,
    },
  },
};

const INLINE_REQUEST: ChoiceRequest = {
  state: { message: "I was charged twice and need a refund." },
  questions: {
    next_action: {
      type: "choice",
      instructions: "Which action should the enterprise automation take?",
      criteria: {
        proceed: "Policy-compliant and evidence clearly supports execution",
        escalate: "Requires a human decision or higher authority",
        needs_review: "Insufficient evidence to decide automatically",
      },
    },
  },
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Human-readable one-line summary of a rule's `when` condition. */
function describeWhen(when: unknown, locale: "zh" | "en"): string {
  if (typeof when !== "object" || when === null) return "?";
  const w = when as Record<string, unknown>;
  if (typeof w.path === "string") {
    const op = typeof w.op === "string" ? w.op : "?";
    // P2: strip the "input." prefix — at evaluation time the rule input IS
    // the compiled request state, so `$.input.accountPlan` reads from
    // state.accountPlan. Showing "input.accountPlan" confused users whose
    // state has no "input" key.
    const displayPath = w.path.replace(/^\$\.input\./, "").replace(/^\$\./, "");
    return `${displayPath} ${op} ${JSON.stringify(w.value ?? "")}`;
  }
  if (Array.isArray(w.any)) {
    const any = locale === "en" ? "any of: " : "任一命中: ";
    return any + w.any.map((c) => describeWhen(c, locale)).join(" | ");
  }
  if (Array.isArray(w.all)) {
    const all = locale === "en" ? "all of: " : "全部满足: ";
    return all + w.all.map((c) => describeWhen(c, locale)).join(" AND ");
  }
  if (w.not && typeof w.not === "object") return "NOT(" + describeWhen(w.not, locale) + ")";
  return JSON.stringify(w);
}

/** Human-readable one-line summary of a rule's `then` action. */
function describeThen(then: unknown, locale: "zh" | "en"): string {
  const t = (then ?? {}) as Record<string, unknown>;
  const kind = typeof t.kind === "string" ? t.kind : "?";
  if (kind === "shortCircuit") {
    return locale === "en"
      ? `short-circuit ${t.questionId}=${t.choice}`
      : `短路 ${t.questionId}=${t.choice}`;
  }
  if (kind === "reject") {
    const msg = typeof t.message === "string" ? t.message : "";
    return locale === "en"
      ? `reject${msg ? ` — ${msg}` : ""}`
      : `拒绝${msg ? ` — ${msg}` : ""}`;
  }
  return kind;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function TieredDecision() {
  const { locale, t } = useI18n();
  const tierDefs = locale === "en" ? TIERS_EN : TIERS;
  const [chainName, setChainName] = useState("choice-shaped-use-cases");
  const [tier, setTier] = useState<Tier>("L1");
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [themeFilter, setThemeFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [input, setInput] = useState<Record<string, unknown>>({});
  const [runtime, setRuntime] = useState<Record<string, unknown>>(DEFAULT_RUNTIME);

  // L1 / L2 shared
  const [compiledRequest, setCompiledRequest] = useState<ChoiceRequest | null>(null);
  const [ruleResult, setRuleResult] = useState<RuleEvalResult | null>(null);
  const [e2eResult, setE2eResult] = useState<E2EResult | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  // L2 inline mode
  const [l2Mode, setL2Mode] = useState<"template" | "inline">("template");
  const [inlineRequest, setInlineRequest] = useState<unknown>(INLINE_REQUEST);

  // L3
  const [genForm, setGenForm] = useState({ scenario: "", useCase: "", utility: "", theme: "automation" });
  const [generated, setGenerated] = useState<Record<string, unknown> | null>(null);
  const [genInfo, setGenInfo] = useState<GenerateResult | null>(null);

  const selected = catalog.find((c) => c.id === selectedId) ?? null;
  const themes = useMemo(() => Array.from(new Set(catalog.map((c) => c.theme))), [catalog]);
  const visible = themeFilter ? catalog.filter((c) => c.theme === themeFilter) : catalog;
  const localRuleCount = catalog.filter((c) => c.hasLocalRules).length;

  useEffect(() => {
    fetch("/api/templates")
      .then((r) => r.json() as Promise<{ templates?: CatalogEntry[] }>)
      .then((data: { templates?: CatalogEntry[] }) => {
        const entries = data.templates ?? [];
        setCatalog(entries);
        if (entries.length > 0) applyEntry(entries[0]);
      })
      .catch(() => setCatalog([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyEntry(entry: CatalogEntry) {
    setSelectedId(entry.id);
    setInput(entry.exampleInput);
    resetResults();
  }

  function resetResults() {
    setCompiledRequest(null);
    setRuleResult(null);
    setE2eResult(null);
    setGenInfo(null);
  }

  /** Compile the selected template into a ChoiceRequest via /api/template. */
  async function compile(entry: CatalogEntry | null, tpl?: Record<string, unknown> | null): Promise<ChoiceRequest | null> {
    const template = tpl ?? entry?.template;
    if (!template) return null;
    const res = await fetch("/api/template", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template, input, action: "prepare" }),
    });
    const data = (await res.json()) as { request?: ChoiceRequest; error?: string };
    if (data.request) {
      setCompiledRequest(data.request as ChoiceRequest);
      return data.request as ChoiceRequest;
    }
    setE2eResult({ error: { code: "COMPILE", message: String(data.error) } });
    return null;
  }

  /* ---------------- L1: 本地规则引擎（确定性决策） ---------------- */

  const handleL1Run = async () => {
    if (!selected) return;
    setLoading("l1");
    setRuleResult(null);
    setE2eResult(null);
    try {
      const request = await compile(selected);
      if (!request) return;
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rules", ruleSets: selected.localRules, choiceRequest: request }),
      });
      setRuleResult((await res.json()) as RuleEvalResult);
    } catch (err) {
      setRuleResult({
        matched: [], shortCircuit: null, forcedRoute: null, resolvedLocally: false,
        rejected: { code: "NETWORK", message: (err as Error).message },
      });
    } finally {
      setLoading(null);
    }
  };

  /* ---------------- L2: JEV 模型 API（模板 / 按接口写） ---------------- */

  const handleL2Compile = async () => {
    if (!selected) return;
    setLoading("l2c");
    setRuleResult(null);
    setE2eResult(null);
    await compile(selected);
    setLoading(null);
  };

  const handleL2Run = async () => {
    const request =
      l2Mode === "inline" ? (inlineRequest as ChoiceRequest) : compiledRequest ?? (await compile(selected));
    if (!request) return;
    setLoading("l2r");
    setRuleResult(null);
    setE2eResult(null);
    try {
      const res = await fetch("/api/choice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: { ...runtime, ruleSets: l2Mode === "template" ? selected?.localRules ?? [] : [] },
          choiceRequest: request,
        }),
      });
      const data = (await res.json()) as E2EResult & { ruleRejected?: { code: string; message: string } };
      if (data.ruleRejected) {
        setE2eResult({ error: { code: data.ruleRejected.code, message: data.ruleRejected.message } });
      } else {
        setE2eResult(data as E2EResult);
      }
    } catch (err) {
      setE2eResult({ error: { code: "NETWORK", message: (err as Error).message } });
    } finally {
      setLoading(null);
    }
  };

  /* ---------------- L3: LLM 生成场景效用模板 ---------------- */

  const handleGenerate = async () => {
    setLoading("gen");
    setGenerated(null);
    setGenInfo(null);
    setCompiledRequest(null);
    setE2eResult(null);
    try {
      const res = await fetch("/api/generate-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(genForm),
      });
      const data = (await res.json()) as GenerateResult;
      setGenInfo(data);
      if (data.template) setGenerated(data.template);
    } catch (err) {
      setGenInfo({ error: (err as Error).message });
    } finally {
      setLoading(null);
    }
  };

  const handleL3Compile = async () => {
    if (!generated) return;
    setLoading("l3c");
    setE2eResult(null);
    await compile(null, generated);
    setLoading(null);
  };

  const handleL3Run = async () => {
    const request = compiledRequest ?? (await compile(null, generated));
    if (!request) return;
    setLoading("l3r");
    setE2eResult(null);
    try {
      const res = await fetch("/api/choice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { ...runtime, ruleSets: [] }, choiceRequest: request }),
      });
      const data = (await res.json()) as E2EResult & { ruleRejected?: { code: string; message: string } };
      if (data.ruleRejected) {
        setE2eResult({ error: { code: data.ruleRejected.code, message: data.ruleRejected.message } });
      } else {
        setE2eResult(data as E2EResult);
      }
    } catch (err) {
      setE2eResult({ error: { code: "NETWORK", message: (err as Error).message } });
    } finally {
      setLoading(null);
    }
  };

  const btn =
    "rounded-lg px-4 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-40";
  const card =
    "rounded-xl border p-4 text-left transition-colors cursor-pointer";

  return (
    <div className="space-y-6">
      {/* ── 决策链名称（对应 Cloudflare 令牌名称） ── */}
      <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-sm font-semibold text-dex-text">{t("td.chainName")}</h2>
          <span className="text-xs text-dex-muted">{t("td.chainHint")}</span>
        </div>
        <input
          value={chainName}
          onChange={(e) => setChainName(e.target.value)}
          className="w-full max-w-md rounded-lg border border-dex-border bg-dex-bg px-3 py-2 text-sm text-dex-text focus:border-dex-accent focus:outline-none"
        />
      </section>

      {/* ── 三级决策层级 ── */}
      <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
        <h2 className="text-sm font-semibold text-dex-text mb-3">{t("td.tiers")}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {tierDefs.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTier(t.id); resetResults(); }}
              className={`${card} ${
                tier === t.id
                  ? "border-dex-accent bg-dex-accent/10"
                  : "border-dex-border bg-dex-bg hover:border-dex-accent/50"
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-semibold text-dex-text">{t.name}</span>
                <span className="rounded-full border border-dex-border px-2 py-0.5 text-[10px] text-dex-muted">{t.badge}</span>
              </div>
              <p className="text-xs text-dex-muted leading-relaxed">{t.desc}</p>
            </button>
          ))}
        </div>
      </section>

      {/* ── 模板目录（Cloudflare 权限策略卡片式） ── */}
      <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-dex-text">{t("td.catalogHeader")}</h2>
          <span className="text-xs text-dex-muted">
            {t("td.catalogCount", { count: catalog.length, rules: localRuleCount })}
          </span>
        </div>
        {/* 主题过滤 */}
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setThemeFilter(null)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              themeFilter === null ? "border-dex-accent text-dex-text bg-dex-accent/10" : "border-dex-border text-dex-muted hover:text-dex-text"
            }`}
          >
            {t("td.allThemes")}
          </button>
          {themes.map((th) => (
            <button
              key={th}
              onClick={() => setThemeFilter(th === themeFilter ? null : th)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                themeFilter === th ? "border-dex-accent text-dex-text bg-dex-accent/10" : "border-dex-border text-dex-muted hover:text-dex-text"
              }`}
            >
              {THEME_ICON[th] ?? "◆"} {locale === "en" ? t(`td.theme.${th}`) : (THEME_ZH[th] ?? th)}
            </button>
          ))}
        </div>
        {/* 卡片网格 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visible.map((c) => (
            <button
              key={c.id}
              onClick={() => applyEntry(c)}
              className={`${card} ${
                selectedId === c.id
                  ? "border-dex-accent bg-dex-accent/10"
                  : "border-dex-border bg-dex-bg hover:border-dex-accent/50"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 text-lg" aria-hidden>{THEME_ICON[c.theme] ?? "◆"}</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-dex-text truncate">{c.scenario}</p>
                  <p className="text-xs text-dex-muted mt-0.5">
                    {c.hasLocalRules
                      ? locale === "en"
                        ? `${c.localRules.reduce((n, rs) => {
                            const doc = rs.document as { rules?: unknown[] };
                            return n + (Array.isArray(doc.rules) ? doc.rules.length : 0);
                          }, 0)} local rules`
                        : `${c.localRules.reduce((n, rs) => {
                            const doc = rs.document as { rules?: unknown[] };
                            return n + (Array.isArray(doc.rules) ? doc.rules.length : 0);
                          }, 0)} 项本地规则`
                      : locale === "en"
                      ? "Requires remote model"
                      : "需远程模型"}
                  </p>
                  <p className="text-xs text-dex-muted mt-1.5 line-clamp-2 opacity-80">{c.useCase}</p>
                </div>
              </div>
            </button>
          ))}
          {/* 从零开始 → L3 */}
          <button
            onClick={() => { setTier("L3"); setThemeFilter(null); setGenerated(null); setGenInfo(null); resetResults(); }}
            className={`${card} border-dashed border-dex-border bg-transparent hover:border-dex-accent/50`}
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-lg text-dex-accent" aria-hidden>＋</span>
              <div>
                <p className="text-sm font-medium text-dex-text">{t("td.fromScratch")}</p>
                <p className="text-xs text-dex-muted mt-0.5">{t("td.fromScratchHint")}</p>
              </div>
            </div>
          </button>
        </div>
      </section>

      {/* ── 选中模板的 场景/用例/效用 详情 ── */}
      {selected ? (
        <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="rounded-full border border-dex-border bg-dex-bg px-2.5 py-0.5 text-xs text-dex-text">
              {THEME_ZH[selected.theme] ?? selected.theme}
            </span>
            <span className="text-sm font-semibold text-dex-text">{selected.id}</span>
            <span className={`rounded-full border px-2.5 py-0.5 text-xs ${selected.hasLocalRules ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300"}`}>
              {selected.hasLocalRules
                ? locale === "en"
                  ? "L1 short-circuitable"
                  : "L1 可短路"
                : locale === "en"
                ? "Go to L2"
                : "直达 L2"}
            </span>
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs">
            <div className="flex gap-2">
              <dt className="text-dex-muted whitespace-nowrap">{t("td.label.scenario")}</dt>
              <dd className="text-dex-text">{selected.scenario}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-dex-muted whitespace-nowrap">{t("td.label.useCase")}</dt>
              <dd className="text-dex-text">{selected.useCase}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-dex-muted whitespace-nowrap">{t("td.label.utility")}</dt>
              <dd className="text-dex-text">{selected.utility}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {/* ── 各层执行区 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          {/* L1 */}
          {tier === "L1" ? (
            <>
              <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
                <h2 className="text-sm font-semibold text-dex-text mb-3">{t("td.l1.header")}</h2>
                {selected?.hasLocalRules ? (
                  <div className="space-y-2">
                    {selected.localRules.map((rs) => {
                      const doc = rs.document as { rules?: Array<{ id: string; when: unknown; then: unknown }> };
                      return (doc.rules ?? []).map((r) => (
                        <div key={`${rs.id}/${r.id}`} className="rounded-lg border border-dex-border bg-dex-bg p-3 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-dex-text">{r.id}</span>
                            <span className="text-[10px] text-dex-muted">{rs.id}</span>
                          </div>
                          <p className="mt-1 text-dex-muted">WHEN <code className="text-dex-text">{describeWhen(r.when, locale)}</code></p>
                          <p className="text-dex-muted">THEN <code className="text-emerald-300">{describeThen(r.then, locale)}</code></p>
                        </div>
                      ));
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-dex-muted">
                    {t("td.l1.openWorld", { id: selected?.id ?? t("td.l1.openWorldFallback") })}
                  </p>
                )}
              </section>
              <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
                <h2 className="text-sm font-semibold text-dex-text mb-3">{t("td.l1.inputData")}</h2>
                <JsonEditor key={`l1-in-${selectedId}`} value={input} onChange={(v) => setInput((v ?? {}) as Record<string, unknown>)} height="120px" />
                <button onClick={handleL1Run} disabled={loading !== null || !selected?.hasLocalRules} className={`${btn} mt-3 w-full bg-gradient-to-r from-dex-accent to-dex-accent2 text-white hover:opacity-90`}>
                  {loading === "l1" ? t("td.l1.evaluating") : t("td.l1.runButton")}
                </button>
              </section>
            </>
          ) : null}

          {/* L2 */}
          {tier === "L2" ? (
            <>
              <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-sm font-semibold text-dex-text">{t("td.l2.header")}</h2>
                  <div className="flex rounded-lg border border-dex-border overflow-hidden text-xs">
                    <button onClick={() => setL2Mode("template")} className={`px-3 py-1.5 ${l2Mode === "template" ? "bg-dex-accent/20 text-dex-text" : "text-dex-muted hover:text-dex-text"}`}>{t("td.l2.modeTemplate")}</button>
                    <button onClick={() => setL2Mode("inline")} className={`px-3 py-1.5 ${l2Mode === "inline" ? "bg-dex-accent/20 text-dex-text" : "text-dex-muted hover:text-dex-text"}`}>{t("td.l2.modeInline")}</button>
                  </div>
                </div>
                {l2Mode === "template" ? (
                  <>
                    <p className="text-xs text-dex-muted mb-2">{t("td.l2.explainer", { id: selectedId || t("td.l2.explainerNoId") })}</p>
                    <JsonEditor key={`l2-in-${selectedId}`} value={input} onChange={(v) => setInput((v ?? {}) as Record<string, unknown>)} height="120px" />
                    <button onClick={handleL2Compile} disabled={loading !== null || !selected} className={`${btn} mt-3 w-full border border-dex-border text-dex-text hover:bg-dex-bg`}>
                      {loading === "l2c" ? t("td.l2.compiling") : t("td.l2.compileButton")}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-dex-muted mb-2">{t("td.l2.inlineExplainer")}</p>
                    <JsonEditor value={inlineRequest} onChange={(v) => setInlineRequest(v)} height="240px" />
                  </>
                )}
              </section>
              <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
                <h2 className="text-sm font-semibold text-dex-text mb-3">{t("td.l2.runtimeConfig")}</h2>
                <JsonEditor value={runtime} onChange={(v) => setRuntime((v ?? {}) as Record<string, unknown>)} height="130px" />
                <button onClick={handleL2Run} disabled={loading !== null || (l2Mode === "template" && !compiledRequest)} className={`${btn} mt-3 w-full bg-gradient-to-r from-dex-accent to-dex-accent2 text-white hover:opacity-90`}>
                  {loading === "l2r" ? t("td.l2.running") : t("td.l2.runButton")}
                </button>
              </section>
            </>
          ) : null}

          {/* L3 */}
          {tier === "L3" ? (
            <>
              <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
                <h2 className="text-sm font-semibold text-dex-text mb-3">{t("td.l3.header")}</h2>
                <div className="space-y-2 text-xs">
                  <input value={genForm.scenario} onChange={(e) => setGenForm({ ...genForm, scenario: e.target.value })} placeholder={t("td.l3.placeholderScenario")} className="w-full rounded-lg border border-dex-border bg-dex-bg px-3 py-2 text-sm text-dex-text focus:border-dex-accent focus:outline-none" />
                  <textarea value={genForm.useCase} onChange={(e) => setGenForm({ ...genForm, useCase: e.target.value })} placeholder={t("td.l3.placeholderUseCase")} rows={2} className="w-full rounded-lg border border-dex-border bg-dex-bg px-3 py-2 text-sm text-dex-text focus:border-dex-accent focus:outline-none" />
                  <textarea value={genForm.utility} onChange={(e) => setGenForm({ ...genForm, utility: e.target.value })} placeholder={t("td.l3.placeholderUtility")} rows={2} className="w-full rounded-lg border border-dex-border bg-dex-bg px-3 py-2 text-sm text-dex-text focus:border-dex-accent focus:outline-none" />
                  <select value={genForm.theme} onChange={(e) => setGenForm({ ...genForm, theme: e.target.value })} className="w-full rounded-lg border border-dex-border bg-dex-bg px-3 py-2 text-sm text-dex-text focus:border-dex-accent focus:outline-none">
                    {Object.entries(THEME_ZH).map(([k, v]) => (
                      <option key={k} value={k}>{v}（{k}）</option>
                    ))}
                  </select>
                </div>
                <button onClick={handleGenerate} disabled={loading !== null || (!genForm.scenario && !genForm.useCase)} className={`${btn} mt-3 w-full bg-gradient-to-r from-dex-accent to-dex-accent2 text-white hover:opacity-90`}>
                  {loading === "gen" ? t("td.l3.generating") : t("td.l3.generateButton")}
                </button>
                {genInfo?.note ? <p className="mt-2 text-xs text-amber-300">{genInfo.note}</p> : null}
                {genInfo?.source === "llm" ? <p className="mt-2 text-xs text-emerald-300">{t("td.l3.llmGenerated", { generator: String(genInfo.generator ?? ""), model: String(genInfo.model ?? "") })}</p> : null}
                {genInfo?.error ? <p className="mt-2 text-xs text-red-300">{t("td.l3.failed", { error: String(genInfo.error) })}</p> : null}
              </section>
              {generated ? (
                <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
                  <h2 className="text-sm font-semibold text-dex-text mb-3">{t("td.l3.editableHeader")}</h2>
                  <JsonEditor key={`l3-${generated ? "t" : "f"}`} value={generated} onChange={(v) => setGenerated((v ?? {}) as Record<string, unknown>)} height="260px" />
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <button onClick={handleL3Compile} disabled={loading !== null} className={`${btn} border border-dex-border text-dex-text hover:bg-dex-bg`}>
                      {loading === "l3c" ? t("td.l3.verifying") : t("td.l3.verifyButton")}
                    </button>
                    <button onClick={handleL3Run} disabled={loading !== null || !compiledRequest} className={`${btn} bg-gradient-to-r from-dex-accent to-dex-accent2 text-white hover:opacity-90`}>
                      {loading === "l3r" ? t("td.l2.running") : t("td.l3.runButton")}
                    </button>
                  </div>
                </section>
              ) : null}
            </>
          ) : null}
        </div>

        {/* 右列：执行链结果 */}
        <div className="space-y-6">
          <section className="rounded-xl border border-dex-border bg-dex-surface p-4 space-y-3">
            <h2 className="text-sm font-semibold text-dex-text">
              {t("td.chainResult.header")} <span className="text-dex-muted font-normal">· {chainName} · {tier}</span>
            </h2>

            {compiledRequest && tier !== "L2" ? (
              <div>
                <p className="text-xs font-medium text-dex-muted mb-1">{t("td.chainResult.choiceRequest")}</p>
                <pre className="code-block text-dex-text whitespace-pre-wrap [overflow-wrap:anywhere] max-h-[160px] overflow-auto text-xs">
                  {JSON.stringify(compiledRequest, null, 2)}
                </pre>
              </div>
            ) : null}

            {ruleResult ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-dex-muted">{t("td.chainResult.l1Eval")}</p>
                {ruleResult.rejected ? (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
                    {t("td.chainResult.rejected", { message: ruleResult.rejected.message })}
                    <div className="mt-1 text-red-400/70">{t("td.rejected")}</div>
                  </div>
                ) : ruleResult.shortCircuit?.complete !== false && ruleResult.shortCircuit?.response ? (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
                    {t("td.chainResult.shortCircuit", { q: ruleResult.shortCircuit.questionId ?? "", c: ruleResult.shortCircuit.choice ?? "" })}
                    <div className="mt-1 text-emerald-400/70">
                      {t("td.chainResult.shortCircuitMsg", { message: ruleResult.shortCircuit.message ?? "" })}
                    </div>
                  </div>
                ) : ruleResult.shortCircuit || (ruleResult.pinnedAnswers && Object.keys(ruleResult.pinnedAnswers).length > 0) ? (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                    {t("td.chainResult.partialPin", {
                      pins: Object.entries(ruleResult.shortCircuit?.pinnedAnswers ?? ruleResult.pinnedAnswers ?? {})
                        .map(([q, c]) => `${q}=${c}`)
                        .join(", "),
                    })}
                    <div className="mt-1 text-amber-400/70">{t("td.chainResult.partialPinHint")}</div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dex-border bg-dex-bg p-3 text-xs text-dex-muted">
                    {t("td.chainResult.missed", { n: ruleResult.matched.length })}
                  </div>
                )}
              </div>
            ) : null}

            {e2eResult ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-dex-muted">{t("td.chainResult.e2e")}</p>
                {e2eResult.error ? (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                    ⚠️ {e2eResult.error.code}: {e2eResult.error.message}
                    <div className="mt-1 text-amber-400/70">
                      <>{t("td.chainResult.mockHint").split("kind").map((part, i, arr) =>
                        i < arr.length - 1 ? (
                          <span key={i}>{part}<code>kind</code></span>
                        ) : (
                          <span key={i}>{part}</span>
                        ),
                      )}</>
                    </div>
                  </div>
                ) : (
                  <div className={`rounded-lg border p-3 text-xs ${
                    e2eResult.receipt?.route?.selectedProviderId === "yueli-dex/rules@1"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : "border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
                  }`}>
                    {e2eResult.receipt?.route?.selectedProviderId === "yueli-dex/rules@1"
                      ? t("td.chainResult.l1Done")
                      : t("td.chainResult.l2Done")}{" "}
                    · {e2eResult.receipt?.timing?.elapsedMs ?? e2eResult.durationMs ?? "?"}ms
                    {e2eResult.response ? (
                      <div className="mt-1 opacity-80">
                        {Object.entries(e2eResult.response.answers)
                          .map(([q, a]) => `${q}=${a.choice} (conf ${a.confidence})`)
                          .join(" · ")}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}

            {!ruleResult && !e2eResult && !compiledRequest ? (
              <p className="text-xs text-dex-muted">
                {t("td.chainResult.empty")}
              </p>
            ) : null}
          </section>

          {/* L1 短路时的合成响应 */}
          {ruleResult?.shortCircuit?.response ? (
            <section className="rounded-xl border border-emerald-500/30 bg-dex-surface p-4">
              <h2 className="text-sm font-semibold text-dex-text mb-2">{t("td.chainResult.l1Response")}</h2>
              <pre className="code-block text-emerald-200 whitespace-pre-wrap [overflow-wrap:anywhere] max-h-[180px] overflow-auto text-xs">
                {JSON.stringify(ruleResult.shortCircuit.response, null, 2)}
              </pre>
            </section>
          ) : null}

          {selected && tier === "L2" ? (
            <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
              <h2 className="text-sm font-semibold text-dex-text mb-2">{t("td.sdkExample")}</h2>
              <pre className="code-block text-dex-text whitespace-pre-wrap [overflow-wrap:anywhere] max-h-[300px] overflow-auto text-xs">
                {selected.example}
              </pre>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

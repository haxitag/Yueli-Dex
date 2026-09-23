"use client";

import { useEffect, useState } from "react";
import { JsonEditor } from "@/components/JsonEditor";
import { useI18n } from "@/components/I18nProvider";
import type { ChoiceRequest, ChoiceResponse } from "@haxitag/yueli-dex";

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

const THEME_BADGES: Record<string, string> = {
  "customer-operations": "bg-blue-500/15 text-blue-300 border-blue-500/30",
  communication: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  "agent-infrastructure": "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  "developer-tooling": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  security: "bg-red-500/15 text-red-300 border-red-500/30",
  automation: "bg-amber-500/15 text-amber-300 border-amber-500/30",
};

const DEFAULT_RUNTIME = {
  providers: [
    // Built-in deterministic mock — zero credentials, zero network.
    // Out of the box Template Tester E2E must work without a local JEV on :9876.
    // Switch kind to "typesafe" / "cloudflare" / "vercel" / "http" once configured.
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

const FALLBACK_RESPONSE: ChoiceResponse = {
  model: "jev-1.0.0",
  answers: {
    handler: {
      type: "choice",
      choice: "billing",
      confidence: 0.9,
      probabilities: { billing: 0.9, technical: 0.05, account: 0.02, needs_review: 0.03 },
    },
  },
};

export function TemplateTester() {
  const { t } = useI18n();
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [themeFilter, setThemeFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string>("");
  const [template, setTemplate] = useState<Record<string, unknown>>({});
  const [input, setInput] = useState<Record<string, unknown>>({});
  const [runtime, setRuntime] = useState<Record<string, unknown>>(DEFAULT_RUNTIME);

  const [compiledRequest, setCompiledRequest] = useState<ChoiceRequest | null>(null);
  const [ruleResult, setRuleResult] = useState<RuleEvalResult | null>(null);
  const [e2eResult, setE2eResult] = useState<E2EResult | null>(null);
  const [response, setResponse] = useState<ChoiceResponse>(FALLBACK_RESPONSE);
  const [intents, setIntents] = useState<unknown[] | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const selected = catalog.find((c) => c.id === selectedId) ?? null;

  // Category（主题）过滤：受控词汇表顺序稳定，过滤不改变选中项
  const themes = Array.from(new Set(catalog.map((c) => c.theme)));
  const filtered =
    themeFilter === "all" ? catalog : catalog.filter((c) => c.theme === themeFilter);

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
    setTemplate(entry.template);
    setInput(entry.exampleInput);
    setCompiledRequest(null);
    setRuleResult(null);
    setE2eResult(null);
    setIntents(null);
  }

  const handleCompile = async () => {
    setLoading("compile");
    setCompiledRequest(null);
    setRuleResult(null);
    setE2eResult(null);
    setIntents(null);
    try {
      const res = await fetch("/api/template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template, input, action: "prepare" }),
      });
      const data = (await res.json()) as { request?: ChoiceRequest; error?: string };
      if (data.request) setCompiledRequest(data.request as ChoiceRequest);
      else setE2eResult({ error: { code: "COMPILE", message: String(data.error) } });
    } catch (err) {
      setE2eResult({ error: { code: "NETWORK", message: (err as Error).message } });
    } finally {
      setLoading(null);
    }
  };

  const handleRules = async () => {
    if (!compiledRequest || !selected) return;
    setLoading("rules");
    setRuleResult(null);
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rules",
          ruleSets: selected.localRules,
          choiceRequest: compiledRequest,
        }),
      });
      setRuleResult((await res.json()) as RuleEvalResult);
    } catch (err) {
      setRuleResult({
        matched: [],
        shortCircuit: null,
        forcedRoute: null,
        resolvedLocally: false,
        rejected: { code: "NETWORK", message: (err as Error).message },
      });
    } finally {
      setLoading(null);
    }
  };

  const handleEndToEnd = async () => {
    if (!compiledRequest || !selected) return;
    setLoading("e2e");
    setE2eResult(null);
    setIntents(null);
    try {
      const res = await fetch("/api/choice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: { ...runtime, ruleSets: selected.localRules },
          choiceRequest: compiledRequest,
        }),
      });
      const data = (await res.json()) as E2EResult & { ruleRejected?: { code: string; message: string } };
      if (data.ruleRejected) {
        setE2eResult({ error: { code: data.ruleRejected.code, message: data.ruleRejected.message } });
      } else {
        setE2eResult(data as E2EResult);
        if (data.response) setResponse(data.response as ChoiceResponse);
      }    } catch (err) {
      setE2eResult({ error: { code: "NETWORK", message: (err as Error).message } });
    } finally {
      setLoading(null);
    }
  };

  const handleIntent = async () => {
    if (!compiledRequest || !template.id) return;
    setLoading("intent");
    setIntents(null);
    try {
      const res = await fetch("/api/template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template, action: "intent", request: compiledRequest, response }),
      });
      const data = (await res.json()) as { intents?: unknown[] };
      setIntents((data.intents ?? []) as unknown[]);
    } catch (err) {
      setIntents([{ error: (err as Error).message }]);
    } finally {
      setLoading(null);
    }
  };

  const copyExample = async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.example);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const btn =
    "rounded-lg px-4 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-40";

  return (
    <div className="space-y-6">
      {/* 模板目录 + 四维度标签 */}
      <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
          <h2 className="text-sm font-semibold text-dex-text whitespace-nowrap">{t("tt.catalog")}</h2>
          <select
            value={themeFilter}
            onChange={(e) => {
              setThemeFilter(e.target.value);
              // 切换分类后若当前选中项被过滤掉，自动选中该分类第一个模板
              if (e.target.value !== "all" && selected && selected.theme !== e.target.value) {
                const first = catalog.find((c) => c.theme === e.target.value);
                if (first) applyEntry(first);
              }
            }}
            className="rounded-lg border border-dex-border bg-dex-bg px-3 py-2 text-sm text-dex-text focus:border-dex-accent focus:outline-none whitespace-nowrap"
            aria-label={t("tt.themeFilterAria")}
          >
            <option value="all">{t("tt.allThemes")}</option>
            {themes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={selectedId}
            onChange={(e) => {
              const entry = catalog.find((c) => c.id === e.target.value);
              if (entry) applyEntry(entry);
            }}
            className="flex-1 rounded-lg border border-dex-border bg-dex-bg px-3 py-2 text-sm text-dex-text focus:border-dex-accent focus:outline-none"
          >
            {filtered.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} — {c.scenario} {c.hasLocalRules ? "⚖️" : ""}
              </option>
            ))}
          </select>
          <span className="text-xs text-dex-muted whitespace-nowrap">{filtered.length} / {catalog.length} templates</span>
        </div>

        {selected ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <span className={`rounded-full border px-2.5 py-0.5 text-xs ${THEME_BADGES[selected.theme] ?? "border-dex-border text-dex-muted"}`}>
                主题 · {selected.theme}
              </span>
              <span className="rounded-full border border-dex-border bg-dex-bg px-2.5 py-0.5 text-xs text-dex-muted">
                场景 · {selected.scenario}
              </span>
              <span className={`rounded-full border px-2.5 py-0.5 text-xs ${selected.hasLocalRules ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-dex-border text-dex-muted"}`}>
                {selected.hasLocalRules ? "⚖️ 含本地规则（可零远程调用）" : "🚀 需远程模型"}
              </span>
            </div>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs">
              <div className="flex gap-2">
                <dt className="text-dex-muted whitespace-nowrap">{t("tt.label.useCase")}</dt>
                <dd className="text-dex-text">{selected.useCase}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-dex-muted whitespace-nowrap">{t("tt.label.utility")}</dt>
                <dd className="text-dex-text">{selected.utility}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-dex-muted whitespace-nowrap">{t("tt.label.evidence")}</dt>
                <dd className="text-dex-muted">{selected.references.join(" · ")}</dd>
              </div>
            </dl>
          </div>
        ) : (
          <p className="text-sm text-dex-muted">{t("tt.loading")}</p>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左列：定义 / 输入 / 运行时 / 操作 */}
        <div className="space-y-6">
          <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
            <h2 className="text-sm font-semibold text-dex-text mb-3">{t("tt.templateDefinition")}</h2>
            <JsonEditor key={`tpl-${selectedId}`} value={template} onChange={(v) => setTemplate(v as Record<string, unknown>)} height="260px" />
          </section>

          <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
            <h2 className="text-sm font-semibold text-dex-text mb-3">{t("tt.inputData")}</h2>
            <JsonEditor key={`in-${selectedId}`} value={input} onChange={(v) => setInput(v as Record<string, unknown>)} height="110px" />
          </section>

          <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
            <h2 className="text-sm font-semibold text-dex-text mb-3">{t("tt.runtimeConfig")}</h2>
            <JsonEditor key={`rt-${selectedId}`} value={runtime} onChange={(v) => setRuntime(v as Record<string, unknown>)} height="130px" />
          </section>

          <div className="grid grid-cols-2 gap-2">
            <button onClick={handleCompile} disabled={loading !== null} className={`${btn} bg-gradient-to-r from-dex-accent to-dex-accent2 text-white hover:opacity-90`}>
              {loading === "compile" ? t("tt.button.compiling") : t("tt.button.compile")}
            </button>
            <button onClick={handleRules} disabled={loading !== null || !compiledRequest || !selected?.hasLocalRules} className={`${btn} border border-dex-border text-dex-text hover:bg-dex-bg`}>
              {loading === "rules" ? t("tt.button.evaluating") : t("tt.button.evaluate")}
            </button>
            <button onClick={handleEndToEnd} disabled={loading !== null || !compiledRequest} className={`${btn} bg-gradient-to-r from-dex-accent to-dex-accent2 text-white hover:opacity-90 col-span-2`}>
              {loading === "e2e" ? t("tt.button.executing") : t("tt.button.execute")}
            </button>
          </div>
        </div>

        {/* 右列：调用示例 / 结果链 */}
        <div className="space-y-6">
          <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-dex-text">{t("tt.example")}</h2>
              <button onClick={copyExample} className="text-xs text-dex-muted hover:text-dex-accent transition-colors">
                {copied ? t("tt.copied") : t("tt.copy")}
              </button>
            </div>
            <pre className="code-block text-dex-text whitespace-pre-wrap [overflow-wrap:anywhere] max-h-[340px] overflow-auto text-xs">
              {selected?.example ?? t("tt.examplePlaceholder")}
            </pre>
          </section>

          <section className="rounded-xl border border-dex-border bg-dex-surface p-4 space-y-3">
            <h2 className="text-sm font-semibold text-dex-text">{t("tt.chainResult")}</h2>

            {compiledRequest ? (
              <div>
                <p className="text-xs font-medium text-dex-muted mb-1">{t("tt.step.compile")}</p>
                <pre className="code-block text-dex-text whitespace-pre-wrap [overflow-wrap:anywhere] max-h-[180px] overflow-auto text-xs">
                  {JSON.stringify(compiledRequest, null, 2)}
                </pre>
              </div>
            ) : null}

            {ruleResult ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-dex-muted">{t("tt.step.evaluate")}</p>
                {ruleResult.rejected ? (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
                    {t("tt.rejectedWithReason", { message: ruleResult.rejected.message })}
                    <div className="mt-1 text-red-400/70">{t("tt.rejected")}</div>
                  </div>
                ) : ruleResult.shortCircuit?.complete !== false && ruleResult.shortCircuit?.response ? (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
                    {t("tt.shortCircuitHit", { questionId: ruleResult.shortCircuit.questionId ?? "", choice: ruleResult.shortCircuit.choice ?? "" })}
                    <div className="mt-1 text-emerald-400/70">
                      {ruleResult.shortCircuit.message ?? ""} · 零远程调用 · model: &quot;yueli-dex/rules@1&quot;
                    </div>
                  </div>
                ) : ruleResult.shortCircuit || (ruleResult.pinnedAnswers && Object.keys(ruleResult.pinnedAnswers).length > 0) ? (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                    {t("tt.partialPin", {
                      pins: Object.entries(ruleResult.shortCircuit?.pinnedAnswers ?? ruleResult.pinnedAnswers ?? {})
                        .map(([q, c]) => `${q}=${c}`)
                        .join(", "),
                    })}
                    <div className="mt-1 text-amber-400/70">{t("tt.partialPinHint")}</div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dex-border bg-dex-bg p-3 text-xs text-dex-muted">
                    ⏭ 本地规则未命中（{ruleResult.matched.length} 条匹配，无短路）→ 需调用远程 Jev 模型
                  </div>
                )}
              </div>
            ) : null}

            {e2eResult ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-dex-muted">{t("tt.step.e2e")}</p>
                {e2eResult.error ? (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                    ⚠️ {e2eResult.error.code}: {e2eResult.error.message}
                    <div className="mt-1 text-amber-400/70">
                      {t("tt.providerHint")}
                    </div>
                  </div>
                ) : (
                  <div className={`rounded-lg border p-3 text-xs ${
                    e2eResult.receipt?.route?.selectedProviderId === "yueli-dex/rules@1"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : "border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
                  }`}>
                    {e2eResult.receipt?.route?.selectedProviderId === "yueli-dex/rules@1"
                      ? "🏠 本地规则短路完成决策（零远程调用）"
                      : "🚀 远程模型完成决策"}{" "}
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
          </section>

          <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
            <h2 className="text-sm font-semibold text-dex-text mb-3">{t("tt.responseEditor")}</h2>
            <JsonEditor value={response} onChange={(v) => setResponse(v as ChoiceResponse)} height="180px" />
            <button
              onClick={handleIntent}
              disabled={loading !== null || !compiledRequest}
              className={`${btn} mt-3 w-full border border-dex-border text-dex-text hover:bg-dex-bg`}
            >
              {loading === "intent" ? "映射中…" : "④ Map → ActionIntent"}
            </button>
            {intents ? (
              <div className="mt-3">
                <p className="text-xs font-medium text-dex-muted mb-1">ActionIntents</p>
                <pre className="code-block text-dex-text whitespace-pre-wrap [overflow-wrap:anywhere] max-h-[200px] overflow-auto text-xs">
                  {JSON.stringify(intents, null, 2)}
                </pre>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

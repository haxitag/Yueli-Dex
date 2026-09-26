"use client";

import { useState } from "react";
import { JsonEditor } from "@/components/JsonEditor";
import { EnvKeyStatus } from "@/components/EnvKeyStatus";
import type { ProviderConfig } from "@/lib/types";
import type { ChoiceRequest } from "@haxitag/yueli-dex";

const SAMPLE_PROVIDERS: Record<string, ProviderConfig> = {
  http: { id: "http-test", kind: "http", endpoint: "http://localhost:9876", useEnv: true },
  typesafe: { id: "typesafe-test", kind: "typesafe", useEnv: true, model: "jev-latest" },
  cloudflare: { id: "cf-test", kind: "cloudflare", useEnv: true },
  vercel: { id: "vercel-test", kind: "vercel", useEnv: true, model: "" },
};

const SAMPLE_REQUEST: ChoiceRequest = {
  state: "Is this a billing issue?",
  questions: {
    handler: {
      type: "choice",
      instructions: "Which team?",
      criteria: { billing: "billing", technical: "technical", needs_review: "needs review" },
    },
  },
};

export function ProviderTester() {
  const [provider, setProvider] = useState<ProviderConfig>(SAMPLE_PROVIDERS.http);
  const [request, setRequest] = useState<ChoiceRequest>(SAMPLE_REQUEST);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(null);

  const handleProbe = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setResult({ error: (err as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/choice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: {
            providers: [provider],
            routing: {
              default: {
                providerIds: [provider.id],
                maxAttempts: 1,
                circuitFailureThreshold: 5,
                circuitCooldownMs: 60000,
              },
            },
          },
          choiceRequest: request,
        }),
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setResult({ error: (err as Error).message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-6">
        {/* Provider Type Selector */}
        <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
          <h2 className="text-sm font-semibold text-dex-text mb-3">Provider Type</h2>
          <div className="grid grid-cols-4 gap-2">
            {(["http", "typesafe", "cloudflare", "vercel"] as const).map((kind) => (
              <button
                key={kind}
                onClick={() => setProvider(SAMPLE_PROVIDERS[kind])}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                  provider.kind === kind
                    ? "border-dex-accent bg-dex-accent/10 text-dex-text"
                    : "border-dex-border text-dex-muted hover:text-dex-text"
                }`}
              >
                {kind === "http" ? "🌐 HTTP" : kind === "typesafe" ? "🛡️ TypeSafe" : kind === "cloudflare" ? "☁️ CF" : "▲ Vercel"}
              </button>
            ))}
          </div>
        </section>

        {/* Provider Config */}
        <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-dex-text">Provider Config</h2>
            <label className="flex items-center gap-1.5 text-xs text-dex-muted cursor-pointer">
              <input
                type="checkbox"
                checked={provider.useEnv === true}
                onChange={(e) => setProvider({ ...provider, useEnv: e.target.checked })}
                className="accent-dex-accent"
              />
              use env keys
            </label>
          </div>
          <JsonEditor value={provider} onChange={(v) => setProvider(v as ProviderConfig)} height="200px" />
          <div className="mt-2 pt-2 border-t border-dex-border">
            <EnvKeyStatus kind={provider.kind} />
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleProbe}
              disabled={loading}
              className="flex-1 rounded-lg border border-dex-border px-4 py-2 text-xs font-medium text-dex-text hover:bg-dex-bg disabled:opacity-50"
            >
              🔍 Probe Health
            </button>
            <button
              onClick={handleExecute}
              disabled={loading}
              className="flex-1 rounded-lg bg-gradient-to-r from-dex-accent to-dex-accent2 px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              ▶ Execute Choice
            </button>
          </div>
        </section>

        {/* Request */}
        <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
          <h2 className="text-sm font-semibold text-dex-text mb-3">Choice Request</h2>
          <JsonEditor value={request} onChange={(v) => setRequest(v as ChoiceRequest)} height="280px" />
        </section>
      </div>

      {/* Result */}
      <div>
        <div className="rounded-xl border border-dex-border bg-dex-surface p-4 sticky top-24">
          <h2 className="text-sm font-semibold text-dex-text mb-3">Result</h2>
          {loading ? (
            <div className="flex items-center gap-2 text-dex-muted text-sm">
              <div className="h-4 w-4 rounded-full border-2 border-dex-accent border-t-transparent animate-spin" />
              Running…
            </div>
          ) : result ? (
            <pre className="code-block text-dex-text whitespace-pre-wrap [overflow-wrap:anywhere] max-h-[600px] overflow-auto">
              {JSON.stringify(result, null, 2)}
            </pre>
          ) : (
            <p className="text-sm text-dex-muted">Probe a provider or execute a Choice request to see results.</p>
          )}
        </div>
      </div>
    </div>
  );
}

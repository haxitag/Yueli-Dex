"use client";

import { useState } from "react";
import { JsonEditor } from "@/components/JsonEditor";
import { ResponseViewer } from "@/components/ResponseViewer";
import { EnvKeyStatus } from "@/components/EnvKeyStatus";
import type { PlaygroundDexConfig, ProviderConfig } from "@/lib/types";
import type { ChoiceRequest, ChoiceCallOptions } from "@haxitag/yueli-dex";

const DEFAULT_REQUEST: ChoiceRequest = {
  state: "My payment was charged twice and I need a refund.",
  model: "jev-latest",
  questions: {
    handler: {
      type: "choice",
      instructions: "Which team should handle this request?",
      criteria: {
        billing: "Payments, invoices, refunds, and subscriptions",
        technical: "Product bugs, incidents, and integrations",
        needs_review: "Evidence is insufficient or does not fit another option",
      },
    },
  },
};

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  // P2: default to the built-in mock provider so the very first "Execute"
  // succeeds out of the box (the previous localhost:9876 http default always
  // failed for new users with a connection error). Switch kind to
  // "typesafe" / "cloudflare" / "vercel" / "http" once credentials are set.
  { id: "mock-jev", kind: "mock" },
];

const DEFAULT_CONFIG: PlaygroundDexConfig = {
  providers: DEFAULT_PROVIDERS,
  routing: {
    default: {
      providerIds: ["mock-jev"],
      maxAttempts: 2,
      circuitFailureThreshold: 3,
      circuitCooldownMs: 60000,
      retryableStatusCodes: [429, 500, 502, 503, 504],
    },
  },
};

export function ChoiceDebugger() {
  const [config, setConfig] = useState<PlaygroundDexConfig>(DEFAULT_CONFIG);
  const [request, setRequest] = useState<ChoiceRequest>(DEFAULT_REQUEST);
  const [options, setOptions] = useState<ChoiceCallOptions>({});
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    response?: unknown;
    receipt?: unknown;
    credentials?: Array<{
      providerId: string;
      kind: string;
      source: string;
      keyIndex: number;
      totalKeys: number;
      masked?: string;
    }>;
    error?: { code: string; message: string; providerId?: string; recoveryHint?: string };
    durationMs?: number;
  } | null>(null);

  const handleRun = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/choice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, choiceRequest: request, options }),
      });
      const data = (await res.json()) as typeof result;
      setResult(data);
    } catch (err) {
      setResult({ error: { code: "NETWORK", message: (err as Error).message } });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: Config + Request */}
      <div className="space-y-6">
        {/* Provider Config */}
        <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-dex-text">Provider Config</h2>
            <span className="text-xs text-dex-muted">{config.providers.length} provider(s)</span>
          </div>
          <JsonEditor value={config} onChange={(v) => setConfig(v as PlaygroundDexConfig)} height="180px" />
          <div className="mt-2 pt-2 border-t border-dex-border flex flex-wrap gap-x-6 gap-y-2">
            {config.providers.map((p) => (
              <div key={p.id} className="flex items-center gap-2">
                <span className="text-xs text-dex-muted">{p.id}</span>
                <EnvKeyStatus kind={p.kind} />
              </div>
            ))}
          </div>
        </section>

        {/* Choice Request */}
        <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-dex-text">Choice Request</h2>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="route (optional)"
                value={options.route ?? ""}
                onChange={(e) => setOptions({ ...options, route: e.target.value || undefined })}
                className="rounded border border-dex-border bg-dex-bg px-2 py-1 text-xs text-dex-text w-28 focus:border-dex-accent focus:outline-none"
              />
              <input
                type="number"
                placeholder="deadlineMs"
                value={options.deadlineMs ?? ""}
                onChange={(e) => setOptions({ ...options, deadlineMs: e.target.value ? Number(e.target.value) : undefined })}
                className="rounded border border-dex-border bg-dex-bg px-2 py-1 text-xs text-dex-text w-24 focus:border-dex-accent focus:outline-none"
              />
            </div>
          </div>
          <JsonEditor value={request} onChange={(v) => setRequest(v as ChoiceRequest)} height="320px" />
        </section>

        <button
          onClick={handleRun}
          disabled={loading}
          className="w-full rounded-lg bg-gradient-to-r from-dex-accent to-dex-accent2 px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Executing…" : "▶ Execute Choice Decision"}
        </button>
      </div>

      {/* Right: Response + Receipt */}
      <div className="space-y-6">
        <ResponseViewer result={result} loading={loading} />
      </div>
    </div>
  );
}

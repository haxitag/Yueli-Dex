"use client";

import { useState } from "react";
import { JsonEditor } from "@/components/JsonEditor";
import type { ChoiceRequest, ChoiceResponse } from "@haxitag/yueli-dex";

const SAMPLE_TEMPLATE = {
  apiVersion: "yueli-dex-template/v1",
  id: "support-triage",
  version: "1.0.0",
  state: { from: { message: "$.message", accountPlan: "$.account.plan" } },
  choices: [
    {
      id: "handler",
      instructions: "Which team should own this request?",
      criteria: {
        billing: "Payments, invoices, refunds, and subscriptions",
        technical: "Product bugs, incidents, and integrations",
        needs_review: "Evidence is insufficient or spans multiple teams",
      },
    },
  ],
  constraints: { requireFallbackOption: "needs_review", maxOptions: 12 },
  actions: {
    handler: {
      billing: { kind: "queue.assign", queue: "billing" },
      technical: { kind: "queue.assign", queue: "technical" },
      needs_review: { kind: "review.request" },
    },
  },
};

const SAMPLE_INPUT = { message: "I was charged twice.", account: { plan: "pro" } };

const SAMPLE_RESPONSE: ChoiceResponse = {
  model: "jev-1.0.0",
  answers: {
    handler: {
      type: "choice",
      choice: "billing",
      confidence: 0.9,
      probabilities: { billing: 0.9, technical: 0.05, needs_review: 0.05 },
    },
  },
};

export function TemplateTester() {
  const [template, setTemplate] = useState(SAMPLE_TEMPLATE);
  const [input, setInput] = useState(SAMPLE_INPUT);
  const [response, setResponse] = useState<ChoiceResponse>(SAMPLE_RESPONSE);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(null);

  const handlePrepare = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template, input, action: "prepare" }),
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setResult({ error: (err as Error).message });
    } finally {
      setLoading(false);
    }
  };

  const handleIntent = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template, action: "intent", request: null, response }),
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
        <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
          <h2 className="text-sm font-semibold text-dex-text mb-3">Template Definition</h2>
          <JsonEditor value={template} onChange={setTemplate} height="340px" />
        </section>
        <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
          <h2 className="text-sm font-semibold text-dex-text mb-3">Input Data</h2>
          <JsonEditor value={input} onChange={setInput} height="120px" />
        </section>
        <div className="flex gap-2">
          <button
            onClick={handlePrepare}
            disabled={loading}
            className="flex-1 rounded-lg bg-gradient-to-r from-dex-accent to-dex-accent2 px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            ▶ Compile → ChoiceRequest
          </button>
        </div>
      </div>

      <div className="space-y-6">
        <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
          <h2 className="text-sm font-semibold text-dex-text mb-3">Simulated Response (for ActionIntent)</h2>
          <JsonEditor value={response} onChange={(v) => setResponse(v as ChoiceResponse)} height="220px" />
          <button
            onClick={handleIntent}
            disabled={loading}
            className="mt-3 w-full rounded-lg border border-dex-border px-4 py-2 text-xs font-medium text-dex-text hover:bg-dex-bg disabled:opacity-50"
          >
            🎯 Map → ActionIntent
          </button>
        </section>

        <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
          <h2 className="text-sm font-semibold text-dex-text mb-3">Result</h2>
          {loading ? (
            <p className="text-sm text-dex-muted">Processing…</p>
          ) : result ? (
            <pre className="code-block text-dex-text whitespace-pre-wrap break-all max-h-[400px] overflow-auto">
              {JSON.stringify(result, null, 2)}
            </pre>
          ) : (
            <p className="text-sm text-dex-muted">Compile the template or map action intents to see results.</p>
          )}
        </section>
      </div>
    </div>
  );
}

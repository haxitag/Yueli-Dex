"use client";

import { useState } from "react";
import { JsonEditor } from "@/components/JsonEditor";

const SAMPLE_RULESET = {
  apiVersion: "yueli-dex-rules/v1",
  rules: [
    {
      id: "regulated-route",
      when: { path: "$.input.tenantTier", op: "equals", value: "regulated" },
      then: { kind: "route", route: "regulated-primary" },
    },
    {
      id: "require-fallback",
      when: { path: "$.compiled.questions.handler.criteria.needs_review", op: "exists" },
      then: { kind: "constrain", requireFallbackOption: "needs_review" },
    },
    {
      id: "empty-reject",
      when: { path: "$.input.message", op: "equals", value: "" },
      then: { kind: "reject", message: "Message cannot be empty" },
    },
    {
      id: "refund-shortcircuit",
      when: { path: "$.input.message", op: "equals", value: "refund" },
      then: { kind: "shortCircuit", questionId: "handler", choice: "billing" },
    },
  ],
};

const SAMPLE_INPUT = { message: "I need a refund", tenantTier: "regulated" };

const SAMPLE_COMPILED = {
  state: "test",
  questions: {
    handler: {
      type: "choice",
      instructions: "Which team?",
      criteria: { billing: "b", technical: "t", needs_review: "nr" },
    },
  },
};

export function RuleTester() {
  const [ruleSet, setRuleSet] = useState(SAMPLE_RULESET);
  const [input, setInput] = useState(SAMPLE_INPUT);
  const [compiled, setCompiled] = useState(SAMPLE_COMPILED);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(null);

  const handleEvaluate = async (phase: "pre" | "post") => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/rule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ruleSet: {
            id: "playground-rules",
            version: "1.0.0",
            scope: "organization",
            document: ruleSet,
          },
          input,
          compiledRequest: compiled,
          phase,
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
        <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
          <h2 className="text-sm font-semibold text-dex-text mb-3">Rule Document</h2>
          <JsonEditor value={ruleSet} onChange={(v) => setRuleSet(v as typeof ruleSet)} height="360px" />
        </section>
        <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
          <h2 className="text-sm font-semibold text-dex-text mb-3">Input ($.input)</h2>
          <JsonEditor value={input} onChange={(v) => setInput(v as typeof input)} height="100px" />
        </section>
        <section className="rounded-xl border border-dex-border bg-dex-surface p-4">
          <h2 className="text-sm font-semibold text-dex-text mb-3">Compiled Request ($.compiled)</h2>
          <JsonEditor value={compiled} onChange={(v) => setCompiled(v as typeof compiled)} height="160px" />
        </section>
        <div className="flex gap-2">
          <button
            onClick={() => handleEvaluate("pre")}
            disabled={loading}
            className="flex-1 rounded-lg bg-gradient-to-r from-dex-accent to-dex-accent2 px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            ▶ Evaluate Pre-Routing
          </button>
        </div>
      </div>

      <div>
        <div className="rounded-xl border border-dex-border bg-dex-surface p-4 sticky top-24">
          <h2 className="text-sm font-semibold text-dex-text mb-3">Evaluation Result</h2>
          {loading ? (
            <p className="text-sm text-dex-muted">Evaluating rules…</p>
          ) : result ? (
            <pre className="code-block text-dex-text whitespace-pre-wrap [overflow-wrap:anywhere] max-h-[600px] overflow-auto">
              {JSON.stringify(result, null, 2)}
            </pre>
          ) : (
            <div className="space-y-2 text-sm text-dex-muted">
              <p>Supported actions:</p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li><code className="text-dex-accent">reject</code> — block the request</li>
                <li><code className="text-dex-accent">constrain</code> — enforce fallback / limits</li>
                <li><code className="text-dex-accent">route</code> — force a named route</li>
                <li><code className="text-dex-accent">shortCircuit</code> — return a synthetic Choice</li>
              </ul>
              <p className="text-xs mt-3">Operators: exists, equals, in, lt, lte, gt, gte. Use all/any/not for compound conditions.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

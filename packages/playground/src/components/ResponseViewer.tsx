"use client";

import { useState } from "react";

interface ResponseViewerProps {
  result: {
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
  } | null;
  loading: boolean;
}

type View = "response" | "receipt" | "credentials" | "error";

export function ResponseViewer({ result, loading }: ResponseViewerProps) {
  const [view, setView] = useState<View>("response");

  if (loading) {
    return (
      <div className="rounded-xl border border-dex-border bg-dex-surface p-8 flex flex-col items-center justify-center text-dex-muted">
        <div className="h-8 w-8 rounded-full border-2 border-dex-accent border-t-transparent animate-spin mb-3" />
        <p className="text-sm">Executing decision…</p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="rounded-xl border border-dex-border bg-dex-surface p-8 flex flex-col items-center justify-center text-dex-muted">
        <div className="text-4xl mb-3">🎯</div>
        <p className="text-sm">Configure providers, build a Choice request, and execute.</p>
        <p className="text-xs mt-1">The response, audit receipt, and any errors will appear here.</p>
      </div>
    );
  }

  const hasError = !!result.error;
  const hasResponse = !!result.response;
  const hasReceipt = !!result.receipt;
  const hasCredentials = !!result.credentials && result.credentials.length > 0;

  return (
    <div className="rounded-xl border border-dex-border bg-dex-surface overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-dex-border">
        <button
          onClick={() => setView("response")}
          className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
            view === "response" ? "border-dex-accent text-dex-text" : "border-transparent text-dex-muted hover:text-dex-text"
          }`}
        >
          Response {hasResponse && <span className="ml-1 text-dex-success">●</span>}
        </button>
        <button
          onClick={() => setView("receipt")}
          className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
            view === "receipt" ? "border-dex-accent text-dex-text" : "border-transparent text-dex-muted hover:text-dex-text"
          }`}
        >
          Receipt {hasReceipt && <span className="ml-1 text-dex-accent">●</span>}
        </button>
        {hasCredentials && (
          <button
            onClick={() => setView("credentials")}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              view === "credentials" ? "border-dex-accent text-dex-text" : "border-transparent text-dex-muted hover:text-dex-text"
            }`}
          >
            Credentials <span className="ml-1 text-dex-success">●</span>
          </button>
        )}
        {hasError && (
          <button
            onClick={() => setView("error")}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              view === "error" ? "border-dex-danger text-dex-danger" : "border-transparent text-dex-muted hover:text-dex-danger"
            }`}
          >
            Error <span className="ml-1 text-dex-danger">●</span>
          </button>
        )}
        {result.durationMs !== undefined && (
          <span className="ml-auto px-4 py-2.5 text-xs text-dex-muted">
            {result.durationMs}ms
          </span>
        )}
      </div>

      {/* Content */}
      <div className="p-4 max-h-[600px] overflow-auto">
        {view === "response" && (
          result.response ? (
            <pre className="code-block text-dex-text whitespace-pre-wrap [overflow-wrap:anywhere]">
              {JSON.stringify(result.response, null, 2)}
            </pre>
          ) : (
            <p className="text-sm text-dex-muted">No response returned.</p>
          )
        )}
        {view === "receipt" && (
          result.receipt ? (
            <pre className="code-block text-dex-text whitespace-pre-wrap [overflow-wrap:anywhere]">
              {JSON.stringify(result.receipt, null, 2)}
            </pre>
          ) : (
            <p className="text-sm text-dex-muted">No receipt available.</p>
          )
        )}
        {view === "credentials" && hasCredentials && (
          <div className="space-y-3">
            {result.credentials!.map((c) => (
              <div key={c.providerId} className="rounded-lg border border-dex-border bg-dex-bg p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-dex-text">{c.providerId}</span>
                  <span className="text-xs text-dex-muted">{c.kind}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-dex-muted">source:</span>{" "}
                    <span className={`font-mono ${c.source === "none" ? "text-dex-danger" : "text-dex-accent"}`}>{c.source}</span>
                  </div>
                  <div>
                    <span className="text-dex-muted">key:</span>{" "}
                    <span className="font-mono text-dex-text">
                      {c.totalKeys > 0 ? `#${c.keyIndex + 1}/${c.totalKeys}` : "none"}
                    </span>
                  </div>
                  {c.masked && (
                    <div className="col-span-2">
                      <span className="text-dex-muted">masked:</span>{" "}
                      <span className="font-mono text-dex-text">{c.masked}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {view === "error" && result.error && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="rounded bg-dex-danger/20 px-2 py-0.5 text-xs font-mono text-dex-danger border border-dex-danger/30">
                {result.error.code}
              </span>
              {result.error.providerId && (
                <span className="rounded bg-dex-surface px-2 py-0.5 text-xs font-mono text-dex-muted border border-dex-border">
                  {result.error.providerId}
                </span>
              )}
            </div>
            <p className="text-sm text-dex-text">{result.error.message}</p>
            {result.error.recoveryHint && (
              <div className="rounded-lg border border-dex-warning/30 bg-dex-warning/10 p-3">
                <p className="text-xs text-dex-warning">💡 {result.error.recoveryHint}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

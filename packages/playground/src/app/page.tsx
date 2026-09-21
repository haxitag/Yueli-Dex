"use client";

import { useState } from "react";
import { ChoiceDebugger } from "@/components/ChoiceDebugger";
import { ProviderTester } from "@/components/ProviderTester";
import { TemplateTester } from "@/components/TemplateTester";
import { RuleTester } from "@/components/RuleTester";

type Tab = "choice" | "provider" | "template" | "rule";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "choice", label: "Choice Debugger", icon: "🎯" },
  { id: "provider", label: "Provider Tester", icon: "🔌" },
  { id: "template", label: "Template Tester", icon: "📋" },
  { id: "rule", label: "Rule Tester", icon: "⚖️" },
];

export default function PlaygroundPage() {
  const [tab, setTab] = useState<Tab>("choice");

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-dex-border bg-dex-bg/90 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-dex-accent to-dex-accent2 flex items-center justify-center text-white font-bold text-sm">
              Y
            </div>
            <div>
              <h1 className="text-lg font-semibold text-dex-text">Yueli DEX Playground</h1>
              <p className="text-xs text-dex-muted">Decision Execution Framework — Debug &amp; Test</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-dex-border bg-dex-surface px-3 py-1 text-xs text-dex-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-dex-success" />
              jev-choice/v1
            </span>
          </div>
        </div>
        {/* Tabs */}
        <div className="mx-auto max-w-7xl px-4">
          <nav className="flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.id
                    ? "border-dex-accent text-dex-text"
                    : "border-transparent text-dex-muted hover:text-dex-text"
                }`}
              >
                <span className="mr-1.5">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-7xl px-4 py-6">
        {tab === "choice" && <ChoiceDebugger />}
        {tab === "provider" && <ProviderTester />}
        {tab === "template" && <TemplateTester />}
        {tab === "rule" && <RuleTester />}
      </main>
    </div>
  );
}

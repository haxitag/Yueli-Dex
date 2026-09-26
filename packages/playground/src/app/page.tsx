"use client";

import { useState } from "react";
import { ChoiceDebugger } from "@/components/ChoiceDebugger";
import { ProviderTester } from "@/components/ProviderTester";
import { TemplateTester } from "@/components/TemplateTester";
import { RuleTester } from "@/components/RuleTester";
import { TieredDecision } from "@/components/TieredDecision";
import { I18nProvider, useI18n } from "@/components/I18nProvider";
import { LanguageToggle } from "@/components/LanguageToggle";

type Tab = "tiers" | "choice" | "provider" | "template" | "rule";

function PlaygroundBody() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("tiers");

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "tiers", label: t("tab.tiers"), icon: "🏛" },
    { id: "choice", label: t("tab.choice"), icon: "🎯" },
    { id: "provider", label: t("tab.provider"), icon: "🔌" },
    { id: "template", label: t("tab.template"), icon: "📋" },
    { id: "rule", label: t("tab.rule"), icon: "⚖️" },
  ];

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
              <h1 className="text-lg font-semibold text-dex-text">{t("header.title")}</h1>
              <p className="text-xs text-dex-muted">{t("header.subtitle")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-dex-border bg-dex-surface px-3 py-1 text-xs text-dex-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-dex-success" />
              {t("header.statusBadge")}
            </span>
            <LanguageToggle />
          </div>
        </div>
        {/* Tabs */}
        <div className="mx-auto max-w-7xl px-4">
          <nav className="flex gap-1">
            {tabs.map((t_) => (
              <button
                key={t_.id}
                onClick={() => setTab(t_.id)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === t_.id
                    ? "border-dex-accent text-dex-text"
                    : "border-transparent text-dex-muted hover:text-dex-text"
                }`}
              >
                <span className="mr-1.5">{t_.icon}</span>
                {t_.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-7xl px-4 py-6">
        {tab === "tiers" && <TieredDecision />}
        {tab === "choice" && <ChoiceDebugger />}
        {tab === "provider" && <ProviderTester />}
        {tab === "template" && <TemplateTester />}
        {tab === "rule" && <RuleTester />}
      </main>
    </div>
  );
}

export default function PlaygroundPage() {
  return (
    <I18nProvider>
      <PlaygroundBody />
    </I18nProvider>
  );
}
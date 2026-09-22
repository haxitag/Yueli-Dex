"use client";

import { useI18n, SUPPORTED_LOCALES } from "@/components/I18nProvider";
import type { Locale } from "@/lib/i18n";

const LOCALE_LABEL: Record<Locale, string> = {
  zh: "中文",
  en: "English",
};

export function LanguageToggle() {
  const { locale, setLocale } = useI18n();
  return (
    <div
      role="group"
      aria-label="Language"
      className="inline-flex items-center rounded-full border border-dex-border bg-dex-surface p-0.5 text-xs"
    >
      {SUPPORTED_LOCALES.map((l) => {
        const active = l === locale;
        return (
          <button
            key={l}
            type="button"
            onClick={() => setLocale(l)}
            aria-pressed={active}
            className={`rounded-full px-2.5 py-1 transition-colors ${
              active
                ? "bg-dex-accent text-white shadow"
                : "text-dex-muted hover:text-dex-text"
            }`}
          >
            {LOCALE_LABEL[l]}
          </button>
        );
      })}
    </div>
  );
}
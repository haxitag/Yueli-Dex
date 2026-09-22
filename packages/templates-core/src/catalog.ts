import { TEMPLATES } from "./templates.js";
import type { TemplateCatalogEntry, TemplateFilter, ThemeLabel } from "./types.js";

export const THEME_LABELS: readonly ThemeLabel[] = [
  "customer-operations",
  "communication",
  "agent-infrastructure",
  "developer-tooling",
  "security",
  "automation",
];

/**
 * Four-dimension catalog (主题 / 场景 / 用例 / 效用), one entry per template.
 */
export const CATALOG: readonly TemplateCatalogEntry[] = TEMPLATES.map((t) => ({
  id: t.id,
  version: t.version,
  theme: t.meta.theme,
  scenario: t.meta.scenario,
  useCase: t.meta.useCase,
  utility: t.meta.utility,
  references: t.meta.references,
}));

/**
 * Look up catalog entries by the four dimensions. `theme` matches exactly;
 * `scenario`, `useCase`, and `utility` match case-insensitive substrings.
 */
export function findTemplates(
  filter: TemplateFilter = {},
): readonly TemplateCatalogEntry[] {
  const scenario = filter.scenario?.toLowerCase();
  const useCase = filter.useCase?.toLowerCase();
  const utility = filter.utility?.toLowerCase();
  return CATALOG.filter(
    (entry) =>
      (filter.theme === undefined || entry.theme === filter.theme) &&
      (scenario === undefined || entry.scenario.toLowerCase().includes(scenario)) &&
      (useCase === undefined || entry.useCase.toLowerCase().includes(useCase)) &&
      (utility === undefined || entry.utility.toLowerCase().includes(utility)),
  );
}

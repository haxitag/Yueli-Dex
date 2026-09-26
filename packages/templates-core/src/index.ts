/**
 * @haxitag/yueli-dex-templates-core
 *
 * Base template pack for Yueli DEX. Ten curated `yueli-dex-template/v1`
 * scenario templates, each labeled on four dimensions:
 * 主题 (theme) / 场景 (scenario) / 用例 (use case) / 效用 (utility).
 *
 * Usage:
 * ```ts
 * import { createDex } from "@haxitag/yueli-dex";
 * import { TEMPLATES_CORE_PACK, findTemplates } from "@haxitag/yueli-dex-templates-core";
 *
 * const matches = findTemplates({ theme: "agent-infrastructure", scenario: "context" });
 * const dex = createDex({ providers, routing, templates: [TEMPLATES_CORE_PACK] });
 * ```
 */

export { TEMPLATES, TEMPLATES_CORE_PACK } from "./templates.js";
export {
  CATALOG,
  THEME_LABELS,
  SCENARIO_DIRECTIONS,
  findTemplates,
  findDirectionTemplates,
} from "./catalog.js";
export type { ScenarioDirection } from "./catalog.js";
export { LOCAL_RULE_SETS, getLocalRuleSets } from "./rules.js";
export { buildAllCallExamples, buildCallExample } from "./examples.js";
export type {
  TemplateCatalogEntry,
  TemplateDefinition,
  TemplateFilter,
  TemplateLabels,
  ThemeLabel,
} from "./types.js";

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
  // P2-1: surface fixture count so the CLI / playground can show coverage.
  ...(t.examples?.fixtures
    ? { fixtureCount: t.examples.fixtures.length }
    : {}),
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

/**
 * The industry's eight-direction taxonomy of Jev-class model use cases,
 * distilled from 28 real application cases. Surfaced so that catalog
 * tooling, the playground, and agent skills can speak the same vocabulary
 * as industry users (中英对照).
 */
export type ScenarioDirection = {
  readonly id: string;
  /** 中文方向名，对齐行业用户认知用语 */
  readonly zh: string;
  /** English direction name */
  readonly en: string;
  readonly description: string;
  /** Whether this direction is expected to scale first (industry consensus). */
  readonly scalesFirst: boolean;
  readonly themes: readonly ThemeLabel[];
  /** scenario slugs in CATALOG that instantiate this direction. */
  readonly scenarioKeywords: readonly string[];
};

export const SCENARIO_DIRECTIONS: readonly ScenarioDirection[] = [
  {
    id: "agent-dispatch",
    zh: "Agent 调度",
    en: "Agent dispatch",
    description:
      "选择模型、工具和 Skill；判断任务该直接处理、交给更强的模型，还是转人工。价值在于减少无效调用和等待。",
    scalesFirst: true,
    themes: ["agent-infrastructure"],
    scenarioKeywords: ["tool-routing", "loop-decision", "llm-routing", "agent-dispatch"],
  },
  {
    id: "memory-context",
    zh: "记忆与上下文管理",
    en: "Memory & context management",
    description:
      "筛选历史记录、重排检索结果、判断哪些材料适合当前任务。Agent 记得越多，越需要区分「内容相似」和「此刻适用」。",
    scalesFirst: true,
    themes: ["agent-infrastructure"],
    scenarioKeywords: ["context-gc", "context-chunk-sieve", "memory-recall-gating"],
  },
  {
    id: "code-quality",
    zh: "代码与软件质量检查",
    en: "Code & software quality",
    description:
      "PR 审查、代码评分、QA 测试。更实用的形态是找出值得追加检查的地方，再让测试、编码模型和人类确认问题。",
    scalesFirst: true,
    themes: ["developer-tooling"],
    scenarioKeywords: ["pr-review", "claim-verification", "qa-check-targeting"],
  },
  {
    id: "computer-use",
    zh: "浏览器与电脑操作",
    en: "Browser & computer use",
    description:
      "Browser Use、iOS 模拟器、鼠标绘图。把当前状态转成有限的动作候选，再选择下一步；整体效果依赖感知、规划和执行组件。",
    scalesFirst: false,
    themes: ["automation"],
    scenarioKeywords: ["browser-control", "real-time-control"],
  },
  {
    id: "ops-triage",
    zh: "业务分流与内容审核",
    en: "Business triage & moderation",
    description:
      "客服工单、用户意图识别、社区审核、人工复核排序。调用频繁、流程明确、结果容易检查——商业落地最扎实的方向。",
    scalesFirst: true,
    themes: ["customer-operations", "security", "communication"],
    scenarioKeywords: [
      "ticket-routing",
      "inbox-routing",
      "content-filter",
      "review-queue-priority",
    ],
  },
  {
    id: "data-processing",
    zh: "搜索与数据处理",
    en: "Search & data processing",
    description:
      "自然语言筛选、实体匹配、图提取、SQL 条件扩展。适合很难穷举成关键词规则、却能通过具体案例说明的条件。",
    scalesFirst: false,
    themes: ["developer-tooling", "automation"],
    scenarioKeywords: ["structured-extract", "graph-hop", "nl-record-filter", "paper-screening"],
  },
  {
    id: "realtime-assist",
    zh: "实时交互辅助",
    en: "Realtime interactive assistance",
    description:
      "会议观察、即时建议、自动补全、预测启动器、Emoji 候选。核心是判断「现在需要提供什么帮助」，产品成败取决于误打扰率。",
    scalesFirst: false,
    themes: ["communication"],
    scenarioKeywords: ["proactive-assist"],
  },
  {
    id: "game-control",
    zh: "游戏与复杂控制实验",
    en: "Games & complex control",
    description:
      "Minecraft、自动驾驶、交易相关演示。展示了探索空间，但演示成功距离长期可靠运行还有很长的验证过程。",
    scalesFirst: false,
    themes: ["automation"],
    scenarioKeywords: ["real-time-control"],
  },
];

/**
 * List catalog entries that instantiate a given industry direction.
 * Unknown direction ids return an empty list.
 */
export function findDirectionTemplates(
  directionId: string,
): readonly TemplateCatalogEntry[] {
  const direction = SCENARIO_DIRECTIONS.find((d) => d.id === directionId);
  if (!direction) return [];
  const keywords = direction.scenarioKeywords.map((k) => k.toLowerCase());
  return CATALOG.filter((entry) => keywords.includes(entry.scenario.toLowerCase()));
}

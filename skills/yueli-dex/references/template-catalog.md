# Template Catalog — 四维度标签体系

Every template in `@haxitag/yueli-dex-templates-core` is labeled on four
dimensions, chosen by cross-analyzing the Jev ecosystem aggregators
(awesomejev.com: 802 entries; awesome-jev-projects: 448 verified repos,
17 architecture categories, 20 topic tags) and TypeSafe's own docs:

| 维度 | 含义 | 取值方式 |
| --- | --- | --- |
| **主题 theme** | 决策所属的业务领域 | 受控词汇表（见下） |
| **场景 scenario** | 决策发生的具体情境 | 短语 slug（如 `ticket-routing`） |
| **用例 useCase** | 调用方要求这个决策做什么 | 一句话动宾描述 |
| **效用 utility** | 它替代/改进了什么，证据是什么 | 一句话 + 参考项目 |

Theme vocabulary: `customer-operations`, `communication`,
`agent-infrastructure`, `developer-tooling`, `security`, `automation`.

## Industry directions（行业八方向分类）

The catalog also speaks the industry's eight-direction taxonomy of Jev-class
model use cases (distilled from 28 real application cases). Use
`findDirectionTemplates(directionId)` or `SCENARIO_DIRECTIONS` to browse in
this vocabulary:

| direction id | 中文 | 说明 | 预期先行规模化 |
| --- | --- | --- | --- |
| `agent-dispatch` | Agent 调度 | 选择模型/工具/Skill；直接处理 vs 更强模型 vs 转人工 | ✅ |
| `memory-context` | 记忆与上下文管理 | 筛选历史、重排检索；区分「内容相似」与「此刻适用」 | ✅ |
| `code-quality` | 代码与软件质量检查 | PR 审查/QA；找出值得追加检查的地方再确认 | ✅ |
| `computer-use` | 浏览器与电脑操作 | 有限动作候选中选下一步 | |
| `ops-triage` | 业务分流与内容审核 | 工单/意图/审核/人工复核排序——商业落地最扎实 | ✅ |
| `data-processing` | 搜索与数据处理 | 难穷举成规则、可举例说明的筛选与匹配 | |
| `realtime-assist` | 实时交互辅助 | 判断「现在需要提供什么帮助」；成败在误打扰率 | |
| `game-control` | 游戏与复杂控制实验 | 封闭动作空间 + 风险评级；长期可靠性待验证 | |

The four directions marked ✅ share: **判断高频发生、候选范围有限、需要
理解语境、错误可被发现和补救** — the profile where a Jev-class decision
pays for itself first.

A note on context (later Wittgenstein): the same word — 「紧急」/「urgent」 —
maps to different handling in support, meetings, and code incidents. A good
template therefore states the business it lives in, what counts as urgent
*there* (criteria are examples, not thresholds), and which action each
judgment triggers.

## Catalog

| id | 主题 | 场景 | 用例 | 效用 |
| --- | --- | --- | --- | --- |
| `support-triage` | customer-operations | ticket-routing | 工单路由到负责团队并定优先级 | 替代关键词/正则路由；needs_review 兜底防静默误派 |
| `email-triage` | communication | inbox-routing | 邮件分类并打标签 | ~$0.03/千封的批量分拣，替代人工归档与有损摘要 |
| `agent-tool-selection` | agent-infrastructure | tool-routing | 为 Agent 下一步选工具 | 工具选择从 prompt 工程移入类型化决策；建模槽位可扩至 255 工具 |
| `agent-loop-control` | agent-infrastructure | loop-decision | 循环继续/重试/停止/升级 | 用校准置信度替代步数启发式，防死循环与过早放弃 |
| `context-compaction` | agent-infrastructure | context-gc | 逐项判定保留/截断/丢弃 | 替代有损摘要压缩；保留内容逐字零失真（fast-jev-compaction ~6k stars） |
| `security-gate` | security | tool-call-approval | 命令/工具调用前放行/确认/拦截 | Prompt 注入与危险命令防御；按动作风险设阈值（只读≥0.7 / 破坏性≥0.9） |
| `content-moderation` | security | content-filter | UGC 实时审核 | <500ms 决策支持时间线清理与扩展级过滤 |
| `model-routing` | agent-infrastructure | llm-routing | 按复杂度选模型档位 | 易流量走小模型降本；双阈值歧义时回落安全档 |
| `browser-action` | automation | browser-control | 选下一个浏览器动作与元素目标 | ~300ms 决策使语音/实时代理可行；选择索引元素杜绝幻觉坐标 |
| `code-review-gate` | developer-tooling | pr-review | PR 门禁：通过/修改/补测试 | 编码代理可审计 CI 门禁；最大 Jev 类目（166 项）验证需求 |
| `chunk-triage` | agent-infrastructure | context-chunk-sieve | 对上下文分块裁决：原文保留/摘要/隐藏 | Winnow / fast-jev-compaction 模式；错误输出等确定性内容本地短路 keep_verbatim |
| `claim-verify` | communication | claim-verification | 对断言核验：verified/contradicted/unsupported | jev-mcp `jev_verify` 模式；缺证据本地短路 unsupported |
| `realtime-action` | automation | real-time-control | 每 tick 从封闭动作空间选动作并评级风险 | typesafe-mario / OneVOneJev / jev-trader / jev-drone 模式；代码管安全与时机，Jev 管战术 |
| `graph-traverse` | developer-tooling | graph-hop | 每个节点选下一个结构移动：dive/branch/stay/backtrack | Blink / neo4jev / agent-desktop 模式；深度预算与已找到目标走本地短路 |
| `extract-field` | developer-tooling | structured-extract | 从 ≤4 个预筛候选中选匹配项或 not_found | jev-mcp `jev_extract` / jev-curate 模式；抽取值逐字保留，永不改写 |
| `startup-pitch` | agent-infrastructure | idea-evaluation | 对创业想法裁决：kill/fix/ship | killmyidea 模式；信息不足走 needs_review 而非硬猜 |
| `agent-handoff` | agent-infrastructure | agent-dispatch | 任务处理路径：直接处理/升级更强模型/转人工 | 减少无效调用与等待；同一「紧急」在不同业务对应不同处置，criteria 承载业务自身示例 |
| `memory-recall` | agent-infrastructure | memory-recall-gating | 逐条记忆裁决：recall/skip | 区分「内容相似」与「此刻适用」；替代 k 近邻堆砌上下文 |
| `qa-check-targeting` | developer-tooling | qa-check-targeting | 逐文件裁决是否值得追加检查 | 让检查预算与风险成比例；测试/编码模型和人类只确认被标记处 |
| `review-queue` | customer-operations | review-queue-priority | 人工复核队列排序：深度 × 时机 | 稀缺审阅时间落在错误代价最高处；商业落地最扎实方向的收口环节 |
| `record-filter` | automation | nl-record-filter | 按自然语言规则逐条筛选记录 | 处理难穷举成关键词、可举例说明的条件；入选记录原样透传 |
| `arxiv-benchmark-screen` | automation | paper-screening | 从标题+摘要判断论文是否为 benchmark/评测类并归类子类型 | 单一 4+1 判决消除布尔/子类型标签矛盾；needs_review 兜底保证标注集干净；每条决策直接落 JSONL 训练样本 |
| `proactive-assist` | communication | proactive-assist | 逐时刻裁决：现在提示/保持沉默/仅记录 | 产品成败取决于误打扰率；默认沉默，打扰必须自己挣得时机 |

Each template's `meta.references` records the ecosystem evidence (source
projects / aggregator categories) that validates demand.

## Six decision patterns（六种正交决策模式）

Cross-analyzing 20 real-world Jev projects collapses into six orthogonal
decision patterns. Every catalog template instantiates one of them:

| 模式 | 判决形状 | 何时短路到本地规则 |
| --- | --- | --- |
| **① 分块分诊** chunk triage | 每块一个处置判决 | 内容可确定性判断（错误输出、日志尾部） |
| **② 断言核验** claim verification | 断言 × 证据 → 三态判决 | 证据缺失 → `unsupported` |
| **③ 实时动作** realtime action | 封闭动作空间 + 风险评级 | 物理不可行动状态（空中遇险 → `defend`） |
| **④ 图遍历** graph traversal | 每节点一个结构移动 | 预算耗尽 / 目标已找到 |
| **⑤ 结构化抽取** structured extract | 候选匹配，逐字输出 | 无候选 → `not_found` |
| **⑥ 多维评分** multi-dim scoring | kill / fix / ship | 输入过短不足以评分 → `needs_review` |

Patterns ①-⑥ share two invariants: a `needs_review` fallback in every
choice, and actions emitted as `ActionIntent` requests (never executions).

## How to pick a template

```ts
import { findTemplates, findDirectionTemplates } from "@haxitag/yueli-dex-templates-core";

findTemplates({ theme: "security" });                    // → security-gate, content-moderation
findTemplates({ scenario: "routing" });                  // → support-triage, email-triage, model-routing, …
findTemplates({ utility: "verbatim" });                  // → context-compaction, chunk-triage, extract-field
findDirectionTemplates("realtime-assist");               // → proactive-assist
findDirectionTemplates("ops-triage");                    // → support-triage, email-triage, content-moderation, review-queue
```

Pick by scenario first; fall back to theme; read `utility` to confirm the
replacement story matches your goal. If nothing fits within ~70%, author a
new template — do not force-fit criteria.

## How to author a new template

A `yueli-dex-template/v1` document is data-only, versioned, reviewable:

```ts
{
  apiVersion: "yueli-dex-template/v1",
  id: "refund-review",              // stable, kebab-case
  version: "1.0.0",
  meta: {                           // four-dimension labels + example input
    theme: "customer-operations",
    scenario: "refund-approval",
    useCase: "Decide whether a refund request meets policy",
    utility: "Replaces manual first-pass screening; needs_review keeps edge cases human",
    references: ["your-internal-evidence"],
    exampleInput: { /* … */ },
  },
  state: { from: { message: "$.message", orderTotal: "$.order.total" } },
  choices: [
    {
      id: "verdict",
      instructions: "Should this refund request be approved?",  // ONE judgment
      criteria: {
        approve: "Meets the stated refund policy",
        deny: "Clearly outside policy",
        needs_review: "Edge case or missing evidence",
      },
    },
  ],
  constraints: { requireFallbackOption: "needs_review", maxOptions: 12 },
  actions: {
    verdict: {
      approve: { kind: "refund.stage", stage: "auto-approved" },
      deny:     { kind: "refund.stage", stage: "denied" },
      needs_review: { kind: "review.request" },
    },
  },
}
```

Rules:

- `state.from` maps JSON paths (`$.a.b[0]`) from your input to focused state.
  With no mapping, the whole input becomes the state.
- `actions` map choices to `ActionIntent` data (`kind` + params). They are
  auditable intents, never executions.
- `constraints.requireFallbackOption` must appear in **every** choice's
  criteria; `allowedActionKinds` filters which intents can ever be emitted.
- `modeling.mode: "optional"` with `allow.addCriteria: true` opens a bounded
  slot for dynamic candidate options (e.g. per-page element ids, per-repo
  tool lists); keep it `"off"` for static templates.

Test the pack with `createTemplateRegistry([pack]).prepare({ template: id, input })`
and a fixture response through `toActionIntent()`.

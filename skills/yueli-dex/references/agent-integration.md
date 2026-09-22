# Agent 集成指南 · Integrating yueli-dex into your agent project

把 Jev 类决策（快速、带概率、可审计）植入你的 Agent 框架：LangGraph / OpenAI
Agents SDK / 自研循环 / LangChain / 任何调用大模型的循环体。本指南用**中英双语**
对照展示代码与说明，所有示例可在 `packages/playground` 中端到端复现。

This guide shows how to wire **fast, typed, auditable Choice-class** calls into any
agent framework. Every example is mirrored in English and Chinese, and every
snippet is reproducible end-to-end in `packages/playground`.

---

## 1. 30 秒定位 · 30-second orientation

中文：你的 Agent 在循环中需要做的**所有「选一个 + 给出置信度」的决定**，
都是 yueli-dex 的目标场景：工具选型、循环控制、安全门禁、上下文整理、子 Agent
裁决、内容审核、模型路由……

English: **Every "pick one option with a confidence score" decision inside your
agent loop is a yueli-dex use case** — tool selection, loop control, safety
gating, context compaction, sub-agent arbitration, content moderation, model
routing, and more.

| 你在写什么 / What you're writing                | 适用的模板 / Template to use |
| --- | --- |
| 选工具 / Pick the next tool                    | `agent-tool-selection`        |
| 循环继续/重试/升级 / Loop continue/retry/abort | `agent-loop-control`          |
| 工具调用前放行/拦截 / Gate before tool call     | `security-gate`               |
| 上下文分块处置 / Decide what to keep/drop      | `context-compaction` / `chunk-triage` |
| 内容审核 / Moderate UGC                        | `content-moderation`          |
| 按复杂度选模型 / Route to right model tier     | `model-routing`               |
| 实时控制（游戏/交易/无人机）/ Real-time control | `realtime-action`             |
| 图/树遍历 / Walk a graph or tree               | `graph-traverse`              |
| 断言核验 / Verify a claim against evidence     | `claim-verify`                |
| 结构化抽取 / Extract a structured field        | `extract-field`               |
| 创业/想法评分 / Score a startup idea           | `startup-pitch`               |

完整目录与「六大决策模式」解释见
[`references/template-catalog.md`](./template-catalog.md)。

---

## 2. 安装 · Installation

```bash
# 中文
# 1) 核心 SDK（决策 API、规则引擎、路由、回执）
npm install @haxitag/yueli-dex
# 2) 模板包（16 个场景模板 + 本地规则集 + 调用示例）
npm install @haxitag/yueli-dex-templates-core
# 3) 至少一个 provider 适配器
npm install @haxitag/yueli-dex-provider-typesafe
# 或 cloudflare / vercel / http

# English
# 1) Core SDK (decision API, rule engine, routing, receipts)
npm install @haxitag/yueli-dex
# 2) Template pack (16 templates + local rule sets + call examples)
npm install @haxitag/yueli-dex-templates-core
# 3) At least one provider adapter
npm install @haxitag/yueli-dex-provider-typesafe
#   alternatives: cloudflare | vercel | http
```

> 中文：开发期零凭据也可跑 —— playground 自带内置 `mock-jev` provider，
> 完整跑通三级决策链。生产时再切换到真实 provider。
>
> English: For dev you can run with **zero credentials** — the playground
> ships a built-in `mock-jev` provider that exercises the full 3-tier chain.
> Switch to a real provider when you ship.

---

## 3. 一次性接线 · One-time wiring (DEX instance)

中文：在 Agent 启动时构造一次 `dex` 实例，整个进程复用。Provider 配置、路由
策略、模板包、本地规则集都在这一步注入。

English: Build the `dex` instance **once** at agent startup and reuse it for the
lifetime of the process — providers, routing, template packs, and local rule
sets all attach here.

```ts
// 中文：Agent 启动时构造
// English: Build once at agent startup
import { createDex } from "@haxitag/yueli-dex";
import {
  TEMPLATES_CORE_PACK,
  getLocalRuleSets,
} from "@haxitag/yueli-dex-templates-core";
import { createTypesafeProvider } from "@haxitag/yueli-dex-provider-typesafe";

const dex = createDex({
  providers: [
    createTypesafeProvider({ id: "ts-primary", apiKey: process.env.TYPESAFE_KEY! }),
    // 可选：备用 provider，circuit breaker 触发时接管
    // Optional: a fallback provider that takes over on circuit-breaker trip
  ],
  routing: {
    default: {
      providerIds: ["ts-primary"],
      maxAttempts: 2,                 // 单 provider 重试次数
      circuitFailureThreshold: 3,     // 连续失败次数触发熔断
      circuitCooldownMs: 60_000,      // 熔断冷却时间
    },
  },
  templates: [TEMPLATES_CORE_PACK],
  // 本地规则集：可在规则命中时短路，零远程调用
  // Local rule sets: matched cases short-circuit locally, no remote call
  ruleSets: getLocalRuleSets("agent-tool-selection"),
});
```

---

## 4. 在 Agent 循环中的四种插入方式 · Four insertion patterns

### 4.1 选下一步工具 · Picking the next tool

中文：在 ReAct / LangGraph 节点中，把「让 LLM 选工具」替换为「让 Jev 选工具」。
返回的 `ActionIntent` 携带动作意图，由执行器负责真实调用与权限。

English: In a ReAct / LangGraph node, replace "ask the LLM to pick a tool"
with "ask Jev to pick a tool". The returned `ActionIntent` is a *request*
— your executor owns the actual call and authorization.

```ts
// 中文：ReAct 节点中
// English: inside a ReAct node
async function pickToolNode(state: { goal: string; tools: ToolInfo[] }) {
  // 1) 编译：场景模板 + 当前状态 → ChoiceRequest
  //    Compile: template + state → ChoiceRequest
  const request = await dex.templates.prepare({
    template: "agent-tool-selection",
    input: { goal: state.goal, available_tools: state.tools.map((t) => t.name) },
  });

  // 2) 决策：本地规则命中 → model: "yueli-dex/rules@1"（零远程）
  //         未命中 → 路由到 provider，返回校准的概率分布
  //    Decide: rule hit → "yueli-dex/rules@1" (zero remote); else → provider
  const response = await dex.choice(request);

  // 3) 映射为意图：执行器负责真实调用与权限
  //    Map to intent: executor owns the real call + authz
  const intents = dex.templates.toActionIntent({
    template: "agent-tool-selection",
    request,
    response,
  });

  // 4) 分支：按动作风险设阈值（只读 ≥0.7；破坏性 ≥0.9 需确认）
  //    Branch: thresholds by action risk (read-only ≥0.7; destructive ≥0.9 + confirm)
  const toolChoice = response.answers.tool.choice;
  const confidence = response.answers.tool.confidence;
  if (confidence < 0.7) {
    return { next: "ask-human", reason: "low-confidence tool selection" };
  }
  return { next: "invoke", tool: toolChoice, intents };
}
```

### 4.2 循环控制（继续/重试/升级）· Loop control

中文：替代「步数启发式」，用校准置信度决定 continue / retry / abort / escalate。

English: Replace "step-count heuristics" with calibrated confidence to
continue / retry / abort / escalate.

```ts
// 中文：自研 Agent 主循环
// English: a hand-rolled agent main loop
async function runAgent(goal: string, maxSteps = 12) {
  for (let step = 0; step < maxSteps; step++) {
    const req = await dex.templates.prepare({
      template: "agent-loop-control",
      input: { goal, step, lastError, recentActions },
    });
    const resp = await dex.choice(req);
    const action = resp.answers.decision.choice; // continue | retry | abort | escalate

    if (action === "continue") {
      await tick();
    } else if (action === "retry") {
      await retryLast();
    } else if (action === "abort") {
      return { status: "aborted" };
    } else {
      return { status: "escalated", to: "human", receipt: resp };
    }
  }
}
```

### 4.3 工具调用前的安全门禁 · Safety gate before tool exec

中文：在执行任何 `Bash` / `write_file` / 网络请求之前，由 Jev 给出 verdict
+ confidence；破坏性动作按风险阈值二次确认或拒入。

English: Before any `Bash` / `write_file` / network call, ask Jev for a
verdict + confidence; destructive actions get a second confirmation or
refusal at the threshold.

```ts
// 中文：工具执行前的强制门禁
// English: mandatory gate before any tool execution
async function guardedExec(toolCall: ToolCall) {
  const req = await dex.templates.prepare({
    template: "security-gate",
    input: {
      tool: toolCall.name,
      args: toolCall.args,
      context: { env: process.env.NODE_ENV, actor: toolCall.actor },
    },
  });
  const resp = await dex.choice(req);
  const verdict = resp.answers.verdict.choice; // approve | confirm | reject
  const confidence = resp.answers.verdict.confidence;

  if (verdict === "reject") return { ok: false, reason: "rule-rejected", receipt: resp };
  if (verdict === "confirm" && confidence < 0.9) {
    return { ok: false, reason: "needs-human-confirmation", receipt: resp };
  }
  return { ok: true, sideEffects: exec(toolCall) };
}
```

### 4.4 上下文整理 · Context compaction

中文：在每轮对话结束 / 上下文超阈值时，对每个 chunk 独立裁决 keep / truncate /
hide / review —— 零失真保留关键内容。

English: At the end of each turn (or when the context window nears the
threshold), decide per chunk: keep / truncate / hide / review — preserving
critical content verbatim.

```ts
// 中文：超阈值时压缩上下文
// English: compact context when nearing the window threshold
async function compactContext(chunks: Chunk[]) {
  const verdicts = await Promise.all(
    chunks.map(async (chunk) => {
      const req = await dex.templates.prepare({
        template: "chunk-triage",
        input: { content: chunk.text, toolName: chunk.source, errorLike: isErrorOutput(chunk) },
      });
      const resp = await dex.choice(req);
      return { id: chunk.id, disposition: resp.answers.disposition.choice };
    }),
  );
  return verdicts.reduce(
    (acc, v) => ({
      keep: [...acc.keep, ...(v.disposition === "keep_verbatim" || v.disposition === "keep_summary" ? [v.id] : [])],
      hide: [...acc.hide, ...(v.disposition === "hide_with_stub" ? [v.id] : [])],
      review: [...acc.review, ...(v.disposition === "needs_review" ? [v.id] : [])],
    }),
    { keep: [], hide: [], review: [] } as Record<string, string[]>,
  );
}
```

---

## 5. 三类 Agent 框架的接入示例 · Wiring into three frameworks

### 5.1 LangGraph 节点 · LangGraph node

```ts
// 中文：把决策做成 LangGraph 中的一个节点
// English: make the decision a node in LangGraph
import { StateGraph, Annotation } from "@langchain/langgraph";

const State = Annotation.Root({
  goal: Annotation<string>(),
  lastAction: Annotation<string>(),
  step: Annotation<number>(),
});

async function jevDecisionNode(state: typeof State.State) {
  const req = await dex.templates.prepare({
    template: "agent-loop-control",
    input: { goal: state.goal, step: state.step, lastAction: state.lastAction },
  });
  const resp = await dex.choice(req);
  return { decision: resp.answers.decision.choice, confidence: resp.answers.decision.confidence };
}

const graph = new StateGraph(State)
  .addNode("jev-decide", jevDecisionNode)
  .addConditionalEdges("jev-decide", (s) => s.decision, {
    continue: "act",
    retry: "act",
    abort: "__end__",
    escalate: "ask-human",
  });
```

### 5.2 OpenAI Agents SDK tool · OpenAI Agents SDK tool

```ts
// 中文：把「下一步选哪个工具」做成 OpenAI Agents SDK 的 tool
// English: expose "which tool to call next" as an OpenAI Agents SDK tool
import { tool } from "@openai/agents";

const pickNextTool = tool({
  name: "pick_next_tool",
  description: "Pick the next tool the agent should invoke.",
  parameters: { type: "object", properties: { goal: { type: "string" } }, required: ["goal"] },
  async execute({ goal }) {
    const req = await dex.templates.prepare({
      template: "agent-tool-selection",
      input: { goal },
    });
    const resp = await dex.choice(req);
    return { tool: resp.answers.tool.choice, confidence: resp.answers.tool.confidence };
  },
});
```

### 5.3 自研循环 · Hand-rolled loop

```ts
// 中文：自研循环：决策 → 执行 → 观察 → 再决策
// English: hand-rolled loop: decide → act → observe → re-decide
while (!done) {
  const req = await dex.templates.prepare({ template: "agent-loop-control", input: snapshot() });
  const resp = await dex.choice(req);
  const intent = dex.templates.toActionIntent({ template: "agent-loop-control", request: req, response: resp })[0];
  await apply(intent);
}
```

---

## 6. 正确做法与反模式 · Do & Don't

| ✅ Do (中文) | ✅ Do (English) | ❌ Don't (中文) | ❌ Don't (English) |
| --- | --- | --- | --- |
| 每次只问一个问题 | One question per request | 把多步决策塞进一个 instructions | Pack "diagnose + assign + fix" into one prompt |
| 描述而非标签 | Use descriptions, not labels | `"high"` / `"low"` 这种标签 | Bare labels like "high"/"low" |
| 保留 `needs_review` 兜底 | Keep a `needs_review` fallback | 完全开集而无兜底 | No fallback in open-world classification |
| 低置信不重试 | Low confidence is info, not a failure | 重试或换模型"再问一遍" | Retry / re-route to "ask again" |
| 按动作设阈值 | Thresholds per action, not per model | 所有动作都用同一阈值 | One threshold for all actions |
| 决策 ≠ 授权 | Decision ≠ authorization | "用户想退款" ⇒ 自动退款 | Auto-refund because "user asked" |
| `state` 聚焦且脱敏 | Focused, redacted state | 把 secrets / PII 全量喂给 Jev | Send raw secrets / PII to the model |
| 消费意图，不消费响应 | Consume intents, not raw responses | 把 LLM 文本直接当动作执行 | Execute on raw LLM text |

---

## 7. 端到端验证习惯 · Verification habit

中文：每次集成完成，跑一遍 deterministic local fixture（mock-jev 或本地
fixture provider），用 `validateChoiceRequest` 校验编译产物，并对 confidence 与
selected probability 都设断言。**单次线上成功不是稳定性的声明**。

English: After every integration, run a deterministic local fixture
(mock-jev or a local fixture provider), validate the compiled request with
`validateChoiceRequest`, and assert both `confidence` and the selected
probability. **A single live success is not a stability claim.**

```ts
// 中文：本地 mock 跑通完整链路
// English: run the full chain against the built-in mock
import { createMockJevProvider } from "@/lib/mock-jev-provider"; // playground 内部示例
const mock = createMockJevProvider({ id: "mock-jev" });
const dex = createDex({ providers: [mock], routing: { default: { providerIds: ["mock-jev"] } }, templates: [TEMPLATES_CORE_PACK] });
const resp = await dex.choice(await dex.templates.prepare({ template: "support-triage", input: { message: "I was charged twice." } }));
console.assert(resp.model === "yueli-dex/mock-jev@1");
```

完整规则与契约、`THREAT_MODEL`、阈值策略见各 references 文档：

- [`choice-contract.md`](./choice-contract.md)
- [`question-design.md`](./question-design.md)
- [`providers-and-routing.md`](./providers-and-routing.md)
- [`template-catalog.md`](./template-catalog.md)
- [`plugin-architecture.md`](./plugin-architecture.md)
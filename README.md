# Yueli DEX

> **From Options To Action**

Yueli DEX (`@haxitag/yueli-dex`) is a Choice-only decision framework for AI agents. It preserves Jev's standard `Choice` request and response contract while adding local rules, installable decision-modeling templates, optional LLM-assisted modeling, and reliable routing across TypeSafe, Cloudflare, Vercel, and compatible self-hosted hosts.

## Project status

Core TypeScript packages are implemented and tested (159 tests across 11 test files): the SDK, plugin contracts, four provider adapters, a labeled base template pack with local rule sets, the CLI, and an interactive playground. Packages build from source; npm publication is pending.

## 核心执行策略：本地规则优先

可规则化的策略与路由**直接在本地 rule engine 处理，不调用远程 Jev 类模型**：

```
业务输入
  │
  ① 本地规则引擎（yueli-dex-rules/v1）
  │   reject      → 本地拦截，零远程调用
  │   shortCircuit→ 本地短路，返回诚实的合成响应 model: "yueli-dex/rules@1"，零远程调用
  │   route       → 强制路由到指定策略
  │   constrain   → 收紧约束（fallback 选项 / 允许的 ActionKind）
  │
  ② 未命中 → 场景模板编译的 ChoiceRequest 路由到远程 Jev 类模型
  │   （TypeSafe / Cloudflare / Vercel / 自托管 jev-choice/v1 服务）
  │
  ③ 响应 → 校验 → ActionIntent 映射（请求而非授权，执行方负责权限）
```

基础模板包为每个模板附带可本地规则化的规则集（如：enterprise 账户优先级短路、生产环境危险命令本地拒绝、目录列表确定性丢弃、循环上限升级）；开放世界模板（内容审核、浏览器操作）不带本地规则，必须走远程模型。

## What v1 supports

- Jev `Choice` only — not `Score`, `Noul`, or generic generated text.
- The standard Choice inputs: `state`, optional `model`, and `questions` with `type`, `instructions`, and `criteria`.
- The standard Choice outputs: `model`, `answers`, selected `choice`, `confidence`, `probabilities`, and optional `usage`.
- Local declarative rules (pre-routing short-circuit / reject / route / constrain), scenario templates with 四维度标签, optional LLM modeling proposals, and read-only context providers.
- Provider routing that considers explicit policy, configured budget, observed latency, health, retry, circuit breaking, and fallback.
- An `ActionIntent` sidecar. DEX does not execute business actions, tool calls, or repository code.

## Quick contract example

```ts
import { createDex } from "@haxitag/yueli-dex";
import { TEMPLATES_CORE_PACK, getLocalRuleSets } from "@haxitag/yueli-dex-templates-core";

const dex = createDex({
  providers: [typesafeProvider /* typesafe | cloudflare | vercel | http */],
  routing: { default: { providerIds: ["typesafe"], maxAttempts: 2, circuitFailureThreshold: 3, circuitCooldownMs: 60_000 } },
  templates: [TEMPLATES_CORE_PACK],
  // 可规则化的策略本地处理：命中即短路，零远程调用
  // Rule-able policies short-circuit locally — zero remote calls
  ruleSets: getLocalRuleSets("support-triage"),
});

// ② 中文：从场景模板编译 ChoiceRequest
// ② English: Compile the scenario template into a ChoiceRequest
const request = await dex.templates.prepare({
  template: "support-triage",
  input: { message: "I was charged twice.", account: { plan: "pro" } },
});
// ③ 中文：本地命中 → model: "yueli-dex/rules@1"；未命中 → 路由到 provider
// ③ English: Local hit → model: "yueli-dex/rules@1"; miss → routed to provider
const response = await dex.choice(request);
// ④ 中文：映射为可审计的 ActionIntent（请求，而非授权）
// ④ English: Map to auditable ActionIntent (request, not authorization)
const intents = dex.templates.toActionIntent({ template: "support-triage", request, response });
```

## Packages

| Package | Role |
| --- | --- |
| [`@haxitag/yueli-dex`](packages/core) | Choice API、校验、规则引擎、路由、回执、插件注册 |
| [`@haxitag/yueli-dex-plugin-sdk`](packages/plugin-sdk) | 四类插件的版本化契约（provider / template-pack / modeler / context-provider） |
| [`@haxitag/yueli-dex-provider-*`](packages/provider-typesafe) | TypeSafe / Cloudflare / Vercel / HTTP 四种 host 适配器（仅传输与鉴权） |
| [`@haxitag/yueli-dex-templates-core`](packages/templates-core) | 基础模板包：16 个场景模板（覆盖 6 大决策模式，四维度标签）+ 本地规则集 + 调用示例生成器 |
| [`@haxitag/yueli-dex-cli`](packages/cli) | 校验、provider 探测、fixture 执行 |
| `@haxitag/yueli-dex-playground` | 交互式调试器（见下） |

## Playground：场景用例的实际调用验证

```bash
cd packages/playground && npm run dev   # http://localhost:34567
```

**📋 Template Tester** 标签页提供完整验证链路：

1. **模板目录**：下拉选择 16 个四维度标签模板（主题/场景/用例/效用 + 生态证据，覆盖 6 大决策模式：分块分诊 / 断言核验 / 实时动作 / 图遍历 / 结构化抽取 / 多维评分）；
2. **调用方法与示例**：自动生成该场景用例的可运行 SDK 代码（含本地规则短路说明），可一键复制；
3. **执行链**：① 编译 → ChoiceRequest → ② 本地规则评估（命中即短路，零远程调用）→ ③ 端到端决策（本地规则优先，未命中调用 Runtime Config 中配置的 provider）→ ④ Map → ActionIntent；
4. 示例输入预填充，可编辑后重跑，验证真实业务输入的决策行为。

其他标签页：Choice Debugger（手写请求 + 路由/回执审计）、Provider Tester、Rule Tester。

## Documentation

### 设计与规划（docs/）

- [Choice-only 设计规格](docs/superpowers/specs/2026-09-21-yueli-dex-choice-design.md) — 契约、安全边界、v1 固定决策
- [三级决策建模链技术设计](docs/三级决策建模链技术设计.md) — 规则层 / 模板与建模并行层 / 策略路由层
- [从「词表 + 规则」迁移到 Yueli DEX](docs/已用规则引擎和特征、分类路由的部分迁移都yueli-dex.md) — 三层拆分迁移指南：本地规则 / Choice / 执行与权限
- [调用说明与使用手册](docs/调用说明与使用手册.md) — API 手册、四 host 接入、密钥池、成本与校准

### Agent Skill（skills/yueli-dex/）

教编码代理正确集成 DEX：[SKILL.md](skills/yueli-dex/SKILL.md) 入口，按需加载六篇参考（[Choice 契约](skills/yueli-dex/references/choice-contract.md)、[四维度模板目录](skills/yueli-dex/references/template-catalog.md)、[问题设计](skills/yueli-dex/references/question-design.md)、[Provider 与路由](skills/yueli-dex/references/providers-and-routing.md)、[插件架构](skills/yueli-dex/references/plugin-architecture.md)、**[Agent 集成指南 · Agent Integration (中英双语)](skills/yueli-dex/references/agent-integration.md)**）。覆盖 TypeSafe 官方 skill 不具备的多 host 接入教学。发布准备已就绪（见 [skills/yueli-dex/README.md](skills/yueli-dex/README.md)）。

### 模板包（packages/templates-core/）

16 个 `yueli-dex-template/v1` 场景模板，每个带 `meta` 四维度标签（主题/场景/用例/效用）、生态证据引用、示例输入，以及可本地规则化的规则集。前 10 个为通用场景；后 6 个从 20 个真实 Jev 项目（Winnow、jev-mcp、typesafe-mario、Blink、killmyidea 等）抽象出 6 大决策模式落地。详见[模板目录参考](skills/yueli-dex/references/template-catalog.md)。

## Compatibility references

- [TypeSafe Choice](https://docs.typesafe.ai/primitives/choice)
- [TypeSafe HTTP quick start](https://docs.typesafe.ai/introduction/quickstart)
- [TypeSafe agent skill](https://docs.typesafe.ai/agent-skill)（对照：官方 skill 只教自家 API；本项目的 skill 覆盖四种 host + 建模 + 插件架构）
- [Cloudflare `typesafe/jev`](https://developers.cloudflare.com/ai/models/typesafe/jev/)
- [Vercel AI Gateway and Jev](https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk)

## License

MIT — see the [`LICENSE`](LICENSE) file for the full text.

Copyright (c) 2026 Yueli DEX contributors.

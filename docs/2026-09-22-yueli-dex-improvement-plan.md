# Yueli-DEX v0.2 改进计划（P0/P1，不扩展 scope）

**状态**：可执行计划（implementation-ready）
**范围**：`@haxitag/yueli-dex` 及其六个周边包（`plugin-sdk`、`provider-*`、`templates-core`、`cli`、`playground`）
**对齐**：`docs/superpowers/specs/2026-09-21-yueli-dex-choice-design.md`（Choice-only v1）+ 本仓库既定的「本地规则优先 / ActionIntent 是请求不是授权 / Receipt 是审计」三原则

> 本文不重写 v1 定位，只修复 v1 留下的正确性漏洞、补齐 README 已声明但未落地的语义，并显式锁住不做的事，避免 review 中的 27 项建议被一并塞进来导致 scope 爆炸。

---

## 0. 三句话回顾定位（来自 design spec + README）

1. **Choice-only Decision Execution Framework**：v1 只支持 Jev `Choice`，不扩展 `Score` / `Noul` / 通用文本生成。
2. **本地规则优先**：能规则化的策略在 `yueli-dex-rules/v1` 内短路（`reject` / `shortCircuit` / `route` / `constrain`），零远程调用；未命中才走到 `ChoiceProvider`。
3. **Decision 与 Execution 解耦**：`dex.choice()` 产出 `ChoiceResponse` → `templates.toActionIntent()` 产出 `ActionIntent`（请求，不是授权）。**授权、执行、回滚、副作用一律不属于 DEX**。

下文所有改动都围绕这三条；任何一条会破坏它们的项被显式列为「不做」。

---

## 1. 借鉴与不借鉴（scope discipline）

### 1.1 借鉴（与 v1 直接相关、能在现有包内落地）

| 来源（review §） | 借鉴点 | 去向 |
| --- | --- | --- |
| §3 路由没真用 cost/latency/error | README/skills `providers-and-routing.md` 明确写了「penalize by P95 latency / error rate / cost」，实现没兑现 | P1-1 路由评分 |
| §4 Retry 实际是 Failover | `orderProviders()` 把 attempt budget 用成了 provider failover budget，语义混了 | P1-2 拆分 |
| §5 Timeout 是 per-attempt | `executeWithTimeout` 每次重置 `deadlineMs`，整个 `choice()` 最长可 `~providers × deadlineMs` | P0-4 全局共享 deadline |
| §6 Circuit half-open 并发探针 | `isOpen()` + `allowProbe()` 都没有单飞，多个并发请求可同时进入 half-open | P0-5 |
| §7/§8 Local rule 正确性比 LLM 更危险 | `realtime-action`/`startup-pitch` 两条规则条件与注释不一致 | P0-1、P0-2 |
| §10 ActionIntent 缺乏 Evidence | `decisionId`、`confidence`、`template@version`、`ruleRefs` 没进 ActionIntent | P1-5 |
| §12 失败回执丢 attempts | `dex.ts` 错误路径构造空 `attempts: []` | P0-3 |
| §13 hashRequest 非 canonical | 只 sort 顶层 keys | P0-6 |
| §14 规则 scope 优先级未定义 | template < organization < environment < call 的注释没生效机制 | P1-3 |
| §20 health() 是 credential health | 当前实现确实只检查 API key | P1-4 |
| §22 测试不证明 decision 正确 | `cli` 已支持 fixture，但模板没有自带 fixture | P2-1 |

### 1.2 不借鉴（扩展 scope，与 v1 定位冲突，本轮不动）

| 来源（review §） | 不做的理由 |
| --- | --- |
| §6 六层架构重构 / §26 Decision Plane 重定义 | 是叙事性愿景，不是 v1 范围；现在的三层（rules / templates+modeling / routing）足够承载 |
| §9 继续扩展 contextProviders | review 自己已经建议「保持 caller/template/modeler 自己拿」，DEX 不自动 fetch |
| §11 Modeling Evidence 完整性 / §18 Evidence integrity 哈希 | modeling 已在 v1 中标记为「optional LLM-assisted」，v1 不强约束证据链；待 modeling 收紧再补 |
| §15 Decision Provider 抽象层 | 把 Jev / GPT / Claude / classifier / human / rules 一并抽象为「Decision Provider」会破坏 Choice-only 边界 |
| §16 Template-as-Decision-Program / §17 Modeling 是核心 | 模板合同已经在 schema 层支持（`meta` 四维度、`modeling` 配置），本轮不引入 fixture / evaluation 之外的额外结构 |
| §21 Decision IDE / Trace | playground 已逐步具备，本轮不新增 IDE 形态 |
| §23 Decision Evaluation / Calibration | review 自己也说 P3，且超出 v1；放到下一个 minor |
| §24 Decision Boundary 可视化 | 概念性，本轮不做 |

---

## 2. P0：正确性修复（必修，影响安全/可审计）

### P0-1 `realtime-action` 的 `airborne-with-hazard-defend` 条件不查 hazards

**现状**：`packages/templates-core/src/rules.ts`

```ts
when: {
  all: [
    { path: "$.input.grounded", op: "equals", value: false },
    // 注释承诺「and there is a hazard」，但条件没查
  ],
},
```

问题：调用方传 `grounded=false, hazards=[]` 也会 `defend`，违反「deterministic ≠ correct」原则（review §7）。

**修法**：规则改写为

```ts
when: {
  all: [
    { path: "$.input.grounded", op: "equals", value: false },
    { path: "$.input.hazards", op: "exists" },
  ],
},
```

并增加防御性 case（regression test）：当 `grounded=false, hazards=undefined` 时**不**走短路，让 Jev 决定。

**验证**：`templates-core/test/rules.test.ts` 新增三条 fixture：
- `grounded=false, hazards=[...]` → 短路 `defend`
- `grounded=false, hazards=[]` → 不短路，调用 provider
- `grounded=true, hazards=[...]` → 不短路，调用 provider

---

### P0-2 `startup-pitch` 的 `too-short-to-score` 条件错 + 缺 length 算子

**现状**：用 `op: "exists"` 等价于「任何 idea 都 needs_review」，与注释「ideas shorter than ~50 chars」矛盾。Rule grammar 也没有 `length_lt` 算子。

**修法**：

1. 在 `packages/core/src/rules.ts` 的 `LeafCondition.op` 增加 4 个算子：
   - `string_length_lt` / `string_length_gte`
   - `array_length_lt` / `array_length_gte`
   - `contains`（字符串 substring，对 string 和 array 两种语义）
   - `matches`（字符串 regex，需满足现有 `RULE_REJECTED` 解析失败时的稳定行为）

   算子命名沿用现有 snake_case 风格，保持 deterministic。

2. `packages/templates-core/src/rules.ts` 的规则改写为

   ```ts
   when: { path: "$.input.idea", op: "string_length_lt", value: 50 },
   ```

3. `packages/core/test/rules.test.ts` 增加新算子单测（含 type guard 错误路径：`op: "string_length_lt"` 作用于 number 应返回 false 而不是抛错，保持与现有 `lt`/`gte` 一致的语义——这是 *不是* `RULE_REJECTED`，因为 parse 期已经强制 path 解析）。

**验证**：所有 12 条现有 `LOCAL_RULE_SETS` 的 fixture 用例在新算子引入后必须保持通过。

---

### P0-3 失败回执保留 `attempts`

**现状**：`packages/core/src/dex.ts:201-214` 在 catch 分支直接 `const attempts: ProviderAttempt[] = [];`，覆盖了 routing 内部维护的真实 attempt 列表。**失败恰恰是最需要完整 attempt 链的场景**（review §12）。

**修法**：

1. 引入新异常类型 `RouteExecutionFailure extends DexError`，携带 `attempts: ProviderAttempt[]`：

   ```ts
   // errors.ts
   export class RouteExecutionFailure extends DexError {
     readonly attempts: readonly ProviderAttempt[];
     constructor(code, message, { attempts, ...rest }) { ... }
   }
   ```

2. `executeRoute()` 失败时把内部 `attempts` 装进 `RouteExecutionFailure` 抛出，不再只抛 `DexError` 裸异常。

3. `dex.choice()` 的 catch 分支从 err 里读 `attempts`：

   ```ts
   const attempts =
     err instanceof RouteExecutionFailure ? err.attempts :
     // NO_ELIGIBLE_PROVIDER / 校验失败 / etc.
     (err instanceof DexError ? [] : []);
   ```

4. `DecisionReceipt.route` 增加可选 `reason?: "no_eligible" | "all_failed" | "non_retryable"`（enum）字段，便于审计。

**验证**：`dex.test.ts` 增加用例：`NO_ELIGIBLE_PROVIDER` 与「连续 500 触发熔断」两种失败下，receipt 的 `attempts` 都应反映真实调用。

---

### P0-4 全局共享 deadline

**现状**：`routing.ts` 每次 attempt 都用 `deadlineMs`（默认 30000）作为单次超时。理论上整个调用 ≈ `len(providers) × deadlineMs`，对 `realtime-action`（300ms tick）等场景不可接受（review §5）。

**修法**：

```ts
const deadlineAt = options.deadlineMs ? Date.now() + options.deadlineMs : Infinity;
const remainingMs = () => Math.max(0, deadlineAt - Date.now());
```

- `executeWithTimeout(provider.execute(...), remainingMs(), ...)`：每次 attempt 用剩余 budget
- health check 用 `Math.min(remainingMs(), healthBudget)`（例如 5000 但不超过 remaining）
- health cache 仍可生效（避免重复探测）

**额外约束**：deadlineMs 为负或非数 → `DexError("INVALID_CHOICE_REQUEST")` 已在 `ChoiceCallOptions` 校验处补一刀（javadoc 也说明）。

**验证**：`routing.test.ts` 新增：
- 单 attempt timeout 仍报 `PROVIDER_TIMEOUT`
- 三个 provider 串行 timeout 时，总耗时 ≤ `deadlineMs × 1.1`（留 10% 余量）
- `deadlineMs=50` 下，attempt 1 已耗尽 → attempt 2 立即 `PROVIDER_TIMEOUT` 且 `elapsedMs ≤ 10`

---

### P0-5 熔断器 half-open 单飞

**现状**：`createCircuitBreaker` 的 `isOpen()` 在 cooldown 过后把 state 翻成 half-open，但多个并发请求都会看到 half-open，并都通过 `allowProbe()`（review §6）。

**修法**：half-open 状态下只允许一个 probe：

```ts
interface CircuitRecord {
  state: "closed" | "open" | "half-open" | "probing";
  failures: number;
  lastFailureAt: number;
  probeStartedAt?: number;
}

// 关键逻辑：
// isOpen(id): state === "open" 时考虑 cooldown；cooldown 过后进入 half-open 并立即置 probing（取）
// allowProbe(id): state === "probing" 且 probe 还没结束（probeStartedAt + probeTimeoutMs）→ 允许
// recordSuccess: state 回到 closed，清 failures
// recordFailure: state 回到 open，重置 lastFailureAt
```

为避免「probe 永远 hang」导致 half-open 卡死，引入 `probeTimeoutMs`（默认 = `circuitCooldownMs / 2`，可由 `RoutePolicy` 选填）。`probeStartedAt` 之后超过 probeTimeoutMs 的 probe 自动作废，state 回到 open。

`RoutePolicy` 增加可选 `probeTimeoutMs?: number`。

**验证**：`routing.test.ts` 新增：
- 5 个并发请求在 cooldown 后只有 1 个进入 execute，其余 4 个被 circuit 拒绝
- probe 失败后 state 立即回 open
- probe 超时后 state 自动回 open

---

### P0-6 规范化 `hashRequest()`

**现状**：`utils.ts` 用 `JSON.stringify(request, Object.keys(request).sort())` 只 sort 顶层。

**修法**：递归规范化：

```ts
function canonicalize(v: JsonValue): JsonValue {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(canonicalize);
  // plain object: keys sorted
  const sorted: Record<string, JsonValue> = {};
  for (const k of Object.keys(v as object).sort()) {
    sorted[k] = canonicalize((v as Record<string, JsonValue>)[k]);
  }
  return sorted;
}
export function hashRequest(request: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(request as JsonValue))).digest("hex").slice(0, 32);
}
```

**约束**：
- 数组保留顺序（与现有 `orderProviders` 的 `providerIds` 顺序约定一致）
- 复用 `validation.ts` 的 `isJsonValue` 守门，非 JsonValue 直接 throw `INVALID_CHOICE_REQUEST`（一致性更好）

**验证**：`utils.test.ts`（新建）：
- `{ a:1, b:2 }` 与 `{ b:2, a:1 }` 同 hash
- `{ x:{ a:1, b:2 } }` 与 `{ x:{ b:2, a:1 } }` 同 hash
- 数组 `[1,2]` 与 `[2,1]` **不同** hash（保留顺序语义）

---

## 3. P1：语义完整性（README 已声明，应实现）

### P1-1 路由评分（cost / latency / error）

**现状**：`orderProviders()` 仅按 `providerIds` 静态顺序排序。`skills/.../providers-and-routing.md` 第 46 行明确写了「Order by configured priority with penalties for recent P95 latency, error rate, and estimated cost」。

**修法**：在 `orderProviders()` 内构建 score（**lower is better**）：

```text
score(provider) =
    baseIdx(provider.id)                  // providerIds 静态序
  + latencyPenalty(provider.health.p95)  // p95 > p95LatencyMs 时按比例加分
  + errorPenalty(provider.health.errorRate) // errorRate > 0.1 加分
  + costPenalty(provider.estimate)       // estimate > maxEstimatedCostUsd 直接淘汰
```

落地步骤：

1. 在 `RouterDeps` 引入 `getObservations(providerId): { p95Ms?: number; errorRate?: number; estCostUsd?: number }`，默认实现读 `health` 缓存 + 简单的滑动窗口（环形 buffer，capacity=64）。**不引入新依赖**。
2. `orderProviders()` 返回 `{ ordered: ChoiceProvider[]; decisions: RouteDecision[] }`，每个 candidate 一条 `RouteDecision`：
   ```ts
   interface RouteDecision {
     providerId: string;
     score: number;
     reasons: { factor: "priority"|"latency"|"error"|"cost"|"circuit"|"health"; delta: number; note: string }[];
   }
   ```
3. `RouteExecutionResult` 暴露 `decisions: readonly RouteDecision[]`，`DecisionReceipt.route` 增加 `routing?: { candidates; decisions; reason }`。
4. `maxEstimatedCostUsd` 严格：超过即 `NO_ELIGIBLE_PROVIDER` 并在 `reasons` 中标注 `cost:exceeds_budget`。

**不做**：抽象 `RouteReason` JSON 形式（review §3 建议的「decision router」概念），保持 TS 结构化即可，序列化由 `receiptStore` 决定。

**验证**：`routing.test.ts` 增加：
- p95 高的 provider 被降权
- 超过 `maxEstimatedCostUsd` 的 provider 被剔除
- receipt.route.decisions 字段可被审计读取

---

### P1-2 Retry vs Failover 拆分（语义清晰化，不破坏现有语义）

**现状**：`executeRoute` 的循环把 `maxAttempts` 当成「provider failover budget」，实际上是「attempt budget + failover」（review §4）。

**修法**：**保留现有循环语义**，但在文档/类型上明确：
- `RoutePolicy.maxAttempts` 表示「对同一个 `decision()` 调用允许的 provider 尝试总次数」，即 attempt budget
- 不引入独立的「retry-same-provider 次」参数（避免破坏 v1 简洁性），但允许 `maxAttempts === 1` 的合理配置

附加的「Retry same provider」能力**不在 v0.2 引入**，但要在 `docs/调用说明与使用手册.md` 显式标注为「已知缺口，待 v0.3」。这样既不动现状，又诚实记录 reviewer 提出的语义问题。

**验证**：现有 `routing.test.ts` 的「fails over to the next provider on retryable error」用例不需要改，行为不变。

---

### P1-3 规则优先级 lattice

**现状**：`rules.ts` 按 scope 排序（template < organization < environment < call），但 actions 之间没有显式 lattice：reject/constrain/route/shortCircuit 在同 scope 内可以同时命中并互相覆盖（review §14）。

**修法**：建立 action kind 优先级（在 `evaluatePreRouting` 内对 `matches` 应用降级排序）：

```text
reject > constrain > route > shortCircuit
```

语义：
- 同一 decision 内，只要有一条 `reject` 命中就 throw（无论 scope），其他 action 不再处理
- 多条 `constrain` 命中时**取交集收紧**：`requireFallbackOption` 必须全部一致；`allowedActionKinds` 取交集
- 多条 `route` 命中时**取最严格 scope**（call > environment > organization > template），同 scope 时拒绝（throw `RULE_REJECTED` 提示配置冲突）——比 review §14 的建议更严格，避免沉默覆盖
- 多条 `shortCircuit` 命中时**取最严格 scope**，同 scope 拒绝

**这一改动不引入新 schema**，仅在 `evaluatePreRouting` 内部改 `for (const match of matches)` 的执行策略。

**验证**：`rules.test.ts` 新增：
- template-route + call-route 同时命中 → 选 call
- template-route + organization-route 同时命中 → 选 organization
- template-route + template-route（两条同 scope）→ throw `RULE_REJECTED`
- template-constrain + call-reject → call-reject 赢

---

### P1-4 Provider `health()` 双层语义

**现状**：四个 adapter 的 `health()` 只返回「是否有 API key」（review §20）。

**修法**：拆成两层（不破坏 provider 接口）：

1. **Credential check**（同步、便宜）：保留现有 `provider.health()`，但语义重命名为「configured()」更准确。**在 v0.2 仍保持现状**，只把注释/类型 docstring 改清楚——避免破坏 adapter 兼容性。
2. **Observation layer**（passive，由 routing 维护）：在 `createHealthCache()` 旁增加 `createObservationStore()`：

   ```ts
   interface ObservationStore {
     record(providerId, { ok: boolean; latencyMs: number }): void;
     snapshot(providerId): { p95Ms?: number; errorRate?: number; sampleCount: number };
   }
   ```

   routing 在每次 `execute` 之后调用 `record()`。TTL 不依赖时间戳，靠 sliding window 的容量（满则淘汰最旧样本）。

3. `orderProviders()` 的 P1-1 评分读 `snapshot()` 而非 `provider.health()` 的 `observedP95LatencyMs`。

**不做**：主动周期性健康探测（review §20 建议），那需要 cron / worker，超出 v1 包能力。

**验证**：`routing.test.ts` 增加：连续 5 次失败后 errorRate > 0，下次决策把该 provider 降权。

---

### P1-5 `ActionIntent` 增加 Evidence 字段

**现状**：`ActionIntent` 只有 `template/questionId/choice/kind/params`（review §11）。

**修法**：扩展 plugin-sdk 的 `ActionIntent`（**breaking change，需升 plugin-sdk minor 版**）：

```ts
export interface ActionIntent {
  // 现有字段
  template?: { id: string; version: string };
  questionId: string;
  choice: string;
  kind: string;
  params?: Readonly<Record<string, JsonValue>>;

  // 新增（皆可选，向后兼容）
  decisionId?: string;             // 来自 DecisionReceipt.decisionId
  confidence?: number;             // ChoiceAnswer.confidence
  probabilities?: Readonly<Record<string, number>>; // ChoiceAnswer.probabilities
  ruleRefs?: readonly { id: string; version: string }[]; // 命中的 rule set（来自 RuleMatch）
  model?: string;                  // 决策来源模型标识（"yueli-dex/rules@1" 或 provider 返回的 model）
}
```

**约束**：所有新字段都是可选，确保旧 plugin 调用 `toActionIntent` 时仍然工作（缺省时 `decisionId`/`confidence`/`probabilities` 都取自 `ChoiceResponse` 顶层信息）。

**不做**：review §11 建议的「独立 evidenceRefs / provenance 子对象」——会引入新的 schema 形状；本轮把现有 `ChoiceAnswer` 的字段直接 mirror 到 `ActionIntent`，最简且自洽。

**验证**：`templates.test.ts` 新增：short-circuit / provider success / provider fail-then-success 三条路径下，`toActionIntent` 返回的 intent 都带 `decisionId` / `model` / 命中的 `ruleRefs`。

---

## 4. P2：决策证据（**最小可用，停在 v1 范围内**）

### P2-1 模板自带 Decision Fixture（review §22 的最小落地）

**现状**：`cli` 已支持 fixture 执行；模板本身不带 fixture。

**修法**：每个 `yueli-dex-template/v1` 模板（`packages/templates-core/src/templates.ts`）可声明 `examples.fixtures?`：

```ts
{
  id: "support-triage",
  ...
  examples: {
    fixtures: [
      {
        name: "enterprise-charged-twice",
        input: { message: "I was charged twice.", account: { plan: "enterprise" } },
        expected: { priority: "urgent" }   // 已被 short-circuit / local rule 决定
      },
      ...
    ]
  }
}
```

`templates-core` 暴露 `getFixtures(templateId)`，供 `cli` 与 playground 的 Template Tester 调用。

**不做**：evaluation / calibration / disagreement rate（review §23），留给后续 minor。

**验证**：`templates-core/test/templates-core.test.ts` 增加：每个带 fixture 的模板，fixture 调用 `prepare` 后期望 question/option 一致。

---

## 5. 显式不做（与 v1 范围冲突或暂不值得）

| 不做的项 | 原因 |
| --- | --- |
| 六层架构重写 / Decision Plane 叙事 | review §26 的愿景级重构；当前三层（rules / templates+modeling / routing）已足够 |
| contextProviders 进入 decision path | review §8 自己也否定 |
| Modeling Evidence 完整性 / Evidence hash | modeling 在 v1 是 optional，下个 minor 再做 |
| Decision Provider 抽象（把 Jev / GPT / Claude 都抽象为同质 Provider） | 破坏 Choice-only 边界；plugin-sdk 已有 `ChoiceProvider` 即足够 |
| Template-as-Decision-Program（fixture / calibration / expected 之外的结构） | review §16 建议的演化方向，超出 v0.2 |
| Decision Evaluation / Calibration / Boundary 可视化 | review §23-§24，P3 范围 |
| 主动周期性 health probe | 需要 scheduler，超出 core 包能力 |
| PlayGround 升级为 Decision IDE | playground 已逐步具备 Trace，本轮只补一两条事件订阅展示，不重做 |
| Retry-same-provider 与 Failover 分离的运行时语义（review §4 的 `Retry same provider N times then failover`） | review §4 自己在 P1 提到；本轮只记录「待 v0.3」，不实现 |

---

## 6. 文件改动清单（精确到文件 + 模块）

| 文件 | 改动 | 优先级 |
| --- | --- | --- |
| `packages/core/src/errors.ts` | 新增 `RouteExecutionFailure`；`RoutePolicy` 类型不变（probeTimeoutMs 加在 routing.ts） | P0-3 / P0-5 |
| `packages/core/src/utils.ts` | 递归 canonicalize；处理非法 JsonValue | P0-6 |
| `packages/core/src/rules.ts` | 4 个新算子（`string_length_lt/gte`、`array_length_lt/gte`、`contains`、`matches`）；`evaluatePreRouting` 加 lattice 排序 | P0-2 / P1-3 |
| `packages/core/src/routing.ts` | 全局共享 deadline；熔断器单飞 + `probeTimeoutMs`；`orderProviders` 评分 + `RouteDecision`；observation store | P0-4 / P0-5 / P1-1 / P1-4 |
| `packages/core/src/dex.ts` | catch 路径从 `RouteExecutionFailure` 读取 attempts；receipt `reason` 字段 | P0-3 / P1-1 |
| `packages/core/src/types.ts` | `DecisionReceipt.route` 加 `routing?` / `reason?`；`ActionIntent` re-export 自 plugin-sdk | P0-3 / P1-5 |
| `packages/plugin-sdk/src/types.ts` | `ActionIntent` 增加可选 `decisionId/confidence/probabilities/ruleRefs/model` | P1-5 |
| `packages/templates-core/src/templates.ts` | `examples.fixtures?` 可选字段 | P2-1 |
| `packages/templates-core/src/catalog.ts` + `index.ts` | 暴露 `getFixtures(templateId)` | P2-1 |
| `packages/templates-core/src/rules.ts` | 修 `realtime-action` / `startup-pitch` 两条规则 | P0-1 / P0-2 |
| `packages/core/test/*` | 新增 deadline / 熔断单飞 / 路由评分 / 新算子 / hash 规范化用例 | P0/P1 |
| `packages/templates-core/test/*` | 新增规则修正回归 + fixtures 调用 | P0-1/P0-2/P2-1 |
| `packages/cli/*` | 适配 fixtures 自动执行（现有 CLI 已支持 fixture，此处只是文档化） | P2-1 |
| `docs/调用说明与使用手册.md` | 补充：maxAttempts 语义、Retry-same-provider 是已知缺口、ActionIntent 新字段 | P1-2/P1-5 |

---

## 7. 验证（每一项都对应一个 PR / commit）

1. **单元测试**：`npm test` 通过；新增覆盖率目标：core 包路由模块 ≥ 90%，规则模块 ≥ 95%。
2. **回归 fixture**：16 个模板的 `examples.fixtures` 全部走通：
   - local rule 命中路径 → `model: "yueli-dex/rules@1"`，intent 完整
   - local rule 不命中 → 调用 provider mock，intent 完整
3. **deadline 行为**：`routing.test.ts` 新增并发场景下「总耗时 < deadline × 1.1」硬断言。
4. **熔断单飞**：100 个并发请求在 cooldown 后 → 只有 1 次 execute 被允许，其余 `NO_ELIGIBLE_PROVIDER`。
5. **canonical hash**：同一请求两次构造（key 顺序不同）hash 必须一致；不同请求 hash 必须不一致（哈希集合大小 = 请求集合大小）。
6. **ActionIntent 字段**：所有 fixture 的 `toActionIntent` 输出都包含 `decisionId`、`model`、对应 question 的 `confidence`。
7. **README / skills 不再撒谎**：移除 README 中任何「routing considers cost / latency / error rate」未兑现的措辞，或在 P1-1 落地后保留；本文档作为 v0.2 changelog 入口。

---

## 8. 不破坏的边界（一句总结）

**任何 PR 触及以下任一原则即拒收**：

1. **Choice-only** —— 不引入新 schema、新 primitive、新问题类型
2. **本地规则优先** —— 任何远程调用不能绕过 local rule 短路
3. **ActionIntent 是请求不是授权** —— DEX 不增加任何「代为执行 / 代为授权」的接口

这三条也是 reviewer 在 §25-§26 强调的 DEX 真正定位，本计划所有改动都不跨越它们。
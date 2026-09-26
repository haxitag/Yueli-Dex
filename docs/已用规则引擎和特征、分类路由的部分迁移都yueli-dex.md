把「词表 + 规则」迁到 Yueli-DEX，核心不是重写业务，而是**拆成三层**：能确定的继续本地规则；模糊的改成 Choice；执行与权限仍留在你原来的 executor。

---

## 1. 对照关系（先建立映射）

| 原有机制 | Yueli-DEX 对应物 | 说明 |
|---|---|---|
| 关键词 / 正则 / 词表命中 | **RuleSet**（`equals` / `in` / 或你在进 DEX 前先归一化字段） | 确定性拦截、短路、强制路由 |
| if-else 路由表 | **`route` / `shortCircuit` / `constrain`** | 命中即本地结束，零远程 |
| 「匹配不上再默认」 | criteria 里的 **`needs_review` / `other` / `noop`** | 开放世界必留 fallback |
| 多标签、打分排序 | **一个 Choice 问题 + probabilities** | 不要多个独立词表各打一次再拼 |
| 执行动作（发工单、调 tool） | **`ActionIntent` → 你的原 executor** | DEX 不执行，映射表可复用旧 handler |
| 审计日志 | **`DecisionReceipt` + 事件** | 比词表命中日志更结构化 |

**不要**把整本词表原样塞进 `state` 或 `instructions`。词表应变成：

- 预处理产出的**结构化字段**（给规则用），或  
- Choice 的 **criteria 选项描述**（给模型/决策用）。

---

## 2. 迁移总流程（推荐顺序）

```text
① 盘点现有规则/词表
② 分成：确定规则 | 模糊分类 | 执行副作用
③ 确定规则 → RuleSet（本地）
④ 模糊分类 → Template + Choice criteria
⑤ 副作用 → Intent → 原 handler（改入口，不改实现）
⑥ 双跑对比（词表结果 vs DEX）再切流量
```

### ② 怎么分类（决策表）

| 原逻辑特征 | 迁到哪里 |
|---|---|
| 精确匹配、白/黑名单、环境开关、步数上限 | **RuleSet only** |
| 「包含某类词就倾向某队列」，可枚举、可接受漏判 | **Rule shortCircuit** 或 **Choice**（看是否要概率） |
| 语义相近、同义多、上下文依赖、置信度重要 | **Choice（模板）** |
| 命中后调 API / 改库 | **仍走原代码**，只接 Intent |

---

## 3. 词表如何转换

### 3.1 原形态（示意）

```text
billing_words: 扣款, 退款, 发票, charged twice, refund...
tech_words: 登录不了, 500, timeout, crash...
urgent_words: 立刻, 紧急, ASAP...
默认 → general
```

### 3.2 路径 A：预处理 + 本地规则（最接近旧系统）

在进 DEX **之前**用旧词表算出布尔/枚举特征（可继续用原词表引擎）：

```ts
// 保留你的词表引擎，只输出结构化特征
function featuresFromLexicon(text: string) {
  return {
    hitBilling: match(text, BILLING_WORDS),
    hitTech: match(text, TECH_WORDS),
    hitUrgent: match(text, URGENT_WORDS),
    // 可选：命中词列表（注意脱敏、截断）
  };
}
```

再写成 **RuleSet**（规则只看结构化字段，不写正则——DEX 规则语法没有 regex）：

```json
{
  "apiVersion": "yueli-dex-rules/v1",
  "rules": [
    {
      "id": "lexicon-billing-shortcircuit",
      "when": {
        "all": [
          { "path": "$.input.hitBilling", "op": "equals", "value": true },
          { "path": "$.input.hitTech", "op": "equals", "value": false }
        ]
      },
      "then": {
        "kind": "shortCircuit",
        "questionId": "handler",
        "choice": "billing"
      }
    },
    {
      "id": "prod-block-shell",
      "when": {
        "all": [
          { "path": "$.input.env", "op": "equals", "value": "prod" },
          { "path": "$.input.actionKind", "op": "in", "value": ["shell", "delete"] }
        ]
      },
      "then": { "kind": "reject", "message": "prod dangerous action blocked" }
    }
  ]
}
```

`state` / `prepare` 的 input：

```ts
const feats = featuresFromLexicon(userMessage);
await dex.templates.prepare({
  template: "support-triage",
  input: {
    message: userMessage, // 供未命中规则时走远程 Choice
    ...feats,
    env: process.env.APP_ENV,
  },
});
```

含义：

- **词表仍负责「串匹配」**（DEX 规则不擅长长文本 substring）。  
- **规则负责「命中后的策略」**（短路选谁、拒绝、强制 route）。  
- **没命中词表** → 落入 Choice，用语义补旧词表覆盖不到的同义表达。

这是多数「词表系统」最稳的迁法：**词表降级为特征抽取，策略升到 Rule + Choice**。

### 3.3 路径 B：词表条目变成 Choice 的 criteria

当「类别少、稳定、需要概率与置信度」时：

```text
原词表类别名     → criteria 的 key（choice id）
原词表说明/样例 → criteria 的 value（描述，不是标签）
```

差：

```text
billing: "billing"
high: "high"
```

好（DEX skill 强调 description not label）：

```text
billing: "账单、扣款、退款、发票、重复扣费等资金与账单问题"
technical: "登录失败、报错码、超时、崩溃等产品故障"
needs_review: "无法归入上述类别或信息不足，需人工"
```

词表里的**同义词**不要做成 200 个 choice；做成**每个类别一段描述**，同义由决策模型消化。词表可继续用来：

- 生成/维护这段描述的语料，或  
- 仅作 soft 特征：`hitBilling: true` 写进 `state`，帮助模型，但不 shortCircuit。

### 3.4 路径 C：多词表抢答 → 一个 Choice

旧逻辑常见：

```text
if billing_score > tech_score && billing_score > th → billing
else if ... → tech
else → default
```

迁到 DEX：

- **一个** `questionId`（如 `handler`）  
- criteria = 全部互斥选项 + fallback  
- 用 `probabilities` / `confidence` 替代手工比分  
- 原阈值 `th` 挪到 loop 的 `shouldEscalate`（例如 `confidence < 0.7 → needs_review`）

不要为每个词表各调一次 Choice 再拼结果。

---

## 4. 原有「规则」如何转换

### 4.1 规则动作映射

| 旧规则动作 | DEX `then.kind` |
|---|---|
| 直接定结果 / 返回固定标签 | `shortCircuit` + `questionId` + `choice` |
| 禁止继续 / 抛错 | `reject` + `message` |
| 走另一套模型或队列 | `route` → `routing.named.xxx` |
| 限制可选动作集合 | `constrain` + `allowedActionKinds` / `requireFallbackOption` |
| 命中后改写文案再给下游 | **不在 DEX**；在 Intent 之后或 prepare 之前 |

### 4.2 规则条件映射

DEX 叶子条件只有：`exists | equals | in | lt | lte | gt | gte`，路径是受限 JSON path（`$.input.*` 等）。

因此：

| 旧条件 | 做法 |
|---|---|
| `text contains "退款"` | **预处理**成 `hitRefund: true`，规则写 `equals` |
| 正则、复杂脚本 | **不要进 RuleSet**；留在预处理或放弃确定性，交给 Choice |
| `score > 0.8` | 若 score 是你算的，写入 `input.score` 后用 `gt` |
| `env == prod && role != admin` | 结构化字段 + `all` / `not` |
| 多条件与或非 | `all` / `any` / `not` |

### 4.3 Scope（叠加旧「全局规则 / 租户规则 / 单次调用规则」）

与旧系统分层对齐：

```text
template     → 模板自带默认策略（templates-core 里已有）
organization → 公司级词表策略、合规
environment  → prod/staging 差异
call         → 单次请求覆盖（慎用）
```

优先级：更高 scope 后执行，可覆盖 route/constrain（以仓库规则引擎为准）。

---

## 5. 执行层：词表命中后的 handler 怎么接

旧代码往往是：

```ts
const label = lexiconRoute(text); // "billing"
await handlers[label](ctx);
```

迁成：

```ts
const { response, intents } = await decide({ template: "support-triage", state });
const intent = intents[0]; // { choice, kind, params }

// kind/choice 映射到旧 handler 名
const handlerKey = mapIntentToHandler(intent); // 可与旧 label 同名
if (shouldEscalate(response, intent)) {
  return handlers.needs_review(ctx);
}
await handlers[handlerKey](ctx, intent.params);
```

要点：

- **handler 函数体尽量不动**，只改「谁决定 label」。  
- 模板里 `actions` 映射应让 `toActionIntent` 的 `kind` 与旧 handler 名一致，减少翻译层。

---

## 6. 一条完整转换示例

**旧逻辑：**

```text
1. 命中退款词表 → billing
2. 命中崩溃词表 → technical  
3. 命中紧急词 → 标记 priority=high（仍走上面队列）
4. 都没命中 → general
5. billing 且金额>1000 → 人工
```

**新逻辑：**

```text
预处理：hitRefund, hitCrash, hitUrgent, amount
规则：
  - hitRefund && !hitCrash → shortCircuit billing
  - hitCrash && !hitRefund → shortCircuit technical
  - amount > 1000 && hitRefund → shortCircuit needs_review
  （或 constrain 强制 fallback）
未命中规则：
  - Choice criteria: billing | technical | general | needs_review
  - state 带 message + 特征，供语义补全
Intent：
  - billing → 旧 billingHandler
评估：
  - confidence < 0.75 → needs_review（替代「词表分数不够就 default」）
```

双跑阶段：

```text
对历史 case：lexiconLabel vs dexChoice
关注：一致率、规则短路占比、仅 DEX 改判且人工确认正确的 case
```

切流：先「只记录 DEX、仍执行词表」→「低风险队列走 DEX」→ 全量。

---

## 7. 实践原则（避免迁坏）

1. **词表不要消失，先降级为特征或文档语料**；DEX 规则不做全文检索。  
2. **能 100% 确定的继续本地 shortCircuit/reject**，保证时延与可复现。  
3. **一类决策一个 question**；多词表比分合成一个 Choice。  
4. **fallback 选项必须有**，对齐旧逻辑的「default 队列」。  
5. **阈值从词表分数迁到 confidence × 动作危险度**，写在自研 loop，不写在模型里。  
6. **权限与副作用不进 DEX**；Intent 只替换「选 label」那一步。

---

## 8. 迁移检查清单

- [ ] 列出所有词表类别 → 变为 criteria keys + 描述文案  
- [ ] 列出所有确定规则 → RuleSet；含 substring 的先变特征字段  
- [ ] 默认/兜底类 → `needs_review` 或 `other`  
- [ ] 原 handler 名 ↔ Intent.kind / choice 映射表  
- [ ] 历史样本双跑报表（一致 / 规则短路 / 需人工）  
- [ ] 破坏性路径：本地 reject + 高阈值  

如果你愿意贴一段真实的词表结构（例如 JSON：类别 → 词列表）和 2～3 条典型规则，可以按你的数据写成一版可直接用的 `RuleSet` + `Choice` criteria 草稿。
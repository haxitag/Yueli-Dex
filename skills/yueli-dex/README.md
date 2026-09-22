# Yueli DEX Agent Skill

Skill package that teaches coding agents to integrate Yueli DEX (Jev `Choice`)
correctly: contract, template catalog, question design, provider routing, and
the open plugin architecture. Local rules first — rule-able policies run in
the local rule engine and never call a remote model.

## Install

### Claude Code plugin marketplace（发布就绪）

本仓库自带 marketplace 清单（`.claude-plugin/marketplace.json`），SDK 发布后即可上架。现在即可从本仓库直接安装：

```bash
# 添加本仓库为 plugin marketplace
claude plugin marketplace add haxitag/Yueli-DEX

# 安装 yueli-dex skill 插件
claude plugin install yueli-dex@yueli-dex
```

### 手动安装（repo-local / 其他代理）

复制本目录到你的 agent skill 目录，保持 `SKILL.md` 在根部：

- Claude Code: `.claude/skills/yueli-dex/`（项目）或 `~/.claude/skills/yueli-dex/`
- 其他代理：各自的 skill 目录

然后在提示词中引用："使用 yueli-dex skill" / "use the yueli-dex skill"。

## Contents

```
skills/yueli-dex/
├── .claude-plugin/plugin.json          # 插件清单（市场发布用）
├── SKILL.md                            # 入口：何时/如何使用，工作流，硬规则
└── references/                         # 按需加载
    ├── choice-contract.md              # jev-choice/v1 请求/响应 + 校验
    ├── template-catalog.md             # 四维度标签目录（主题/场景/用例/效用）
    ├── question-design.md              # 决策建模最佳实践
    ├── providers-and-routing.md        # 四种 host、路由策略、失败转移、审计
    └── plugin-architecture.md          # 组件框架、四类插件、开放式建模
```

## Companion package

`@haxitag/yueli-dex-templates-core` — the installable template pack backing
the catalog: 16 labeled `yueli-dex-template/v1` documents with example
inputs, per-template local rule sets (rule-able policies short-circuit
locally), and a call-example generator — validated by the core test suite.

## Publish checklist (pending SDK release)

1. `@haxitag/yueli-dex` 及伴生包发布到 npm；
2. 更新 `SKILL.md` 中示例代码去掉 "planned" 限定并指向已发布版本；
3. `skills/yueli-dex/.claude-plugin/plugin.json` 版本对齐 SDK 版本；
4. 推送仓库并对外公布 marketplace 安装命令。

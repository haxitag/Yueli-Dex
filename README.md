# Yueli DEX

> **From Options To Action**

Yueli DEX (`@haxitag/yueli-dex`) is a Choice-only decision framework for AI agents. It preserves Jev's standard `Choice` request and response contract while adding local rules, installable decision-modeling templates, optional LLM-assisted modeling, and reliable routing across TypeSafe, Cloudflare, Vercel, and compatible self-hosted hosts.

## Project status

The architecture, API contract, and user-facing documentation are approved. The TypeScript packages, provider adapters, CLI, tests, and published npm package have **not yet been implemented or released**. Code snippets labeled **planned SDK** describe the contract that implementation will satisfy; they are not installable today.

## What v1 supports

- Jev `Choice` only — not `Score`, `Noul`, or generic generated text.
- The standard Choice inputs: `state`, optional `model`, and `questions` with `type`, `instructions`, and `criteria`.
- The standard Choice outputs: `model`, `answers`, selected `choice`, `confidence`, `probabilities`, and optional `usage`.
- Provider routing that considers explicit policy, configured budget, observed latency, health, retry, circuit breaking, and fallback.
- Local declarative rules, scenario templates, optional LLM modeling proposals, and read-only context providers.
- An `ActionIntent` sidecar. DEX does not execute business actions, tool calls, or repository code.

## Quick contract example

```ts
// Planned SDK — not available for installation yet.
const response = await dex.choice({
  state: "My payment was charged twice and I need a refund.",
  model: "jev-latest",
  questions: {
    handler: {
      type: "choice",
      instructions: "Which team should handle this request?",
      criteria: {
        billing: "Payments, invoices, refunds, and subscriptions",
        technical: "Product bugs, incidents, and integrations",
        needs_review: "Evidence is insufficient or does not fit another option"
      }
    }
  }
});

// `response` is a native Jev-compatible Choice response.
```

## Documentation

- [Choice-only design specification](docs/superpowers/specs/2026-09-21-yueli-dex-choice-design.md)
- [调用说明与使用手册](docs/调用说明与使用手册.md)
- [初始项目规划](docs/Yueli%20DEX%EF%BC%88Decision%20Execution%EF%BC%89%E5%86%B3%E7%AD%96%E8%B7%AF%E7%94%B1%E3%80%81%E5%BB%BA%E6%A8%A1%E5%92%8C%E6%9C%8D%E5%8A%A1%E7%A8%B3%E5%AE%9A%E8%B7%AF%E7%94%B1%E7%BB%84%E4%BB%B6.md)

## Compatibility references

- [TypeSafe Choice](https://docs.typesafe.ai/primitives/choice)
- [TypeSafe HTTP quick start](https://docs.typesafe.ai/introduction/quickstart)
- [Cloudflare `typesafe/jev`](https://developers.cloudflare.com/ai/models/typesafe/jev/)
- [Vercel AI Gateway and Jev](https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk)

## License

No project license has been selected yet.

# Component Framework & Open Plugin Architecture

## Three-layer decision chain

```
business input + approved context snapshots
                │
        ① local rule engine          deterministic, importable, auditable
                │
      ┌─────────┴──────────┐
② scenario/template   ③ optional LLM modeler
  compile (data-only)   bounded ModelingProposal only
      └─────────┬──────────┘
        canonical Jev Choice request
                │
   policy-governed host router (TypeSafe/CF/Vercel/self-hosted)
                │
  Choice response + DecisionReceipt + ActionIntent
```

- Layer ① wraps everything: it can `reject`, `constrain`, `route`, and
  `shortCircuit` (a deterministic, honestly-labeled synthetic Choice with
  `model: "yueli-dex/rules@1"`).
- Layers ② and ③ are **parallel** paths, not sequential. A matching template
  compiles directly to a request with zero LLM involvement; the modeler runs
  only when no template fits or a template opened an extension slot.

## Packages

| Package | Role |
| --- | --- |
| `@haxitag/yueli-dex` | Choice API, validation, rules, routing, receipts, plugin registry |
| `@haxitag/yueli-dex-plugin-sdk` | Versioned contracts for all four plugin kinds |
| `@haxitag/yueli-dex-provider-{typesafe,cloudflare,vercel,http}` | Host adapters (transport + auth only) |
| `@haxitag/yueli-dex-templates-core` | Labeled base template pack (16 scenarios) |
| `@haxitag/yueli-dex-cli` | Validation, provider probes, fixture execution |
| `packages/playground` | Interactive debugger for decisions and provider calls |

## Open plugin system (yueli-dex-plugin/v1)

Every plugin declares one manifest; installation validates it. Nothing is
string-loaded at runtime.

```json
{
  "apiVersion": "yueli-dex-plugin/v1",
  "id": "@acme/private-jev-provider",
  "kind": "provider",
  "version": "1.0.0",
  "requires": { "yueliDex": "^0.1.0" },
  "capabilities": ["choice"],
  "configSchema": "./config.schema.json",
  "entry": "./dist/index.js"
}
```

Four plugin kinds, one responsibility each:

| Kind | May do | May never do |
| --- | --- | --- |
| `provider` | Send the unchanged Choice request; return a validated Choice response | Mutate questions/options/answers; log credentials |
| `template-pack` | Ship declarative, data-only templates + metadata | Execute code |
| `modeler` | Produce bounded `ModelingProposal`s with evidence refs | Call a host directly; execute actions |
| `context-provider` | Read-only, path-allowlisted, redacted, token-budgeted snapshots | Execute repo code; leak secrets |

Extension points for **open modeling**:

- Templates expose `modeling.mode` (`off`/`optional`/`required`) with
  field-level `allow` flags (`refineInstructions`, `addCriteria`,
  `changeActionKinds`) — a template authors exactly how much a modeler may
  extend it.
- Proposals must survive schema → template-permission → local-rule →
  path/redaction/budget validation before compiling into a request; the diff
  and provenance are recorded in the receipt.
- Organization-level policy can admit template-less dynamic requests, but
  those carry **no ActionIntent mapping** — actionable results require a
  published template. This keeps the "who may define actions" boundary explicit.

## Safety boundaries (v1 fixed decisions)

1. Choice is the only supported primitive — no Score, no Noul, no text generation.
2. The response is the provider's response; audit and action metadata are sidecars.
3. Templates and LLM modeling are parallel preparation paths.
4. Modeling is optional, constrained, auditable; it cannot bypass policy.
5. Rules may short-circuit with an honestly labeled synthetic response.
6. Routing is deterministic policy + observed signals; no request mutation;
   no retry of valid low-confidence decisions.
7. Template actions are intents only; side effects stay out of scope.

# Providers & Routing

DEX sends one canonical Choice request to one host selected by declarative
policy. Routing never mutates the request body.

## Hosts

| Host | Package | Transport |
| --- | --- | --- |
| TypeSafe | `@haxitag/yueli-dex-provider-typesafe` | `POST https://api.typesafe.ai/v1/systemone` (model `jev-latest`) |
| Cloudflare | `@haxitag/yueli-dex-provider-cloudflare` | Workers AI binding `env.AI.run("typesafe/jev")` or Account REST `/ai/run` |
| Vercel | `@haxitag/yueli-dex-provider-vercel` | AI Gateway evaluation (`typesafe-ai/jev`), OIDC or bearer token |
| Self-hosted | `@haxitag/yueli-dex-provider-http` | Any service declaring `jev-choice/v1` compatibility |

Self-hosted services must accept and return the canonical Choice body.
Field-name drift, label-only responses, or unnormalized probabilities are not
`jev-choice/v1` — write a dedicated provider plugin instead of coercing.

## Configuration sketch

```yaml
providers:
  - id: typesafe-primary
    plugin: "@haxitag/yueli-dex-provider-typesafe"
  - id: cf-edge
    plugin: "@haxitag/yueli-dex-provider-cloudflare"

routes:
  default:
    prefer: [cf-edge, typesafe-primary]
    limits:
      maxEstimatedCostUsd: 0.002
      p95LatencyMs: 900
      maxAttempts: 2
      circuitFailureThreshold: 3
      circuitCooldownMs: 60000
      retryableStatusCodes: [429, 500, 502, 503, 504]
```

## Selection order

1. Local rules filter eligible hosts (allowlist, policy route).
2. Exclude hosts lacking credentials, Choice capability, budget headroom, or
   with an open circuit.
3. Order by configured priority with penalties for recent P95 latency, error
   rate, and estimated cost; call one host.

## Failover semantics

- Retrying/failing over is allowed **only** for: connection failure, timeout,
  configured transient 5xx, rate limit.
- Auth, schema, and validation errors surface immediately with provider
  identity — they are config bugs, not instability.
- A **valid low-confidence response ends the sequence**. Never re-route to
  chase confidence.

## Credentials & cost

- Keys come from environment variables or host secret bindings only — never
  in templates, manifests, receipts, or logs. Multiple keys can be pooled and
  round-robined (`TYPESAFE_API_KEYS=sk_a,sk_b,sk_c`).
- Input is billed (~$0.042/MTok across hosts), output tokens are effectively
  free; context window is 32k input. Estimate cost per route and enforce
  `maxEstimatedCostUsd`.

## Audit

Every attempt lands in the `DecisionReceipt`: request hash, template/rule
versions, eligible and selected hosts, per-attempt timing and failure class.
Subscribe via `dex.on("choice.completed" | "choice.failed", ...)`.

# Yueli DEX Choice-Only Design

**Status:** approved design

**Package:** `@haxitag/yueli-dex`
**Versioned contracts:** `jev-choice/v1`, `yueli-dex-plugin/v1`, `yueli-dex-template/v1`

## 1. Purpose and scope

Yueli DEX is an open-source Decision Execution Framework for AI agents. Its core promise is **From Options To Action**: turn trusted context, a well-defined question, and distinguishable candidate options into an executable, inspectable `Choice` decision.

The first release supports exactly one Jev primitive: **Choice**. A Choice selects one candidate from a fixed set and returns the selected option, full probability distribution, and confidence. The public request and response remain compatible with Jev's existing Choice API.

DEX supplies the integration and modeling layers around that primitive:

1. Local, deterministic rules for constraints and host routing.
2. Installable industry, scenario, and use-case templates that construct Choice requests.
3. Optional LLM-assisted modeling that proposes a question and candidates only when a suitable template is unavailable or explicitly permits an extension.

The framework supports TypeSafe's hosted Jev endpoint, Cloudflare, Vercel, and self-hosted Jev-compatible services. Routing chooses a host for the same Choice request based on explicit policy, cost, latency, and service health.

## 2. Non-goals

The first release does not support Jev `Score`, `Noul`, generic text generation, arbitrary LLM structured-output emulation, or a second decision API.

DEX does not mutate a valid provider Choice answer, claim that type safety proves semantic correctness, or automatically execute a tool, business operation, or repository code. Templates may map an answer to an `ActionIntent`; a downstream application remains responsible for authorization and execution.

## 3. Canonical Choice contract

### 3.1 Request

The `choice()` method accepts the same semantic shape as a TypeSafe System One request. It forwards this shape to a selected provider adapter; DEX-only routing and audit data never enter the request body.

```ts
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface ChoiceQuestion {
  readonly type: "choice";
  readonly instructions: JsonValue;
  readonly criteria: Readonly<Record<string, JsonValue>>;
}

export interface ChoiceRequest {
  readonly state: JsonValue;
  readonly model?: string;
  readonly questions: Readonly<Record<string, ChoiceQuestion>>;
}
```

`questions` may contain several Choice questions. Each question is independent and each `criteria` key is the stable option identifier. The schema permits the structured instructions and criteria supported by TypeSafe, but a template normally starts with concise strings. A compiler must reject a request with zero questions, a non-Choice question, duplicate option identifiers, or more than 255 options in a question.

### 3.2 Response

```ts
export interface ChoiceAnswer {
  readonly type: "choice";
  readonly choice: string;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

export interface ChoiceResponse {
  readonly model: string;
  readonly answers: Readonly<Record<string, ChoiceAnswer>>;
  readonly usage?: {
    readonly input_tokens: number;
    readonly output_tokens: number;
  };
}
```

The core validates that every answer has `type: "choice"`, names an option that appeared in the corresponding request, has confidence in `[0, 1]`, and has a finite non-negative probability for every requested criterion key. The probability-key set must exactly equal the question's criterion-key set, and the sum must equal `1` within a documented numeric tolerance. Providers may attach no opaque data to this returned object.

### 3.3 Public API

```ts
export interface Dex {
  choice(request: ChoiceRequest, options?: ChoiceCallOptions): Promise<ChoiceResponse>;
  on(event: "choice.completed" | "choice.failed", listener: DexEventListener): Unsubscribe;
  templates: TemplateRegistry;
  modeling: ModelingRegistry;
}

export function createDex(config: DexConfig): Dex;
```

```ts
export interface ChoiceCallOptions {
  /** A route name declared in DexConfig.routing; an unknown name is rejected. */
  readonly route?: string;
  /** Positive wall-clock deadline in milliseconds; policy may impose a smaller maximum. */
  readonly deadlineMs?: number;
}

export type Unsubscribe = () => void;

export type DexEventListener = (event: {
  readonly request: ChoiceRequest;
  readonly response?: ChoiceResponse;
  readonly receipt: DecisionReceipt;
  readonly error?: DexError;
}) => void;

export interface DexConfig {
  readonly providers: readonly ChoiceProvider[];
  readonly routing: RoutingConfig;
  readonly ruleSets?: readonly RuleSet[];
  readonly templates?: readonly TemplatePack[];
  readonly modelers?: readonly Modeler[];
  readonly contextProviders?: readonly ContextProvider[];
  readonly receiptStore?: ReceiptStore;
}
```

`ChoiceCallOptions` can select an approved route or set a call deadline, but cannot replace local policy. The only model-decision call is `choice()`. Template preparation and LLM modeling only construct a `ChoiceRequest`, which callers then pass to `choice()`.

`TemplateRegistry.prepare()` receives a template reference, validated input, and optional approved context references, then returns a `ChoiceRequest`. `TemplateRegistry.toActionIntent()` receives a template reference, request, and response and returns zero or more declared `ActionIntent` values. `ModelingRegistry.propose()` receives an explicit modeler reference, a template reference or modeling brief, and approved context references; it returns a `ModelingProposal`. `ModelingRegistry.accept()` validates that proposal against the selected template and active rules before returning a `ChoiceRequest`.

```ts
export interface ActionIntent {
  readonly template: { readonly id: string; readonly version: string };
  readonly questionId: string;
  readonly choice: string;
  readonly kind: string;
  readonly params?: JsonValue;
}

export interface ModelingProposal {
  readonly id: string;
  readonly modelerId: string;
  readonly template?: { readonly id: string; readonly version: string };
  readonly proposedRequest: ChoiceRequest;
  readonly evidenceRefs: readonly string[];
  readonly routeHint?: string;
}

export interface TemplateRegistry {
  prepare(input: {
    readonly template: string;
    readonly input: JsonValue;
    readonly context?: readonly ContextSnapshot[];
  }): Promise<ChoiceRequest>;
  toActionIntent(input: {
    readonly template: string;
    readonly request: ChoiceRequest;
    readonly response: ChoiceResponse;
  }): readonly ActionIntent[];
}

export interface ModelingRegistry {
  propose(input: {
    readonly modeler: string;
    readonly template?: string;
    readonly brief?: string;
    readonly input: JsonValue;
    readonly context?: readonly ContextSnapshot[];
  }): Promise<ModelingProposal>;
  accept(proposal: ModelingProposal): Promise<ChoiceRequest>;
}

export interface RoutePolicy {
  readonly providerIds: readonly string[];
  readonly maxEstimatedCostUsd?: number;
  readonly p95LatencyMs?: number;
  readonly maxAttempts: number;
  readonly circuitFailureThreshold: number;
  readonly circuitCooldownMs: number;
  readonly retryableStatusCodes?: readonly number[];
}

export interface RoutingConfig {
  readonly default: RoutePolicy;
  readonly named?: Readonly<Record<string, RoutePolicy>>;
}

export interface RuleSet {
  readonly id: string;
  readonly version: string;
  readonly scope: "template" | "organization" | "environment" | "call";
  readonly document: JsonValue;
}

export interface TemplatePack {
  readonly id: string;
  readonly version: string;
  readonly templates: readonly JsonValue[];
}

export interface Modeler {
  readonly id: string;
  propose(input: {
    readonly template?: { readonly id: string; readonly version: string };
    readonly brief?: string;
    readonly input: JsonValue;
    readonly context: readonly ContextSnapshot[];
  }): Promise<ModelingProposal>;
}

export interface ContextSnapshot {
  readonly providerId: string;
  readonly uri: string;
  readonly content: JsonValue;
  readonly redactionApplied: boolean;
}

export interface ContextProvider {
  readonly id: string;
  snapshot(request: {
    readonly paths: readonly string[];
    readonly maxTokens: number;
    readonly redact: readonly string[];
  }): Promise<readonly ContextSnapshot[]>;
}

export interface ReceiptStore {
  append(receipt: DecisionReceipt): Promise<void>;
}
```

### 3.4 Auditing sidecar

The response is not wrapped. Instead, a `choice.completed` event provides an immutable `DecisionReceipt` alongside the original request and response:

```ts
export interface DecisionReceipt {
  readonly decisionId: string;
  readonly requestHash: string;
  readonly template?: { readonly id: string; readonly version: string };
  readonly rules: readonly { readonly id: string; readonly version: string }[];
  readonly route: {
    readonly eligibleProviderIds: readonly string[];
    readonly selectedProviderId: string;
    readonly attempts: readonly ProviderAttempt[];
  };
  readonly timing: { readonly startedAt: string; readonly elapsedMs: number };
  readonly usage?: ChoiceResponse["usage"];
}

export interface ProviderAttempt {
  readonly providerId: string;
  readonly startedAt: string;
  readonly elapsedMs: number;
  readonly outcome: "success" | "failed" | "timed_out" | "rate_limited";
  readonly failureCode?: DexErrorCode;
}
```

It contains no credential, raw secret, or unredacted sensitive context. A receipt is linked by `decisionId`; it is not stored in process-global "last result" state and is therefore safe for concurrent calls.

## 4. Component architecture

```text
business input + approved context snapshots
                 |
          local rule engine
                 |
       +---------+----------+
       |                    |
scenario/template compiler  optional LLM modeler
       |                    |
       +---------+----------+
                 |
      canonical Jev Choice request
                 |
     policy-governed host router
                 |
standard Choice response + DecisionReceipt + ActionIntent
```

The scenario/template compiler and optional LLM modeler are parallel paths. A template does not require an LLM. If an existing template can compile the input, it proceeds directly to `choice()`. The modeler is invoked only when the caller selects it, no template matches, or a matching template has explicitly allowed a bounded extension.

### 4.1 Packages

| Package | Responsibility |
| --- | --- |
| `@haxitag/yueli-dex` | Choice API, validation, rules, routing, receipt events, plugin registry |
| `@haxitag/yueli-dex-plugin-sdk` | Versioned provider, template, modeler, and context-provider contracts |
| `@haxitag/yueli-dex-provider-typesafe` | Official TypeSafe System One HTTP provider |
| `@haxitag/yueli-dex-provider-cloudflare` | Cloudflare Workers AI and Account REST provider |
| `@haxitag/yueli-dex-provider-vercel` | Vercel AI Gateway provider |
| `@haxitag/yueli-dex-provider-http` | Standard self-hosted `jev-choice/v1` provider |
| `@haxitag/yueli-dex-templates-*` | Versioned, installable template packs |
| `@haxitag/yueli-dex-cli` | Template/config validation, provider probes, and fixture execution |

## 5. Local rule engine

Rules are versioned JSON or YAML documents evaluated by a restricted, declarative interpreter. Imported rules never execute arbitrary JavaScript. Rule precedence is deterministic: template default, organization policy, environment policy, then per-call policy. A higher scope may narrow permission but cannot broaden a stronger policy.

Rules may take only four actions:

| Action | Effect |
| --- | --- |
| `reject` | Reject invalid, disallowed, or unsafe input before a provider call |
| `constrain` | Enforce candidate limits, fallback options, action-kind allowlists, and state requirements |
| `route` | Define eligible hosts, order, cost budget, latency SLO, retry and circuit policy |
| `shortCircuit` | Emit a deterministic, Jev-compatible Choice response when a rule is conclusive |

`shortCircuit` produces a standard Choice envelope with `model: "yueli-dex/rules@1"`, a selected permitted option, probability `1`, and confidence `1`. Its `DecisionReceipt` identifies the matching rule. DEX never labels this as a remote Jev result.

Rules run before request construction, before routing, and after response validation. Post-response rules may reject or produce an ActionIntent but cannot alter a valid provider answer.

### 5.1 Rule document grammar

The v1 rule document supports only JSON-path comparisons over the validated input, compiled request, route facts, and validated response. It has no function invocation, interpolation, regular expression, remote lookup, or time-dependent expression.

```yaml
apiVersion: yueli-dex-rules/v1
rules:
  - id: require-review-for-unclassified
    when:
      all:
        - path: $.compiled.questions.handler.criteria.needs-review
          op: exists
    then:
      kind: constrain
      requireFallbackOption: needs-review

  - id: use-local-known-tenant-route
    when:
      all:
        - path: $.input.tenantTier
          op: equals
          value: regulated
    then:
      kind: route
      route: regulated-primary
```

Valid operators are `exists`, `equals`, `in`, `lt`, `lte`, `gt`, and `gte`; values compare only JSON scalars. A condition tree has exactly one of `all`, `any`, `not`, or a leaf comparison. `then.kind` is exactly `reject`, `constrain`, `route`, or `shortCircuit`. `shortCircuit` must name an existing question and criterion key; the engine constructs the full normalized distribution with zero probability for every non-selected criterion.

## 6. Templates and ActionIntent

A template is a declarative, data-only package by default. It declares an input schema, allowed context sources, state mapping, Choice questions, candidate criteria, constraints, and optional option-to-intent mappings.

```yaml
apiVersion: yueli-dex-template/v1
id: support-triage
version: 1.0.0

inputSchema: ./ticket.schema.json
state:
  from:
    message: $.message
    accountPlan: $.account.plan

choices:
  - id: handler
    instructions: Which team should own this request?
    criteria:
      billing: Payments, invoices, refunds, and subscriptions
      technical: Product bugs, incidents, and integrations
      needs-review: Evidence is insufficient or spans multiple teams

constraints:
  requireFallbackOption: needs-review
  maxOptions: 12

actions:
  handler:
    billing: { kind: queue.assign, queue: billing }
    technical: { kind: queue.assign, queue: technical }
    needs-review: { kind: review.request }

modeling:
  mode: optional
  allow:
    refineInstructions: true
    addCriteria: false
    changeActionKinds: false
  requireEvidenceRefs: true
```

The compiler turns a validated template plus input into a `ChoiceRequest`. `toActionIntent()` is a pure mapping from the template, request, and response to declared intent data. It cannot call a queue, tool, API, or repository command.

Templates with executable custom compilers are a separately trusted plugin category, never the default for a downloaded template. Pure data packs are preferred for portability, reviewability, and safety.

## 7. Optional LLM-assisted modeling

A modeler returns a `ModelingProposal`, not a provider result and not an executable action. A proposal may contain a revised state projection, question wording, candidate criteria, evidence references, and a host-routing suggestion.

Before acceptance, DEX validates the proposal against the template's extension policy and local rules:

1. schema validity, stable option IDs, candidate count, and no duplicate keys;
2. mutually distinguishable candidates, required fallback option, and allowed action kinds;
3. approved context evidence, path allowlists, redaction, and token budget;
4. host and cost policy compliance;
5. proposal diff and provenance recorded in the receipt.

Only an accepted proposal becomes a `ChoiceRequest`. A modeler cannot directly invoke a host, modify the selected answer, or execute an action. Dynamic candidate additions require an explicitly configured template slot; otherwise, the proposal remains a human-reviewable suggestion.

When no template applies, a proposal may still be accepted under an organization-level dynamic-modeling policy, but it has no `ActionIntent` mapping. It must include evidence references and a complete Choice request, and is subject to the same global rule, route, and audit controls. A caller that needs an actionable result must publish or select a template first.

`ContextProvider` plugins expose read-only, snapshot-based data. A repository provider must enforce configured path allowlists, block traversal, redact sensitive paths and values, and enforce a token budget. It never executes repository code.

## 8. Plugin contract

Every plugin declares a manifest:

```json
{
  "apiVersion": "yueli-dex-plugin/v1",
  "id": "@haxitag/yueli-dex-provider-typesafe",
  "kind": "provider",
  "version": "0.1.0",
  "requires": { "yueliDex": "^0.1.0" },
  "capabilities": ["choice"],
  "configSchema": "./config.schema.json",
  "entry": "./dist/index.js"
}
```

Plugin kinds are:

| Kind | Permitted responsibility |
| --- | --- |
| `provider` | Send canonical Choice requests and return canonical Choice responses |
| `template-pack` | Provide declarative template data and metadata |
| `modeler` | Produce bounded `ModelingProposal` values |
| `context-provider` | Produce read-only, redacted context snapshots |

The core validates manifest version, plugin configuration, and declared capabilities at registration. Installed executable plugins are trusted application code and require an explicit installation decision; template packs are data-only by default. Secrets are referenced from environment variables or host secret bindings, never placed in manifests, route files, templates, receipts, or logs.

### 8.1 Provider adapter

```ts
export interface ChoiceProvider {
  readonly manifest: ProviderManifest;
  health(context: ProviderHealthContext): Promise<ProviderHealth>;
  execute(request: ChoiceRequest, context: ProviderCallContext): Promise<ChoiceResponse>;
}

export interface ProviderManifest {
  readonly id: string;
  readonly apiVersion: "yueli-dex-plugin/v1";
  readonly kind: "provider";
  readonly version: string;
  readonly capabilities: readonly ["choice", ...string[]];
}

export interface ProviderHealthContext {
  readonly now: string;
  readonly deadlineMs: number;
}

export interface ProviderHealth {
  readonly available: boolean;
  readonly observedP95LatencyMs?: number;
  readonly recentErrorRate?: number;
}

export interface ProviderCallContext {
  readonly decisionId: string;
  readonly requestHash: string;
  readonly deadlineMs: number;
  readonly attempt: number;
}
```

The adapter is responsible for transport and host authentication only. It receives the unchanged canonical request and must produce a valid canonical response.

- The TypeSafe provider calls `POST https://api.typesafe.ai/v1/systemone`.
- The Cloudflare provider supports Workers AI binding and Account REST for `typesafe/jev`.
- The Vercel provider uses its documented evaluation/Gateway integration.
- The standard HTTP provider calls a self-hosted service that declares `jev-choice/v1` compatibility.

A non-compatible Jev-like service must supply an explicit provider adapter. The generic HTTP provider does not guess alternative field names or silently coerce foreign response formats.

## 9. Host routing and reliability

Routing never changes the request body. It first filters providers by policy, credentials, declared Choice support, circuit state, model support, and estimated budget. It then orders eligible hosts by configured priority with penalties for recent P95 latency, error rate, and estimated request cost.

```yaml
providers:
  - id: typesafe-primary
    plugin: "@haxitag/yueli-dex-provider-typesafe"
  - id: cf-edge
    plugin: "@haxitag/yueli-dex-provider-cloudflare"
  - id: private-jev
    plugin: "@acme/private-jev-provider"

routes:
  - when:
      template: support-triage
    prefer: [cf-edge, typesafe-primary, private-jev]
    limits:
      maxEstimatedCostUsd: 0.002
      p95LatencyMs: 900
      maxAttempts: 2
```

Only a connection failure, timeout, configured transient server error, or configured rate limit permits a retry or failover. Authentication, configuration, schema, and response-validation errors are surfaced with their provider identity and do not silently retry another host unless a policy explicitly permits it. A valid low-confidence Choice response is never retried: low confidence is useful decision information, not service instability.

Every provider attempt uses one decision correlation ID and one request hash. Receipts preserve ordering, timestamps, selected host, failed attempts, and failure class. Metrics calculate observed latency and availability; configured costs remain estimates unless a host supplies billable usage information.

## 10. Errors and safety

```ts
export type DexErrorCode =
  | "RULE_REJECTED"
  | "TEMPLATE_INVALID"
  | "MODELING_PROPOSAL_REJECTED"
  | "NO_ELIGIBLE_PROVIDER"
  | "PROVIDER_AUTH"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_FAILURE"
  | "INVALID_CHOICE_RESPONSE";

export class DexError extends Error {
  readonly code: DexErrorCode;
  readonly decisionId: string;
  readonly providerId?: string;
  readonly recoveryHint?: string;
}
```

Error data includes the decision ID, safe rule/template/provider identifiers, and recovery hint. It omits credentials, raw protected state, and unredacted repository material. Router status exposes a reason for exclusion without exposing security-sensitive health internals.

## 11. Verification strategy and acceptance gates

### 11.1 Unit and property tests

- Validate all request, response, manifest, rule, template, and proposal schemas.
- Assert response invariants: valid option selection, probability domains, and normalized distributions.
- Test rule precedence, constraint enforcement, rejection, and deterministic short-circuit receipts.
- Test state mappings, template compilation, intent mapping, and no side effects from `toActionIntent()`.
- Test dynamic proposal rejection for prohibited fields, duplicate candidates, absent fallback option, exceeding 255 options, path traversal, disallowed action kind, missing provenance, and secret leakage.

### 11.2 Provider contract tests

- Use captured, redacted fixtures for TypeSafe, Cloudflare, Vercel, and `jev-choice/v1` HTTP requests and responses.
- Assert every adapter preserves the canonical Choice semantics.
- Exercise authentication failure, malformed body, 429, timeout, transient 5xx, and malformed response paths.

### 11.3 Router tests

- Cover configured preference, budget filtering, P95 latency penalty, health/circuit exclusion, retry bounds, failover, and all-host failure.
- Assert valid low-confidence responses end the attempt sequence.
- Assert request hash and decision ID remain stable across retries and no receipt includes a secret.

### 11.4 End-to-end tests

- Run a deterministic local `jev-choice/v1` fixture server in continuous integration.
- Run static-template, optional-modeler, local-rule short-circuit, and multi-provider failover scenarios through the public SDK and CLI.
- Run real TypeSafe, Cloudflare, and Vercel smoke tests only when explicit test credentials are present. Record observed host result, latency, and usage independently; a passing smoke test proves integration at that time, not reliability, price, or SLA.

### 11.5 Completion gate

The implementation is ready for review only when all packages build, all deterministic test suites pass, all four provider contracts pass, the full three-layer flow is reproducible against the local fixture server, template and modeler changes produce receipts, and live smoke outcomes are reported separately from local verification.

## 12. Source alignment

This design preserves TypeSafe Choice's request and response semantics: bounded criteria, selected option, probabilities, and confidence. It follows Cloudflare's documented `typesafe/jev` request/response model and treats Vercel as a transport/provider integration rather than a new decision contract. It uses the Jev ecosystem lesson that local policy owns what happens after a decision; a provider answer does not independently authorize a side effect.

Primary integration references:

- [TypeSafe Choice](https://docs.typesafe.ai/primitives/choice)
- [TypeSafe HTTP quick start](https://docs.typesafe.ai/introduction/quickstart)
- [Cloudflare `typesafe/jev`](https://developers.cloudflare.com/ai/models/typesafe/jev/)
- [Vercel AI Gateway and Jev](https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk)

## 13. Decisions fixed by this specification

1. Choice is the sole supported Jev primitive in v1.
2. The DEX response is the original Choice response; audit and action metadata are sidecars.
3. Templates and LLM modeling are parallel preparation paths, not a mandatory sequential chain.
4. LLM modeling is optional, constrained, auditable, and cannot bypass template or local policy.
5. Local rules may short-circuit with an honestly labeled synthetic Choice response.
6. Host routing is deterministic policy plus observed operational signals, with no request mutation and no retry of valid low-confidence decisions.
7. Template-defined actions are intents only; external side effects remain out of scope for DEX v1.

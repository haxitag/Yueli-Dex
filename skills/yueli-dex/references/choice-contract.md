# Choice Contract (jev-choice/v1)

The canonical Jev Choice request/response. DEX preserves this shape verbatim —
routing and audit data never enter the request body, and the response is never
wrapped.

## Request

```ts
interface ChoiceRequest {
  state: JsonValue;                        // string | number | boolean | null | array | object
  model?: string;                          // interpreted by the selected host
  questions: Record<string, ChoiceQuestion>;
}

interface ChoiceQuestion {
  type: "choice";
  instructions: JsonValue;                 // ONE bounded judgment
  criteria: Record<string, JsonValue>;     // stable option id -> distinguishable description
}
```

Rules:

- `state` holds only facts relevant to the questions and authorized for the
  selected host.
- Every question is `type: "choice"`; multiple questions are evaluated in
  parallel and independently within one request.
- `criteria` keys are stable machine identifiers; values describe the boundary
  between options in natural language (or structured examples).
- Hard limits: at least one question; ≤255 options per question; no duplicate
  option ids.

## Response

```ts
interface ChoiceResponse {
  model: string;
  answers: Record<string, ChoiceAnswer>;
  usage?: { input_tokens: number; output_tokens: number };
}

interface ChoiceAnswer {
  type: "choice";
  choice: string;                          // must exist in the request criteria
  confidence: number;                      // [0, 1]
  probabilities: Record<string, number>;   // full distribution over criteria keys
}
```

DEX validates, before returning a response to the caller:

1. every answer has `type: "choice"`;
2. the selected key exists in the corresponding request criteria;
3. the probability key set exactly equals the criteria key set;
4. every probability and the confidence lie in `[0, 1]`;
5. the probabilities sum to 1 within numeric tolerance (providers round to
   two decimals — never re-normalize yourself).

## Error surface

`RULE_REJECTED`, `TEMPLATE_INVALID`, `MODELING_PROPOSAL_REJECTED`,
`NO_ELIGIBLE_PROVIDER`, `PROVIDER_AUTH`, `PROVIDER_TIMEOUT`,
`PROVIDER_RATE_LIMIT`, `PROVIDER_FAILURE`, `INVALID_CHOICE_RESPONSE`.

Auth/schema/config errors fail loudly with the provider identity; only
connection failures, timeouts, rate limits, and configured transient 5xx may
trigger failover. A valid low-confidence answer ends the attempt sequence.

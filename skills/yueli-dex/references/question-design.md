# Question Design & Decision Modeling

The hardest integration failure is a badly modeled question, not a bad API.
Decision Quality = Model Quality × Decision Modeling Quality — you own the
second factor.

## Atomic questions

Split compound judgments; compose in code.

| Bad (compound) | Good (atomic) |
| --- | --- |
| "Rate this pull request" | `test_coverage` / `doc_quality` / `description_clarity`, weighted in code |
| "Is this ticket a priority?" | `urgency` / `business_impact` / `customer_tier` |
| "Should the agent run this command?" | `is_destructive` / `touches_production` / `command_category` |

Parallel questions in one request are evaluated independently — adding a
question never perturbs the others (unlike one LLM generation).

## Criteria: descriptions, not labels

- `'Blocking with no workaround'` gives the model something to match; `'high'`
  does not.
- Values may be strings, arrays of example phrases, or structured objects.
- Options must be **mutually distinguishable**; if two criteria overlap, merge
  them or sharpen the boundary text.
- Always include a fallback (`needs_review` / `other`) for open-world inputs.
- >255 real options means the question is wrong — restructure hierarchically
  (one Choice picks a category, a second picks within it) instead of listing.

## State: focused and authorized

- Send only the fields the judgment depends on, not the whole record — this
  is the input-token bill and the privacy surface.
- Never place secrets, credentials, or unredacted PII in `state`.
- Structured state beats prose: `{message, plan, region, previousTickets}`
  routes better than a stringified ticket dump.

## Thresholds and branching

- Set thresholds **per action risk**, not per model:
  read-only/display ~0.7; side-effecting ~0.85; destructive ≥0.9 + confirmation.
- Use the dual gate: `confidence` (distribution concentration) AND the selected
  option's own probability. Either below threshold → human review path.
- `0.5` probability on a binary question means "no evidence", not "maybe yes".
- Never re-roll a valid low-confidence answer on another host to chase a
  higher number — you would be selecting noise.

## Classification vs authorization

A Choice can tell you "the customer requests a refund" or "this command looks
destructive". Whether to refund, or to execute, is a **rule/policy check** on
account state, permissions, and limits — never the model's job. Keep those in
the local rule engine or your application logic.

## Calibration

- Validate thresholds against labeled data before shipping; adjust criteria
  descriptions where errors concentrate, then re-measure.
- Keep questions, options, and thresholds centralized in one reviewable place
  (a template pack or a single config module) — AI is bad at authoring them
  unattended; make human review easy.

## When to use the LLM modeler

Only when: no template fits (~70% match threshold), the template explicitly
opened a modeling slot, or the caller explicitly requests dynamic modeling.
The modeler emits a `ModelingProposal` (question + candidates + evidence +
route hint) that must pass schema, template-permission, rule, path, redaction,
and budget checks before it becomes a callable request. It can never call a
host, alter an answer, or execute an action itself.

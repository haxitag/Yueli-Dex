/* End-to-end tiered decision test:
   L1 deterministic rule short-circuits before L2 (mock-jev) is asked.
   Run createDex with TEMPLATES_CORE_PACK + LOCAL_RULE_SETS and assert
   receipt.route.shortCircuit fires for inputs that trigger a local rule. */
import { createDex } from "@haxitag/yueli-dex";
import {
  TEMPLATES_CORE_PACK,
  LOCAL_RULE_SETS,
  TEMPLATES,
} from "@haxitag/yueli-dex-templates-core";
import { createMockJevProvider } from "./src/lib/mock-jev-provider.ts";

const mockProvider = createMockJevProvider({ id: "mock-jev" });

function buildDexFor(templateId) {
  return createDex({
    providers: [mockProvider],
    routing: {
      default: {
        providerIds: ["mock-jev"],
        maxAttempts: 1,
        circuitFailureThreshold: 3,
        circuitCooldownMs: 60000,
      },
    },
    templates: [TEMPLATES_CORE_PACK],
    ruleSets: LOCAL_RULE_SETS[templateId] ?? [],
  });
}

/** Each case calls a template by id, with an input that should hit a local rule. */
const cases = [
  {
    templateId: "code-review-gate",
    input: { title: "x", description: "y", diff: "z" }, // missing testDelta -> request_tests
    expectChoice: "request_tests",
    tier: "L1",
  },
  {
    templateId: "chunk-triage",
    input: {
      chunkId: "x:1",
      chunkText: "out",
      goal: "g",
      provenance: { tool: "Bash" }, // Bash output -> keep_verbatim
    },
    expectChoice: "keep_verbatim",
    tier: "L1",
  },
  {
    templateId: "claim-verify",
    input: { claim: "foo", evidence: "" }, // empty evidence -> unsupported
    expectChoice: "unsupported",
    tier: "L1",
  },
  {
    templateId: "realtime-action",
    input: { tickHz: 9, state: { player: { grounded: false }, hazards: [], goal: "g" } }, // airborne -> defend
    expectChoice: "defend",
    tier: "L1",
  },
  {
    templateId: "graph-traverse",
    input: {
      goal: "g",
      currentNode: { label: "a", depth: 6 },
      candidateEdges: ["b", "c"],
      found: false,
      budget: { topK: 1, maxDepth: 5 },
    }, // depth>=maxDepth -> backtrack
    expectChoice: "backtrack",
    tier: "L1",
  },
  {
    templateId: "extract-field",
    input: { field: "v", context: "" }, // candidates missing -> not_found
    expectChoice: "not_found",
    tier: "L1",
  },
  {
    templateId: "startup-pitch",
    input: { idea: "x", goal: "y", context: "z" }, // too short -> needs_review
    expectChoice: "needs_review",
    tier: "L1",
  },
  // L2 fallback: no local rule fires, mock-jev answers.
  {
    templateId: "code-review-gate",
    input: {
      title: "Fix auth",
      description: "Refresh tokens proactively",
      diff: "@@ -1,3 +1,3 @@",
      testDelta: "+3 tests",
    },
    expectChoice: "(any)",
    tier: "L2",
  },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const tpl = TEMPLATES.find((t) => t.id === c.templateId);
  const state = {};
  for (const [k, p] of Object.entries(tpl.state.from)) {
    if (typeof p === "function") { state[k] = p(c.input); continue; }
    const parts = p.replace(/^\$\./, "").split(".");
    let cur = c.input;
    for (const pa of parts) cur = cur?.[pa];
    // Drop undefined fields — state must be a JSON value.
    if (cur === undefined) continue;
    state[k] = cur;
  }
  const questions = {};
  for (const ch of tpl.choices) {
    questions[ch.id] = {
      type: "choice",
      instructions: ch.instructions,
      criteria: ch.criteria,
    };
  }
  const out = await buildDexFor(c.templateId).choice({
    templateId: c.templateId,
    state,
    questions,
  });
  const got = Object.values(out.answers ?? {})[0]?.choice;
  const tier = out.model === "yueli-dex/rules@1" ? "L1" : out.model?.startsWith("yueli-dex/mock") ? "L2" : "?";
  const ok = c.expectChoice === "(any)" ? tier === c.tier : (got === c.expectChoice && tier === c.tier);
  console.log(
    `${ok ? "OK  " : "FAIL"} ${c.templateId.padEnd(22)} expected=${c.expectChoice.padEnd(15)} got=${(got ?? "?").padEnd(15)} tier=${tier} model=${out.model}`,
  );
  if (ok) pass++;
  else fail++;
}

console.log(`\n${pass}/${pass + fail} tiered cases passed`);
if (fail > 0) process.exit(1);
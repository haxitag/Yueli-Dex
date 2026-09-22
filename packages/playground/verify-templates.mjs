/* Verify all templates compile to a valid ChoiceRequest and the mock provider answers each question. */
import { TEMPLATES, LOCAL_RULE_SETS } from "@haxitag/yueli-dex-templates-core";
import { createMockJevProvider } from "./src/lib/mock-jev-provider.ts";

const mockProvider = createMockJevProvider({ id: "mock-jev" });

/** Apply a single `$.foo.bar` JSONPath against an arbitrary object (no escaping needed for our inputs). */
function pluck(obj, path) {
  const parts = path.replace(/^\$\./, "").split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function compileFromExample(entry) {
  const input = entry.meta.exampleInput;
  const state = {};
  for (const [key, pathOrFn] of Object.entries(entry.state.from)) {
    const v = typeof pathOrFn === "function" ? pathOrFn(input) : pluck(input, pathOrFn);
    state[key] = v;
  }
  const questions = {};
  for (const ch of entry.choices) {
    questions[ch.id] = {
      type: "choice",
      instructions: ch.instructions,
      criteria: ch.criteria,
    };
  }
  return { state, questions };
}

let pass = 0;
let fail = 0;
const fails = [];

for (const entry of TEMPLATES) {
  const rules = LOCAL_RULE_SETS[entry.id] ?? [];
  try {
    const req = compileFromExample(entry);
    const r = await mockProvider.execute(req, {
      decisionId: `d-${entry.id}`,
      requestHash: "h-1",
      deadlineMs: 5000,
      attempt: 1,
    });
    const expected = entry.choices.map((c) => c.id);
    const got = Object.keys(r.answers);
    if (got.length !== expected.length || !expected.every((e) => got.includes(e))) {
      const msg = `question mismatch: expected ${expected.join(",")}, got ${got.join(",")}`;
      console.log(`FAIL ${entry.id.padEnd(22)} theme=${entry.theme.padEnd(22)} rules=${rules.length} :: ${msg}`);
      fails.push(`${entry.id}: ${msg}`);
      fail++;
      continue;
    }
    // Sanity: every answer.choice must exist in the criteria map.
    for (const [qid, ans] of Object.entries(r.answers)) {
      const choices = entry.choices.find((c) => c.id === qid).criteria;
      if (!Object.prototype.hasOwnProperty.call(choices, ans.choice)) {
        const msg = `answer.choice "${ans.choice}" not in criteria options [${Object.keys(choices).join(",")}]`;
        console.log(`FAIL ${entry.id} (${qid}) :: ${msg}`);
        fails.push(`${entry.id}/${qid}: ${msg}`);
        fail++;
        break;
      }
    }
    console.log(
      `OK   ${entry.id.padEnd(22)} theme=${(entry.meta.theme ?? "?").padEnd(22)} rules=${rules.length} answers=${got.length}`,
    );
    pass++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`FAIL ${entry.id} :: ${msg}`);
    fails.push(`${entry.id}: ${msg}`);
    fail++;
  }
}

console.log(`\n${pass}/${pass + fail} templates passed`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
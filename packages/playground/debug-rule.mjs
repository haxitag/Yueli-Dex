import { createDex } from "@haxitag/yueli-dex";
import { TEMPLATES_CORE_PACK, LOCAL_RULE_SETS } from "@haxitag/yueli-dex-templates-core";
import { createMockJevProvider } from "./src/lib/mock-jev-provider.ts";

const mockProvider = createMockJevProvider({ id: "mock-jev" });
const dex = createDex({
  providers: [mockProvider],
  routing: { default: { providerIds: ["mock-jev"], maxAttempts: 1 } },
  templates: [TEMPLATES_CORE_PACK],
  ruleSets: LOCAL_RULE_SETS["chunk-triage"] ?? [],
});

console.log("ruleSets loaded:", (LOCAL_RULE_SETS["chunk-triage"] ?? []).length);

const out = await dex.choice({
  templateId: "chunk-triage",
  state: { chunkId: "x:1", chunkText: "out", goal: "g", toolName: "Bash", chunkSize: 3 },
  questions: {
    disposition: {
      type: "choice",
      instructions: "...",
      criteria: {
        keep_verbatim: "...", hide_with_stub: "...", keep_summary: "...", needs_review: "...",
      },
    },
  },
});
console.log("result.model:", out.model);
console.log("answers:", JSON.stringify(out.answers, null, 2));

import { readFileSync } from "node:fs";
import { createHttpProvider } from "@haxitag/yueli-dex-provider-http";
import { createDex, validateChoiceRequest, DexError } from "@haxitag/yueli-dex";
import type { ChoiceRequest, ChoiceProvider } from "@haxitag/yueli-dex-plugin-sdk";

/**
 * Build a provider from CLI config. P1: the previous implementation
 * hard-coded `createHttpProvider` for every entry, so `kind: "mock"` (or any
 * non-http kind) silently became a broken http provider and failed with a
 * misleading NO_ELIGIBLE_PROVIDER / credential hint.
 */
function buildCliProvider(p: {
  id: string;
  kind?: string;
  endpoint?: string;
  apiKey?: string;
}): ReturnType<typeof createHttpProvider> {
  const kind = p.kind ?? "http";
  switch (kind) {
    case "http":
      if (!p.endpoint) {
        throw new DexError(
          "INVALID_CHOICE_REQUEST",
          `Provider "${p.id}" (kind http) requires an "endpoint" field`,
          { decisionId: "cli-run", recoveryHint: 'Add "endpoint": "https://…" to the provider entry.' },
        );
      }
      return createHttpProvider({ id: p.id, endpoint: p.endpoint, apiKey: p.apiKey });
    case "mock":
      // Zero-credential deterministic provider — same contract as the
      // playground's built-in mock. Good for local CLI testing.
      return createCliMockProvider(p.id);
    default:
      throw new DexError(
        "INVALID_CHOICE_REQUEST",
        `Provider "${p.id}" has unsupported kind "${kind}" (cli run supports: http, mock)`,
        { decisionId: "cli-run", recoveryHint: 'Use kind "http" with an endpoint, or kind "mock" for local testing.' },
      );
  }
}

/** Minimal deterministic mock provider for CLI runs (no network, no deps). */
function createCliMockProvider(id: string): ChoiceProvider {
  return {
    manifest: {
      id,
      apiVersion: "yueli-dex-plugin/v1" as const,
      kind: "provider" as const,
      version: "0.1.0",
      capabilities: ["choice"],
    },
    health: async () => ({ available: true, observedP95LatencyMs: 1 }),
    execute: async (request: ChoiceRequest) => {
      const answers: Record<
        string,
        { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
      > = {};
      for (const [qid, q] of Object.entries(request.questions)) {
        const choices = Object.keys(q.criteria);
        const first = choices[0] ?? "needs_review";
        const probabilities: Record<string, number> = {};
        for (const c of choices) probabilities[c] = c === first ? 0.6 : 0.4 / Math.max(1, choices.length - 1);
        answers[qid] = { type: "choice", choice: first, confidence: 0.6, probabilities };
      }
      return { model: "yueli-dex/cli-mock@1", answers, usage: { input_tokens: 1, output_tokens: 1 } };
    },
  };
}

interface CliArgs {
  readonly command: string;
  readonly args: readonly string[];
  readonly flags: Readonly<Record<string, string>>;
}

function parseArgs(argv: string[]): CliArgs {
  const args: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    } else {
      args.push(a);
    }
  }
  return { command: args[0] ?? "help", args: args.slice(1), flags };
}

function loadJson<T = unknown>(path: string): T {
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as T;
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

async function cmdValidateTemplate(path: string): Promise<number> {
  try {
    const raw = loadJson(path);
    // Basic structural validation
    if (!raw || typeof raw !== "object") {
      console.error(`✗ Template at ${path} is not a JSON object`);
      return 1;
    }
    const t = raw as Record<string, unknown>;
    if (t.apiVersion !== "yueli-dex-template/v1") {
      console.error(`✗ apiVersion must be "yueli-dex-template/v1", got "${String(t.apiVersion)}"`);
      return 1;
    }
    if (typeof t.id !== "string") {
      console.error(`✗ Template must have a string "id"`);
      return 1;
    }
    console.log(`✓ Template "${t.id}" is structurally valid`);
    return 0;
  } catch (err) {
    console.error(`✗ Failed to validate template: ${(err as Error).message}`);
    return 1;
  }
}

async function cmdValidateRules(path: string): Promise<number> {
  try {
    const raw = loadJson(path);
    if (!raw || typeof raw !== "object") {
      console.error(`✗ Rules at ${path} is not a JSON object`);
      return 1;
    }
    const doc = raw as Record<string, unknown>;
    if (doc.apiVersion !== "yueli-dex-rules/v1") {
      console.error(`✗ apiVersion must be "yueli-dex-rules/v1"`);
      return 1;
    }
    if (!Array.isArray(doc.rules)) {
      console.error(`✗ Rules must define a "rules" array`);
      return 1;
    }
    console.log(`✓ Rules document with ${doc.rules.length} rules is structurally valid`);
    return 0;
  } catch (err) {
    console.error(`✗ Failed to validate rules: ${(err as Error).message}`);
    return 1;
  }
}

async function cmdProbe(endpoint: string): Promise<number> {
  try {
    const provider = createHttpProvider({ id: "probe", endpoint });
    const health = await provider.health({ now: new Date().toISOString(), deadlineMs: 5000 });
    if (health.available) {
      console.log(`✓ Provider at ${endpoint} is available`);
      return 0;
    } else {
      console.error(`✗ Provider at ${endpoint} is not available`);
      return 1;
    }
  } catch (err) {
    console.error(`✗ Probe failed: ${(err as Error).message}`);
    return 1;
  }
}

async function cmdRun(configPath: string, requestPath: string, route?: string): Promise<number> {
  // Declared outside try so the catch path can surface the failure receipt.
  let receipt: unknown;
  try {
    const config = loadJson<{
      providers: Array<{ id: string; kind?: string; endpoint?: string; apiKey?: string }>;
      routing: {
        default: {
          providerIds: string[];
          maxAttempts: number;
          circuitFailureThreshold: number;
          circuitCooldownMs: number;
        };
      };
    }>(configPath);

    const providers = config.providers.map((p) => buildCliProvider(p));

    const dex = createDex({
      providers,
      routing: {
        default: {
          providerIds: config.routing.default.providerIds,
          maxAttempts: config.routing.default.maxAttempts,
          circuitFailureThreshold: config.routing.default.circuitFailureThreshold,
          circuitCooldownMs: config.routing.default.circuitCooldownMs,
        },
      },
    });

    const rawRequest = loadJson<ChoiceRequest>(requestPath);
    validateChoiceRequest(rawRequest, "cli-run");

    receipt = undefined;
    dex.on("choice.completed", (e) => {
      receipt = e.receipt;
    });
    // P1: capture failure receipts too, so `run` failures still print the
    // full execution trace (attempts, timing, rules) for debugging.
    dex.on("choice.failed", (e) => {
      receipt = e.receipt;
    });

    const response = await dex.choice(rawRequest, route ? { route } : undefined);

    console.log(JSON.stringify({ response, receipt }, null, 2));
    return 0;
  } catch (err) {
    if (err instanceof DexError) {
      console.error(`✗ DexError [${err.code}]: ${err.message}`);
      if (err.recoveryHint) console.error(`  hint: ${err.recoveryHint}`);
      // P1: surface the failure receipt (attempts / routing trace) when one
      // was emitted, so post-mortems don't lose the provider attempt trail.
      if (receipt !== undefined) {
        console.error(`  receipt: ${JSON.stringify(receipt)}`);
      }
    } else {
      console.error(`✗ ${(err as Error).message}`);
      if (receipt !== undefined) {
        console.error(`  receipt: ${JSON.stringify(receipt)}`);
      }
    }
    return 1;
  }
}

async function cmdFixtures(): Promise<number> {
  try {
    // P2-1: run every fixture attached to the templates-core pack.
    // Fixtures without a local rule short-circuit will fail because the CLI
    // has no provider configured — that's expected and reported as such.
    const { TEMPLATES_CORE_PACK, CATALOG, LOCAL_RULE_SETS } = await import(
      "@haxitag/yueli-dex-templates-core"
    );
    const stubProvider = createHttpProvider({
      id: "stub",
      endpoint: "http://127.0.0.1:1",
    });
    // Collect every local rule set so short-circuit fixtures pass without
    // hitting the provider.
    const allRuleSets = Object.values(LOCAL_RULE_SETS).flat();
    const dex = createDex({
      providers: [stubProvider],
      routing: {
        default: {
          providerIds: ["stub"],
          maxAttempts: 1,
          circuitFailureThreshold: 10,
          circuitCooldownMs: 60_000,
        },
      },
      templates: [TEMPLATES_CORE_PACK],
      ruleSets: allRuleSets,
    });
    let total = 0;
    let shortCircuit = 0;
    let needsProvider = 0;
    const byTemplate = new Map<string, { name: string; input: unknown; result: string }[]>();

    for (const entry of CATALOG) {
      if (!entry.fixtureCount || entry.fixtureCount === 0) continue;
      const fixtures = dex.templates.getFixtures(entry.id) ?? [];
      const results: typeof byTemplate extends Map<string, infer V> ? V : never = [];
      for (const fixture of fixtures) {
        total += 1;
        try {
          const req = await dex.templates.prepare({
            template: entry.id,
            input: fixture.input,
          });
          const response = await dex.choice(req);
          // Verify expected
          let matched = true;
          if (fixture.expected) {
            for (const [qid, expectedChoice] of Object.entries(fixture.expected)) {
              const actual = response.answers[qid as never]?.choice;
              if (actual !== expectedChoice) matched = false;
            }
          }
          if (matched) {
            shortCircuit += 1;
            results.push({ name: fixture.name, input: fixture.input, result: "pass" });
          } else {
            results.push({ name: fixture.name, input: fixture.input, result: "mismatch" });
          }
        } catch (err) {
          // Most likely cause: no provider configured and no local rule
          // short-circuit fired. That's a known limitation when running
          // locally without provider credentials.
          const code = err && typeof err === "object" && "code" in err ? (err as { code: string }).code : "unknown";
          if (code === "NO_ELIGIBLE_PROVIDER") {
            needsProvider += 1;
            results.push({ name: fixture.name, input: fixture.input, result: "needs_provider" });
          } else {
            results.push({ name: fixture.name, input: fixture.input, result: `error:${code}` });
          }
        }
      }
      byTemplate.set(entry.id, results);
    }

    const report = {
      total,
      shortCircuit,
      needsProvider,
      errors: total - shortCircuit - needsProvider,
      templates: Array.from(byTemplate.entries()).map(([id, fixtures]) => ({
        template: id,
        fixtures,
      })),
    };
    console.log(JSON.stringify(report, null, 2));
    return 0;
  } catch (err) {
    if (err instanceof DexError) {
      console.error(`✗ DexError [${err.code}]: ${err.message}`);
    } else {
      console.error(`✗ ${(err as Error).message}`);
    }
    return 1;
  }
}

function printHelp(): void {
  console.log(`Yueli DEX CLI

Usage:
  yueli-dex validate template <path>   Validate a template JSON file
  yueli-dex validate rules <path>      Validate a rules JSON file
  yueli-dex probe <endpoint>           Probe a jev-choice/v1 provider endpoint
  yueli-dex run <config> <request>     Execute a fixture request against providers
                                       [--route <name>]
  yueli-dex fixtures                   Run all template fixtures (P2-1 evaluation)
  yueli-dex help                       Show this help
`);
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { command, args, flags } = parseArgs(argv);

  switch (command) {
    case "validate": {
      const kind = args[0];
      const path = args[1];
      if (!path) {
        console.error("Error: missing path argument");
        return 1;
      }
      if (kind === "template") return cmdValidateTemplate(path);
      if (kind === "rules") return cmdValidateRules(path);
      console.error(`Unknown validate target: ${kind}`);
      return 1;
    }
    case "probe": {
      const endpoint = args[0];
      if (!endpoint) {
        console.error("Error: missing endpoint argument");
        return 1;
      }
      return cmdProbe(endpoint);
    }
    case "run": {
      const config = args[0];
      const request = args[1];
      if (!config || !request) {
        console.error("Error: run requires <config> and <request> arguments");
        return 1;
      }
      return cmdRun(config, request, flags.route);
    }
    case "fixtures":
      return cmdFixtures();
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return 0;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}

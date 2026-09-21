import { readFileSync } from "node:fs";
import { createHttpProvider } from "@haxitag/yueli-dex-provider-http";
import { createDex, validateChoiceRequest, DexError } from "@haxitag/yueli-dex";
import type { ChoiceRequest } from "@haxitag/yueli-dex-plugin-sdk";

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
  try {
    const config = loadJson<{
      providers: Array<{ id: string; endpoint: string; apiKey?: string }>;
      routing: {
        default: {
          providerIds: string[];
          maxAttempts: number;
          circuitFailureThreshold: number;
          circuitCooldownMs: number;
        };
      };
    }>(configPath);

    const providers = config.providers.map((p) =>
      createHttpProvider({ id: p.id, endpoint: p.endpoint, apiKey: p.apiKey }),
    );

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

    let receipt: unknown;
    dex.on("choice.completed", (e) => {
      receipt = e.receipt;
    });

    const response = await dex.choice(rawRequest, route ? { route } : undefined);

    console.log(JSON.stringify({ response, receipt }, null, 2));
    return 0;
  } catch (err) {
    if (err instanceof DexError) {
      console.error(`✗ DexError [${err.code}]: ${err.message}`);
      if (err.recoveryHint) console.error(`  hint: ${err.recoveryHint}`);
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

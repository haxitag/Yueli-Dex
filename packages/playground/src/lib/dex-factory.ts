import { createDex } from "@haxitag/yueli-dex";
import type { Dex, DexConfig, RuleSet, TemplatePack } from "@haxitag/yueli-dex";
import type { ChoiceProvider } from "@haxitag/yueli-dex-plugin-sdk";
import { createHttpProvider } from "@haxitag/yueli-dex-provider-http";
import { createTypeSafeProvider } from "@haxitag/yueli-dex-provider-typesafe";
import { createCloudflareProvider } from "@haxitag/yueli-dex-provider-cloudflare";
import { createVercelProvider } from "@haxitag/yueli-dex-provider-vercel";
import { createMockJevProvider } from "@/lib/mock-jev-provider";
import { resolveCredentials } from "@/lib/env";
import type { PlaygroundDexConfig, ProviderConfig } from "@/lib/types";

export function buildProvider(cfg: ProviderConfig): ChoiceProvider {
  const creds = resolveCredentials(cfg);

  switch (cfg.kind) {
    case "http":
      return createHttpProvider({
        id: cfg.id,
        endpoint: cfg.endpoint ?? "",
        apiKey: creds.apiKey,
        model: cfg.model,
        headers: cfg.headers,
      });
    case "typesafe":
      return createTypeSafeProvider({
        id: cfg.id,
        apiKey: creds.apiKey,
        model: cfg.model,
      });
    case "cloudflare":
      return createCloudflareProvider({
        id: cfg.id,
        accountId: creds.accountId,
        apiToken: creds.apiToken,
      });
    case "vercel":
      return createVercelProvider({
        id: cfg.id,
        apiToken: creds.apiToken,
        model: cfg.model,
      });
    case "mock":
      // Built-in deterministic JEV mock. No credentials, no network.
      return createMockJevProvider({ id: cfg.id });
    default:
      throw new Error(`Unknown provider kind: ${(cfg as { kind: string }).kind}`);
  }
}

export function buildDexFromConfig(config: PlaygroundDexConfig): Dex {
  const providers = config.providers.map(buildProvider);

  const ruleSets: RuleSet[] = (config.ruleSets ?? []).map((rs) => ({
    id: rs.id,
    version: rs.version,
    scope: rs.scope,
    document: rs.document as never,
  }));

  const templates: TemplatePack[] = (config.templates ?? []).map((tp) => ({
    id: tp.id,
    version: tp.version,
    templates: tp.templates as never,
  }));

  const dexConfig: DexConfig = {
    providers,
    routing: {
      default: config.routing.default,
      named: config.routing.named,
    },
    ruleSets: ruleSets.length > 0 ? ruleSets : undefined,
    templates: templates.length > 0 ? templates : undefined,
  };

  return createDex(dexConfig);
}

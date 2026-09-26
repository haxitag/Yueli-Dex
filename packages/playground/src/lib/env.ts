/**
 * Environment variable based credential resolution for Yueli DEX Playground.
 *
 * Supports:
 *  - Playground-specific keys (PLAYGROUND_*) that override defaults.
 *  - Multiple keys per provider via comma-separated *_KEYS env vars.
 *  - Round-robin selection across the key pool for load distribution.
 *
 * Resolution priority (highest → lowest):
 *   1. Explicit value in provider config (apiKey / apiToken / accountId)
 *   2. PLAYGROUND_* env var (playground-specific override)
 *   3. Default * env var (shared with the rest of the project)
 */

import type { ProviderConfig, ProviderKind } from "@/lib/types";

export interface ResolvedCredentials {
  apiKey?: string;
  apiToken?: string;
  accountId?: string;
  /** Which key index was selected from the pool (0-based). */
  keyIndex: number;
  /** Total number of keys available for this provider kind. */
  totalKeys: number;
  /** Source of the resolved value: "config" | "playground-env" | "default-env". */
  source: "config" | "playground-env" | "default-env" | "none";
}

/** Mask a key for safe display: keep first 4 and last 4 chars. */
export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/** Split a comma-separated env value into a clean array of non-empty keys. */
function parseKeyPool(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

/**
 * Read an env value, preferring the PLAYGROUND_* variant over the default.
 * Returns the first non-empty match.
 */
function readEnvVar(defaultName: string): string | undefined {
  const playgroundName = `PLAYGROUND_${defaultName}`;
  const pg = process.env[playgroundName];
  if (pg && pg.trim().length > 0) return pg;
  const def = process.env[defaultName];
  if (def && def.trim().length > 0) return def;
  return undefined;
}

/**
 * Determine the source of an env value (playground vs default).
 */
function envSource(defaultName: string): "playground-env" | "default-env" | undefined {
  const pg = process.env[`PLAYGROUND_${defaultName}`];
  if (pg && pg.trim().length > 0) return "playground-env";
  const def = process.env[defaultName];
  if (def && def.trim().length > 0) return "default-env";
  return undefined;
}

// Key selection strategy for multi-key pools.
//
// Next.js dev mode may isolate module/process state across requests, so a
// classic in-memory round-robin counter does not reliably persist. We use a
// time-based distribution: each call selects key index = floor(nowSec) % n.
// This spreads load evenly across the pool over time without requiring shared
// state. When a specific `keyIndex` is provided in the provider config, that
// exact key is used (overriding the time-based selection).

function selectKeyIndex(poolSize: number, explicit?: number): number {
  if (poolSize <= 1) return 0;
  if (explicit !== undefined && explicit >= 0 && explicit < poolSize) return explicit;
  return Math.floor(Date.now() / 1000) % poolSize;
}

/**
 * Resolve the key pool (array of available keys) for a given env var name.
 * Checks both the singular (e.g. TYPESAFE_API_KEY) and plural
 * (e.g. TYPESAFE_API_KEYS) forms.
 */
function resolveKeyPool(envName: string): { keys: string[]; source: "playground-env" | "default-env" | undefined } {
  const pluralName = envName.endsWith("S") ? envName : `${envName}S`;
  const pluralRaw = readEnvVar(pluralName);
  const singularRaw = readEnvVar(envName);

  const keys = parseKeyPool(pluralRaw);
  if (keys.length > 0) {
    return { keys, source: envSource(pluralName) };
  }
  if (singularRaw) {
    return { keys: [singularRaw], source: envSource(envName) };
  }
  // Backward-compatible aliases for HTTP provider (docs/.env.example historically
  // used HTTP_PROVIDER_API_KEY while the runtime reads DEX_HTTP_API_KEY).
  if (envName === "DEX_HTTP_API_KEY") {
    const alias = resolveKeyPool("HTTP_PROVIDER_API_KEY");
    if (alias.keys.length > 0) return alias;
  }
  return { keys: [], source: undefined };
}

/**
 * Resolve credentials for a provider, falling back to environment variables.
 *
 * If `cfg.useEnv` is true, explicit keys in the config are ignored and only
 * env vars are used. Otherwise, explicit config values take priority over env.
 *
 * When multiple keys are available (via *_KEYS), a time-based distribution
 * picks one on each call to spread load across the key pool. Use `keyIndex`
 * in the provider config to select a specific key.
 */
export function resolveCredentials(cfg: ProviderConfig): ResolvedCredentials {
  const useEnv = cfg.useEnv === true;

  // Helper to pick a key from the pool: explicit keyIndex wins, else time-based distribution.
  const pickKey = (keys: string[]): { key: string; index: number } => {
    const idx = selectKeyIndex(keys.length, cfg.keyIndex);
    return { key: keys[idx], index: idx };
  };

  // ----- HTTP provider (apiKey) -----
  if (cfg.kind === "http") {
    if (!useEnv && cfg.apiKey) {
      return { apiKey: cfg.apiKey, keyIndex: 0, totalKeys: 1, source: "config" };
    }
    const { keys, source } = resolveKeyPool("DEX_HTTP_API_KEY");
    if (keys.length > 0) {
      const { key, index } = pickKey(keys);
      return { apiKey: key, keyIndex: index, totalKeys: keys.length, source: source ?? "default-env" };
    }
    return { keyIndex: 0, totalKeys: 0, source: "none" };
  }

  // ----- TypeSafe provider (apiKey) -----
  if (cfg.kind === "typesafe") {
    if (!useEnv && cfg.apiKey) {
      return { apiKey: cfg.apiKey, keyIndex: 0, totalKeys: 1, source: "config" };
    }
    const { keys, source } = resolveKeyPool("TYPESAFE_API_KEY");
    if (keys.length > 0) {
      const { key, index } = pickKey(keys);
      return { apiKey: key, keyIndex: index, totalKeys: keys.length, source: source ?? "default-env" };
    }
    return { keyIndex: 0, totalKeys: 0, source: "none" };
  }

  // ----- Cloudflare provider (accountId + apiToken) -----
  if (cfg.kind === "cloudflare") {
    const accountId = (!useEnv && cfg.accountId) || readEnvVar("CLOUDFLARE_ACCOUNT_ID");
    const accountSource = (!useEnv && cfg.accountId)
      ? "config" as const
      : envSource("CLOUDFLARE_ACCOUNT_ID") ?? "none" as const;

    if (!useEnv && cfg.apiToken) {
      return { accountId, apiToken: cfg.apiToken, keyIndex: 0, totalKeys: 1, source: "config" };
    }
    const { keys, source } = resolveKeyPool("CLOUDFLARE_API_TOKEN");
    if (keys.length > 0) {
      const { key, index } = pickKey(keys);
      return {
        accountId,
        apiToken: key,
        keyIndex: index,
        totalKeys: keys.length,
        source: source ?? "default-env",
      };
    }
    return { accountId, keyIndex: 0, totalKeys: 0, source: accountSource };
  }

  // ----- Vercel provider (apiToken) -----
  if (cfg.kind === "vercel") {
    if (!useEnv && cfg.apiToken) {
      return { apiToken: cfg.apiToken, keyIndex: 0, totalKeys: 1, source: "config" };
    }
    const { keys, source } = resolveKeyPool("VERCEL_API_TOKEN");
    if (keys.length > 0) {
      const { key, index } = pickKey(keys);
      return { apiToken: key, keyIndex: index, totalKeys: keys.length, source: source ?? "default-env" };
    }
    return { keyIndex: 0, totalKeys: 0, source: "none" };
  }

  return { keyIndex: 0, totalKeys: 0, source: "none" };
}

/**
 * Return a masked summary of configured env keys for UI display.
 * Never returns the actual secret values.
 */
export function getEnvKeyStatus(): Record<ProviderKind, { configured: boolean; count: number; masked: string[]; source: string }> {
  const kinds: ProviderKind[] = ["http", "typesafe", "cloudflare", "vercel", "mock"];
  const result = {} as Record<ProviderKind, { configured: boolean; count: number; masked: string[]; source: string }>;

  for (const kind of kinds) {
    // mock is a built-in, deterministic provider — always available, no env var required.
    if (kind === "mock") {
      result[kind] = { configured: true, count: 1, masked: ["builtin"], source: "builtin" };
      continue;
    }
    let envName: string;
    if (kind === "http") envName = "DEX_HTTP_API_KEY";
    else if (kind === "typesafe") envName = "TYPESAFE_API_KEY";
    else if (kind === "cloudflare") envName = "CLOUDFLARE_API_TOKEN";
    else envName = "VERCEL_API_TOKEN";

    const { keys, source } = resolveKeyPool(envName);
    result[kind] = {
      configured: keys.length > 0,
      count: keys.length,
      masked: keys.map(maskKey),
      source: source ?? "none",
    };
  }

  return result;
}

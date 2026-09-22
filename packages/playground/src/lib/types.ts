export type ProviderKind = "http" | "typesafe" | "cloudflare" | "vercel" | "mock";

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  /**
   * When true, ignore explicit apiKey/apiToken/accountId in this config and
   * resolve credentials from environment variables (PLAYGROUND_* or default).
   */
  useEnv?: boolean;
  /** Select a specific key index from the env key pool (0-based). Omit for round-robin. */
  keyIndex?: number;
  // HTTP
  endpoint?: string;
  apiKey?: string;
  model?: string;
  headers?: Record<string, string>;
  // Cloudflare / Vercel
  accountId?: string;
  apiToken?: string;
}

export interface PlaygroundDexConfig {
  providers: ProviderConfig[];
  routing: {
    default: {
      providerIds: string[];
      maxAttempts: number;
      circuitFailureThreshold: number;
      circuitCooldownMs: number;
      retryableStatusCodes?: number[];
    };
    named?: Record<string, {
      providerIds: string[];
      maxAttempts: number;
      circuitFailureThreshold: number;
      circuitCooldownMs: number;
      retryableStatusCodes?: number[];
    }>;
  };
  ruleSets?: Array<{
    id: string;
    version: string;
    scope: "template" | "organization" | "environment" | "call";
    document: unknown;
  }>;
  templates?: Array<{
    id: string;
    version: string;
    templates: unknown[];
  }>;
}

export interface ChoiceDebugResult {
  response?: import("@haxitag/yueli-dex-plugin-sdk").ChoiceResponse;
  receipt?: import("@haxitag/yueli-dex").DecisionReceipt;
  error?: { code: string; message: string; providerId?: string; recoveryHint?: string };
  durationMs: number;
}

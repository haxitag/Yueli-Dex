import type {
  ChoiceProvider,
  ChoiceRequest,
  ChoiceResponse,
  ProviderCallContext,
  ProviderHealth,
  ProviderHealthContext,
  ProviderManifest,
} from "@haxitag/yueli-dex-plugin-sdk";

/**
 * Cloudflare Clef decision models on Workers AI.
 *
 * Clef is Cloudflare's open-source (Apache 2.0) decision-model family with a
 * Jev-compatible Choice API. Two variants are hosted on Workers AI:
 *
 * - `clef`       → `@cf/cloudflare/clef`       (27B backbone; highest quality,
 *                  median latency ~209ms)
 * - `clef-flash` → `@cf/cloudflare/clef-flash` (9B backbone; low latency,
 *                  median ~39ms, p95 ~122ms)
 *
 * Reference: https://blog.cloudflare.com/clef-decision-models/
 */

/** Full Workers AI model ids for the Clef family. */
export const CLEF_MODEL_ID = "@cf/cloudflare/clef";
export const CLEF_FLASH_MODEL_ID = "@cf/cloudflare/clef-flash";

/** Default model when neither the request nor config specifies one. */
export const DEFAULT_CLEF_MODEL = "clef";

const DEFAULT_API_BASE_URL = "https://api.cloudflare.com";

/** Model shorthand → full Workers AI model id. */
const MODEL_ALIASES: Readonly<Record<string, string>> = {
  clef: CLEF_MODEL_ID,
  "clef-flash": CLEF_FLASH_MODEL_ID,
};

/**
 * Resolve a model name to the full Workers AI model id.
 *
 * Accepted inputs (case-insensitive):
 * - `clef` / `clef-flash` — Clef shorthands
 * - `@cf/cloudflare/clef` / `@cf/cloudflare/clef-flash` — full ids
 * - any other string (e.g. `@typesafe/jev`) passes through unchanged so
 *   self-hosted / legacy Workers AI deployments keep working
 */
export function resolveClefModelId(model?: string): string {
  const raw = model?.trim();
  if (!raw) return CLEF_MODEL_ID;
  const alias = MODEL_ALIASES[raw.toLowerCase()];
  if (alias) return alias;
  return raw;
}

/**
 * Body-level model name sent to the Clef API. The REST path already carries
 * the full model id, so the body uses the canonical Clef shorthand when the
 * resolved model is a Clef family member; otherwise the value passes through.
 */
function bodyModelName(resolvedModelId: string): string {
  switch (resolvedModelId) {
    case CLEF_MODEL_ID:
      return "clef";
    case CLEF_FLASH_MODEL_ID:
      return "clef-flash";
    default:
      return resolvedModelId;
  }
}

export interface CloudflareProviderConfig {
  readonly id?: string;
  /** Cloudflare Account ID. Reads CLOUDFLARE_ACCOUNT_ID env var if omitted. */
  readonly accountId?: string;
  /** Cloudflare API token. Reads CLOUDFLARE_API_TOKEN env var if omitted. */
  readonly apiToken?: string;
  /**
   * Model shorthand or full Workers AI model id used when the ChoiceRequest
   * omits `model`. Defaults to `clef`. Use `clef-flash` for the low-latency
   * variant on hot paths.
   */
  readonly model?: string;
  /**
   * Base URL of the Cloudflare REST API. Defaults to
   * `https://api.cloudflare.com`; override for tests or self-hosted gateways.
   */
  readonly apiBaseUrl?: string;
  /** Workers AI binding object (for Worker runtime). If provided, REST is bypassed. */
  readonly binding?: {
    run: (model: string, options: unknown) => Promise<unknown>;
  };
}

/**
 * Cloudflare provider for Clef decision models, supporting both the Workers AI
 * binding and the Account REST API.
 *
 * Model precedence: `request.model` > `config.model` > `clef`.
 */
export function createCloudflareProvider(config: CloudflareProviderConfig = {}): ChoiceProvider {
  const id = config.id ?? "cf-clef";
  const accountId = config.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = config.apiToken ?? process.env.CLOUDFLARE_API_TOKEN;
  const defaultModel = config.model ?? DEFAULT_CLEF_MODEL;
  const apiBaseUrl = (config.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(/\/+$/, "");

  const manifest: ProviderManifest = {
    id,
    apiVersion: "yueli-dex-plugin/v1",
    kind: "provider",
    version: "0.2.0",
    capabilities: ["choice", "clef"],
  };

  async function health(_ctx: ProviderHealthContext): Promise<ProviderHealth> {
    if (config.binding) return { available: true };
    if (!accountId || !apiToken) return { available: false };
    return { available: true };
  }

  async function execute(
    request: ChoiceRequest,
    context: ProviderCallContext,
  ): Promise<ChoiceResponse> {
    // Model precedence: request > provider config > default (clef).
    const modelId = resolveClefModelId(request.model ?? defaultModel);

    if (config.binding) {
      // Workers AI binding path — binding.run takes the full model id.
      const result = await config.binding.run(modelId, {
        ...request,
        model: bodyModelName(modelId),
        stream: false,
      });
      return result as ChoiceResponse;
    }

    if (!accountId || !apiToken) {
      const err: Error & { status?: number } = new Error("Cloudflare credentials not configured");
      err.status = 401;
      throw err;
    }

    const url = `${apiBaseUrl}/client/v4/accounts/${accountId}/ai/run/${modelId}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
        "X-Dex-Decision-Id": context.decisionId,
      },
      body: JSON.stringify({
        ...request,
        model: bodyModelName(modelId),
      }),
      signal: AbortSignal.timeout(context.deadlineMs),
    });

    if (!res.ok) {
      let detail = "";
      try {
        const text = await res.text();
        detail = text.slice(0, 400);
      } catch {
        /* ignore body read failures */
      }
      const err: Error & { status?: number } = new Error(
        detail
          ? `Cloudflare HTTP ${res.status}: ${detail}`
          : `Cloudflare HTTP ${res.status}`,
      );
      err.status = res.status;
      throw err;
    }

    const json = (await res.json()) as { result: ChoiceResponse };
    return json.result;
  }

  return { manifest, health, execute };
}

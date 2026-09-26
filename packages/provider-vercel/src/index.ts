import type {
  ChoiceProvider,
  ChoiceRequest,
  ChoiceResponse,
  ProviderCallContext,
  ProviderHealth,
  ProviderHealthContext,
  ProviderManifest,
} from "@haxitag/yueli-dex-plugin-sdk";

export interface VercelProviderConfig {
  readonly id?: string;
  /** Vercel AI Gateway base URL, e.g. https://api.vercel.com/v1/ai/gateway */
  readonly endpoint?: string;
  /** Vercel API token. Reads VERCEL_API_TOKEN env var if omitted. */
  readonly apiToken?: string;
  /** Model identifier on Vercel AI Gateway. */
  readonly model?: string;
}

const DEFAULT_ENDPOINT = "https://api.vercel.com/v1/ai/gateway";

/**
 * Vercel AI Gateway provider.
 *
 * Treats Vercel as a transport/provider integration rather than a new
 * decision contract. Forwards the canonical ChoiceRequest and expects a
 * canonical ChoiceResponse.
 */
export function createVercelProvider(config: VercelProviderConfig = {}): ChoiceProvider {
  const id = config.id ?? "vercel-gateway";
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  const apiToken = config.apiToken ?? process.env.VERCEL_API_TOKEN;

  const manifest: ProviderManifest = {
    id,
    apiVersion: "yueli-dex-plugin/v1",
    kind: "provider",
    version: "0.1.0",
    capabilities: ["choice"],
  };

  async function health(_ctx: ProviderHealthContext): Promise<ProviderHealth> {
    if (!apiToken) return { available: false };
    return { available: true };
  }

  async function execute(
    request: ChoiceRequest,
    context: ProviderCallContext,
  ): Promise<ChoiceResponse> {
    if (!apiToken) {
      const err: Error & { status?: number } = new Error("Vercel API token not configured");
      err.status = 401;
      throw err;
    }

    const body = config.model && !request.model
      ? { ...request, model: config.model }
      : request;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
        "X-Dex-Decision-Id": context.decisionId,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(context.deadlineMs),
    });

    if (!res.ok) {
      const err: Error & { status?: number } = new Error(
        `Vercel HTTP ${res.status}`,
      );
      err.status = res.status;
      throw err;
    }

    return (await res.json()) as ChoiceResponse;
  }

  return { manifest, health, execute };
}

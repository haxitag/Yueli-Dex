import type {
  ChoiceProvider,
  ChoiceRequest,
  ChoiceResponse,
  ProviderCallContext,
  ProviderHealth,
  ProviderHealthContext,
  ProviderManifest,
} from "@haxitag/yueli-dex-plugin-sdk";

export interface HttpProviderConfig {
  /** Unique provider id, e.g. "private-jev". */
  readonly id: string;
  /** Base URL of the self-hosted jev-choice/v1 service. */
  readonly endpoint: string;
  /** Optional API key or bearer token. Read from env if not set. */
  readonly apiKey?: string;
  /** Optional headers to include on every request. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Optional model override. */
  readonly model?: string;
  /** Health check endpoint (defaults to ${endpoint}/health). */
  readonly healthEndpoint?: string;
}

/**
 * Standard self-hosted HTTP provider for `jev-choice/v1` compatible services.
 *
 * The provider sends the canonical ChoiceRequest as JSON POST and expects a
 * canonical ChoiceResponse. It does not guess alternative field names or
 * silently coerce foreign response formats.
 */
export function createHttpProvider(config: HttpProviderConfig): ChoiceProvider {
  const { id, endpoint, apiKey, headers, model, healthEndpoint } = config;

  const manifest: ProviderManifest = {
    id,
    apiVersion: "yueli-dex-plugin/v1",
    kind: "provider",
    version: "0.1.0",
    capabilities: ["choice"],
  };

  const baseHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(headers ?? {}),
  };
  if (apiKey) {
    baseHeaders["Authorization"] = `Bearer ${apiKey}`;
  }

  async function health(ctx: ProviderHealthContext): Promise<ProviderHealth> {
    const url = healthEndpoint ?? `${endpoint.replace(/\/$/, "")}/health`;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { ...baseHeaders },
        signal: AbortSignal.timeout(Math.min(ctx.deadlineMs, 5000)),
      });
      return {
        available: res.ok,
      };
    } catch {
      return { available: false };
    }
  }

  async function execute(
    request: ChoiceRequest,
    context: ProviderCallContext,
  ): Promise<ChoiceResponse> {
    // If a model override is configured and the request does not specify one,
    // inject it. Otherwise forward the request unchanged.
    const body = model && !request.model
      ? { ...request, model }
      : request;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        ...baseHeaders,
        "X-Dex-Decision-Id": context.decisionId,
        "X-Dex-Request-Hash": context.requestHash,
        "X-Dex-Attempt": String(context.attempt),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(context.deadlineMs),
    });

    if (!res.ok) {
      const err: Error & { status?: number } = new Error(
        `HTTP ${res.status} from ${endpoint}`,
      );
      err.status = res.status;
      throw err;
    }

    const data = (await res.json()) as ChoiceResponse;
    return data;
  }

  return { manifest, health, execute };
}

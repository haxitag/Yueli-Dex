import type {
  ChoiceProvider,
  ChoiceRequest,
  ChoiceResponse,
  ProviderCallContext,
  ProviderHealth,
  ProviderHealthContext,
  ProviderManifest,
} from "@haxitag/yueli-dex-plugin-sdk";

const JEV_MODEL = "@typesafe/jev";

export interface CloudflareProviderConfig {
  readonly id?: string;
  /** Cloudflare Account ID. Reads CLOUDFLARE_ACCOUNT_ID env var if omitted. */
  readonly accountId?: string;
  /** Cloudflare API token. Reads CLOUDFLARE_API_TOKEN env var if omitted. */
  readonly apiToken?: string;
  /** Workers AI binding object (for Worker runtime). If provided, REST is bypassed. */
  readonly binding?: {
    run: (model: string, options: unknown) => Promise<unknown>;
  };
}

/**
 * Cloudflare provider supporting both Workers AI binding and Account REST
 * for `typesafe/jev`.
 */
export function createCloudflareProvider(config: CloudflareProviderConfig = {}): ChoiceProvider {
  const id = config.id ?? "cf-edge";
  const accountId = config.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = config.apiToken ?? process.env.CLOUDFLARE_API_TOKEN;

  const manifest: ProviderManifest = {
    id,
    apiVersion: "yueli-dex-plugin/v1",
    kind: "provider",
    version: "0.1.0",
    capabilities: ["choice"],
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
    if (config.binding) {
      // Workers AI binding path
      const result = await config.binding.run(JEV_MODEL, {
        ...request,
        stream: false,
      });
      return result as ChoiceResponse;
    }

    if (!accountId || !apiToken) {
      const err: Error & { status?: number } = new Error("Cloudflare credentials not configured");
      err.status = 401;
      throw err;
    }

    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${JEV_MODEL}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
        "X-Dex-Decision-Id": context.decisionId,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(context.deadlineMs),
    });

    if (!res.ok) {
      const err: Error & { status?: number } = new Error(
        `Cloudflare HTTP ${res.status}`,
      );
      err.status = res.status;
      throw err;
    }

    const json = (await res.json()) as { result: ChoiceResponse };
    return json.result;
  }

  return { manifest, health, execute };
}

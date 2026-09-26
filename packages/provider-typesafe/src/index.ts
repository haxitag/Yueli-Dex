import type {
  ChoiceProvider,
  ChoiceRequest,
  ChoiceResponse,
  ProviderCallContext,
  ProviderHealth,
  ProviderHealthContext,
  ProviderManifest,
} from "@haxitag/yueli-dex-plugin-sdk";

const TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
/** Default System One model when neither the request nor config specifies one.
 * TypeSafe's HTTP API currently requires `model` (422 if missing). */
const DEFAULT_MODEL = "jev-latest";

export interface TypeSafeProviderConfig {
  readonly id?: string;
  /** TypeSafe API key. Reads TYPESAFE_API_KEY env var if omitted. */
  readonly apiKey?: string;
  /** Model id sent when the ChoiceRequest omits `model`. Defaults to jev-latest. */
  readonly model?: string;
}

/**
 * Official TypeSafe System One provider.
 *
 * Calls `POST https://api.typesafe.ai/v1/systemone` with the canonical
 * ChoiceRequest body. Authentication uses a bearer token.
 */
export function createTypeSafeProvider(config: TypeSafeProviderConfig = {}): ChoiceProvider {
  const id = config.id ?? "typesafe-primary";
  const apiKey = config.apiKey ?? process.env.TYPESAFE_API_KEY;
  const defaultModel = config.model ?? DEFAULT_MODEL;

  const manifest: ProviderManifest = {
    id,
    apiVersion: "yueli-dex-plugin/v1",
    kind: "provider",
    version: "0.1.0",
    capabilities: ["choice"],
  };

  async function health(_ctx: ProviderHealthContext): Promise<ProviderHealth> {
    if (!apiKey) return { available: false };
    return { available: true };
  }

  async function execute(
    request: ChoiceRequest,
    context: ProviderCallContext,
  ): Promise<ChoiceResponse> {
    if (!apiKey) {
      const err: Error & { status?: number } = new Error("TypeSafe API key not configured");
      err.status = 401;
      throw err;
    }

    // TypeSafe requires `model` (validated server-side). Prefer request.model,
    // then provider config, then the stable default so callers of dex.choice()
    // without an explicit model still succeed.
    const body = request.model
      ? request
      : { ...request, model: defaultModel };

    const res = await fetch(TYPESAFE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Dex-Decision-Id": context.decisionId,
      },
      body: JSON.stringify(body),
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
          ? `TypeSafe HTTP ${res.status}: ${detail}`
          : `TypeSafe HTTP ${res.status}`,
      );
      err.status = res.status;
      throw err;
    }

    return (await res.json()) as ChoiceResponse;
  }

  return { manifest, health, execute };
}

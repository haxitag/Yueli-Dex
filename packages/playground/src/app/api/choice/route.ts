import { NextResponse } from "next/server";
import { buildDexFromConfig } from "@/lib/dex-factory";
import { resolveCredentials, maskKey } from "@/lib/env";
import { isDexError } from "@haxitag/yueli-dex";
import type { ChoiceRequest, ChoiceCallOptions } from "@haxitag/yueli-dex";
import type { PlaygroundDexConfig } from "@/lib/types";

export const maxDuration = 30;

export async function POST(request: Request) {
  const body = await request.json();
  const { config, choiceRequest, options } = body as {
    config: PlaygroundDexConfig;
    choiceRequest: ChoiceRequest;
    options?: ChoiceCallOptions;
  };

  // Resolve credential metadata for each provider (masked, never raw secrets)
  const credentials = config.providers.map((p) => {
    const c = resolveCredentials(p);
    return {
      providerId: p.id,
      kind: p.kind,
      source: c.source,
      keyIndex: c.keyIndex,
      totalKeys: c.totalKeys,
      masked: c.apiKey ? maskKey(c.apiKey) : c.apiToken ? maskKey(c.apiToken) : undefined,
    };
  });

  const start = Date.now();
  try {
    const dex = buildDexFromConfig(config);
    let receipt: unknown;
    dex.on("choice.completed", (e) => { receipt = e.receipt; });
    dex.on("choice.failed", (e) => { receipt = e.receipt; });

    const response = await dex.choice(choiceRequest, options);
    const durationMs = Date.now() - start;

    return NextResponse.json({
      response,
      receipt,
      credentials,
      durationMs,
    });
  } catch (err) {
    const durationMs = Date.now() - start;
    if (isDexError(err)) {
      return NextResponse.json({
        error: {
          code: err.code,
          message: err.message,
          providerId: err.providerId,
          recoveryHint: err.recoveryHint,
        },
        credentials,
        durationMs,
      }, { status: 200 });
    }
    return NextResponse.json({
      error: {
        code: "INTERNAL_ERROR",
        message: (err as Error).message,
      },
      credentials,
      durationMs,
    }, { status: 500 });
  }
}

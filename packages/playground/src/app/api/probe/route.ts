import { NextResponse } from "next/server";
import { buildProvider } from "@/lib/dex-factory";
import { resolveCredentials, maskKey } from "@/lib/env";
import type { ProviderConfig } from "@/lib/types";

export const maxDuration = 15;

export async function POST(request: Request) {
  const body = await request.json();
  const { provider } = body as { provider: ProviderConfig };

  const creds = resolveCredentials(provider);
  const credentialInfo = {
    source: creds.source,
    keyIndex: creds.keyIndex,
    totalKeys: creds.totalKeys,
    masked: creds.apiKey ? maskKey(creds.apiKey) : creds.apiToken ? maskKey(creds.apiToken) : undefined,
  };

  const start = Date.now();
  try {
    const p = buildProvider(provider);
    const health = await p.health({
      now: new Date().toISOString(),
      deadlineMs: 8000,
    });
    const durationMs = Date.now() - start;
    return NextResponse.json({ health, credentials: credentialInfo, durationMs });
  } catch (err) {
    const durationMs = Date.now() - start;
    return NextResponse.json({
      error: (err as Error).message,
      credentials: credentialInfo,
      durationMs,
    }, { status: 200 });
  }
}

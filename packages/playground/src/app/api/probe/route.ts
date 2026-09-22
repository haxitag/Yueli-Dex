import { NextResponse } from "next/server";
import { buildProvider } from "@/lib/dex-factory";
import { resolveCredentials, maskKey } from "@/lib/env";
import { readJsonBody } from "@/lib/http";
import { isSafeProbeEndpoint } from "@/lib/ssrf-guard";
import type { ProviderConfig } from "@/lib/types";

export const maxDuration = 15;

export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { provider } = (parsed.body ?? {}) as { provider?: ProviderConfig };

  if (!provider || typeof provider.id !== "string") {
    return NextResponse.json(
      { error: "provider config required" },
      { status: 400 },
    );
  }

  // P1 (security): the probe endpoint used to fetch ANY caller-supplied URL,
  // which is an SSRF vector — an attacker (or a curious user) could use the
  // server as a proxy to scan localhost / private network services and infer
  // their availability from timing + health status. Only public http(s)
  // endpoints are now allowed unless DEX_ALLOW_PRIVATE_PROBE=1.
  if (provider.kind === "http" && provider.endpoint) {
    const guard = isSafeProbeEndpoint(provider.endpoint);
    if (!guard.safe) {
      return NextResponse.json(
        { error: guard.reason, credentials: { source: "none", keyIndex: 0, totalKeys: 0 } },
        { status: 400 },
      );
    }
  }

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

import { NextResponse } from "next/server";
import { getEnvKeyStatus } from "@/lib/env";

/**
 * Returns a masked summary of which provider credentials are configured via
 * environment variables. Never returns actual secret values.
 *
 * This lets the Playground UI show whether env-based keys are available and
 * how many keys are in each pool, without exposing secrets.
 */
export async function GET() {
  const status = getEnvKeyStatus();
  return NextResponse.json(status);
}

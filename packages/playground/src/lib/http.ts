import { NextResponse } from "next/server";

/**
 * P1: previously `await request.json()` threw an unhandled SyntaxError on an
 * empty or malformed body, surfacing as an opaque 500 (with a dev-server stack
 * trace) instead of a client-fixable 400. All API routes parse through here.
 */
export async function readJsonBody(
  request: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  try {
    const body = await request.json();
    return { ok: true, body };
  } catch (err) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: {
            code: "BAD_REQUEST_BODY",
            message: `Request body must be valid JSON: ${(err as Error).message}`,
          },
        },
        { status: 400 },
      ),
    };
  }
}

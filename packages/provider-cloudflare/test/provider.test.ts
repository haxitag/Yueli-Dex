import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import {
  createCloudflareProvider,
  resolveClefModelId,
  CLEF_MODEL_ID,
  CLEF_FLASH_MODEL_ID,
} from "../src/index.js";
import type { ChoiceRequest, ChoiceResponse } from "@haxitag/yueli-dex-plugin-sdk";

const DECISION_ID = "test-decision";
const REQUEST_HASH = "hash";

const sampleRequest: ChoiceRequest = {
  state: "Checkout has been failing for every customer for the last hour.",
  model: "clef",
  questions: {
    team: {
      type: "choice",
      instructions: "Which team should handle this request?",
      criteria: {
        billing: "Payments, invoices, and refunds",
        technical: "Outages, errors, and configuration",
        sales: "Plans and upgrades",
      },
    },
  },
};

const sampleResponse: ChoiceResponse = {
  model: "clef",
  answers: {
    team: {
      type: "choice",
      choice: "technical",
      confidence: 0.94,
      probabilities: { technical: 0.94, billing: 0.04, sales: 0.02 },
    },
  },
  usage: { input_tokens: 88, output_tokens: 6 },
};

interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

function startFixtureServer(
  handler: (captured: CapturedRequest) => { status: number; body?: unknown },
): Promise<{ server: Server; port: number; requests: CapturedRequest[] }> {
  const requests: CapturedRequest[] = [];
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      const captured: CapturedRequest = {
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body,
      };
      requests.push(captured);
      const result = handler(captured);
      res.writeHead(result.status, { "Content-Type": "application/json" });
      res.end(result.body !== undefined ? JSON.stringify(result.body) : "");
    });
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port, requests });
    });
  });
}

function callContext(overrides: Partial<Parameters<ReturnType<typeof createCloudflareProvider>["execute"]>[1]> = {}) {
  return {
    decisionId: DECISION_ID,
    requestHash: REQUEST_HASH,
    deadlineMs: 5000,
    attempt: 1,
    ...overrides,
  };
}

describe("resolveClefModelId", () => {
  it("maps clef shorthands to full Workers AI ids", () => {
    expect(resolveClefModelId("clef")).toBe(CLEF_MODEL_ID);
    expect(resolveClefModelId("clef-flash")).toBe(CLEF_FLASH_MODEL_ID);
    expect(resolveClefModelId("CLEF-Flash")).toBe(CLEF_FLASH_MODEL_ID);
  });

  it("accepts full Workers AI ids unchanged", () => {
    expect(resolveClefModelId(CLEF_MODEL_ID)).toBe(CLEF_MODEL_ID);
    expect(resolveClefModelId(CLEF_FLASH_MODEL_ID)).toBe(CLEF_FLASH_MODEL_ID);
  });

  it("defaults to clef and passes unknown models through", () => {
    expect(resolveClefModelId()).toBe(CLEF_MODEL_ID);
    expect(resolveClefModelId("")).toBe(CLEF_MODEL_ID);
    expect(resolveClefModelId("@typesafe/jev")).toBe("@typesafe/jev");
  });
});

describe("Cloudflare Clef provider (REST)", () => {
  let server: Server;
  let port: number;
  let requests: CapturedRequest[];

  beforeAll(async () => {
    const fixture = await startFixtureServer(() => ({
      status: 200,
      body: { success: true, result: sampleResponse },
    }));
    server = fixture.server;
    port = fixture.port;
    requests = fixture.requests;
  });

  afterAll(() => server.close());

  function makeProvider(overrides: Parameters<typeof createCloudflareProvider>[0] = {}) {
    return createCloudflareProvider({
      accountId: "acct-123",
      apiToken: "tok-456",
      apiBaseUrl: `http://localhost:${port}`,
      ...overrides,
    });
  }

  it("routes to the Clef Workers AI endpoint and unwraps `result`", async () => {
    const provider = makeProvider();
    const response = await provider.execute(sampleRequest, callContext());
    expect(response).toEqual(sampleResponse);

    expect(requests).toHaveLength(1);
    const captured = requests[0];
    expect(captured.method).toBe("POST");
    expect(captured.url).toBe(`/client/v4/accounts/acct-123/ai/run/${CLEF_MODEL_ID}`);
    expect(captured.headers["authorization"]).toBe("Bearer tok-456");
    expect(captured.headers["x-dex-decision-id"]).toBe(DECISION_ID);
  });

  it("normalizes the body model to the Clef shorthand", async () => {
    const provider = makeProvider();
    await provider.execute(
      { ...sampleRequest, model: CLEF_FLASH_MODEL_ID },
      callContext(),
    );
    const captured = requests[requests.length - 1];
    // URL carries the full id; body carries the shorthand.
    expect(captured.url).toBe(`/client/v4/accounts/acct-123/ai/run/${CLEF_FLASH_MODEL_ID}`);
    expect((captured.body as { model: string }).model).toBe("clef-flash");
  });

  it("defaults to clef when the request omits model", async () => {
    const provider = makeProvider();
    const { model: _omit, ...requestWithoutModel } = sampleRequest;
    await provider.execute(requestWithoutModel, callContext());
    const captured = requests[requests.length - 1];
    expect(captured.url).toBe(`/client/v4/accounts/acct-123/ai/run/${CLEF_MODEL_ID}`);
    expect((captured.body as { model: string }).model).toBe("clef");
  });

  it("lets provider config select clef-flash as the default model", async () => {
    const provider = makeProvider({ model: "clef-flash" });
    const { model: _omit, ...requestWithoutModel } = sampleRequest;
    await provider.execute(requestWithoutModel, callContext());
    const captured = requests[requests.length - 1];
    expect(captured.url).toBe(`/client/v4/accounts/acct-123/ai/run/${CLEF_FLASH_MODEL_ID}`);
  });

  it("request.model takes precedence over provider config", async () => {
    const provider = makeProvider({ model: "clef-flash" });
    await provider.execute(sampleRequest, callContext());
    const captured = requests[requests.length - 1];
    // sampleRequest.model === "clef" wins over the configured clef-flash.
    expect(captured.url).toBe(`/client/v4/accounts/acct-123/ai/run/${CLEF_MODEL_ID}`);
    expect((captured.body as { model: string }).model).toBe("clef");
  });

  it("forwards non-Clef model ids unchanged (legacy compatibility)", async () => {
    const provider = makeProvider({ model: "@typesafe/jev" });
    const { model: _omit, ...requestWithoutModel } = sampleRequest;
    await provider.execute(requestWithoutModel, callContext());
    const captured = requests[requests.length - 1];
    expect(captured.url).toBe(`/client/v4/accounts/acct-123/ai/run/@typesafe/jev`);
    expect((captured.body as { model: string }).model).toBe("@typesafe/jev");
  });

  it("manifest declares choice + clef capabilities", () => {
    const provider = makeProvider();
    expect(provider.manifest.id).toBe("cf-clef");
    expect(provider.manifest.capabilities).toContain("choice");
    expect(provider.manifest.capabilities).toContain("clef");
  });
});

describe("Cloudflare Clef provider (REST errors)", () => {
  async function withStatusServer<T>(
    status: number,
    body: unknown,
    fn: (port: number) => Promise<T>,
  ): Promise<T> {
    const { server, port } = await startFixtureServer(() => ({ status, body }));
    try {
      return await fn(port);
    } finally {
      server.close();
    }
  }

  it("throws 401 when credentials are missing", async () => {
    const provider = createCloudflareProvider({
      accountId: "acct-123",
      apiToken: undefined,
      apiBaseUrl: "http://localhost:1",
    });
    // Clear ambient env fallbacks for this test.
    const savedId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const savedToken = process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    try {
      await expect(
        provider.execute(sampleRequest, callContext()),
      ).rejects.toMatchObject({ status: 401 });
    } finally {
      if (savedId !== undefined) process.env.CLOUDFLARE_ACCOUNT_ID = savedId;
      if (savedToken !== undefined) process.env.CLOUDFLARE_API_TOKEN = savedToken;
    }
  });

  it("propagates 429 rate limits", async () => {
    await withStatusServer(429, { success: false, errors: ["rate limited"] }, async (port) => {
      const provider = createCloudflareProvider({
        accountId: "a",
        apiToken: "t",
        apiBaseUrl: `http://localhost:${port}`,
      });
      await expect(provider.execute(sampleRequest, callContext())).rejects.toMatchObject({
        status: 429,
      });
    });
  });

  it("propagates 500 server errors with body detail", async () => {
    await withStatusServer(500, { success: false, errors: ["boom"] }, async (port) => {
      const provider = createCloudflareProvider({
        accountId: "a",
        apiToken: "t",
        apiBaseUrl: `http://localhost:${port}`,
      });
      await expect(provider.execute(sampleRequest, callContext())).rejects.toMatchObject({
        status: 500,
        message: expect.stringContaining("boom"),
      });
    });
  });
});

describe("Cloudflare Clef provider (binding)", () => {
  it("calls the Workers AI binding with the full model id", async () => {
    const calls: Array<{ model: string; options: unknown }> = [];
    const provider = createCloudflareProvider({
      binding: {
        run: async (model, options) => {
          calls.push({ model, options });
          return sampleResponse;
        },
      },
    });

    const response = await provider.execute(sampleRequest, callContext());
    expect(response).toEqual(sampleResponse);
    expect(calls).toHaveLength(1);
    // Binding receives the full Workers AI model id…
    expect(calls[0].model).toBe(CLEF_MODEL_ID);
    // …and the body uses the Clef shorthand.
    expect((calls[0].options as { model: string }).model).toBe("clef");
    expect((calls[0].options as { stream: boolean }).stream).toBe(false);
  });

  it("binding path honors clef-flash per request", async () => {
    const calls: Array<{ model: string }> = [];
    const provider = createCloudflareProvider({
      binding: {
        run: async (model) => {
          calls.push({ model });
          return sampleResponse;
        },
      },
    });
    await provider.execute(
      { ...sampleRequest, model: "clef-flash" },
      callContext(),
    );
    expect(calls[0].model).toBe(CLEF_FLASH_MODEL_ID);
  });
});

describe("Cloudflare Clef provider (health)", () => {
  it("is available with binding", async () => {
    const provider = createCloudflareProvider({
      binding: { run: async () => sampleResponse },
    });
    const health = await provider.health({ now: new Date().toISOString(), deadlineMs: 1000 });
    expect(health.available).toBe(true);
  });

  it("is unavailable without credentials", async () => {
    const savedId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const savedToken = process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    try {
      const provider = createCloudflareProvider();
      const health = await provider.health({ now: new Date().toISOString(), deadlineMs: 1000 });
      expect(health.available).toBe(false);
    } finally {
      if (savedId !== undefined) process.env.CLOUDFLARE_ACCOUNT_ID = savedId;
      if (savedToken !== undefined) process.env.CLOUDFLARE_API_TOKEN = savedToken;
    }
  });
});

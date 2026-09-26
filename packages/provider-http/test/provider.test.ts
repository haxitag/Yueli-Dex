import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { createHttpProvider } from "../src/index.js";
import type { ChoiceRequest, ChoiceResponse } from "@haxitag/yueli-dex-plugin-sdk";

const DECISION_ID = "test-decision";
const REQUEST_HASH = "hash";

const sampleRequest: ChoiceRequest = {
  state: "test state",
  model: "jev-latest",
  questions: {
    handler: {
      type: "choice",
      instructions: "Which team?",
      criteria: { billing: "billing", technical: "technical" },
    },
  },
};

const sampleResponse: ChoiceResponse = {
  model: "jev-1.0.0",
  answers: {
    handler: {
      type: "choice",
      choice: "billing",
      confidence: 0.9,
      probabilities: { billing: 0.9, technical: 0.1 },
    },
  },
};

function startFixtureServer(
  handler: (req: { method: string; url: string; body: unknown }) => {
    status: number;
    body?: unknown;
  },
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      const result = handler({ method: req.method ?? "", url: req.url ?? "", body });
      res.writeHead(result.status, { "Content-Type": "application/json" });
      res.end(result.body !== undefined ? JSON.stringify(result.body) : "");
    });
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

describe("HTTP provider contract", () => {
  it("sends the canonical request and returns the canonical response", async () => {
    let receivedBody: unknown;
    const { server, port } = await startFixtureServer((req) => {
      receivedBody = req.body;
      return { status: 200, body: sampleResponse };
    });
    try {
      const provider = createHttpProvider({ id: "test", endpoint: `http://localhost:${port}` });
      const response = await provider.execute(sampleRequest, {
        decisionId: DECISION_ID,
        requestHash: REQUEST_HASH,
        deadlineMs: 5000,
        attempt: 1,
      });
      expect(response).toEqual(sampleResponse);
      expect(receivedBody).toEqual(sampleRequest);
    } finally {
      server.close();
    }
  });

  it("forwards headers including decision ID", async () => {
    let receivedHeaders: Record<string, string> = {};
    const { server, port } = await startFixtureServer((req) => {
      receivedHeaders = {};
      return { status: 200, body: sampleResponse };
    });
    // Override to capture headers
    server.removeAllListeners("request");
    server.on("request", async (req, res) => {
      receivedHeaders = Object.fromEntries(
        Object.entries(req.headers).filter(([k]) => k.toLowerCase().startsWith("x-dex")),
      ) as Record<string, string>;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(sampleResponse));
    });
    try {
      const provider = createHttpProvider({ id: "test", endpoint: `http://localhost:${port}` });
      await provider.execute(sampleRequest, {
        decisionId: DECISION_ID,
        requestHash: REQUEST_HASH,
        deadlineMs: 5000,
        attempt: 1,
      });
      expect(receivedHeaders["x-dex-decision-id"]).toBe(DECISION_ID);
    } finally {
      server.close();
    }
  });

  it("throws on 401 (auth failure)", async () => {
    const { server, port } = await startFixtureServer(() => ({ status: 401, body: { error: "unauthorized" } }));
    try {
      const provider = createHttpProvider({ id: "test", endpoint: `http://localhost:${port}` });
      await expect(
        provider.execute(sampleRequest, {
          decisionId: DECISION_ID,
          requestHash: REQUEST_HASH,
          deadlineMs: 5000,
          attempt: 1,
        }),
      ).rejects.toMatchObject({ status: 401 });
    } finally {
      server.close();
    }
  });

  it("throws on 429 (rate limit)", async () => {
    const { server, port } = await startFixtureServer(() => ({ status: 429, body: { error: "rate limited" } }));
    try {
      const provider = createHttpProvider({ id: "test", endpoint: `http://localhost:${port}` });
      await expect(
        provider.execute(sampleRequest, {
          decisionId: DECISION_ID,
          requestHash: REQUEST_HASH,
          deadlineMs: 5000,
          attempt: 1,
        }),
      ).rejects.toMatchObject({ status: 429 });
    } finally {
      server.close();
    }
  });

  it("throws on 500 (server error)", async () => {
    const { server, port } = await startFixtureServer(() => ({ status: 500, body: { error: "internal" } }));
    try {
      const provider = createHttpProvider({ id: "test", endpoint: `http://localhost:${port}` });
      await expect(
        provider.execute(sampleRequest, {
          decisionId: DECISION_ID,
          requestHash: REQUEST_HASH,
          deadlineMs: 5000,
          attempt: 1,
        }),
      ).rejects.toMatchObject({ status: 500 });
    } finally {
      server.close();
    }
  });

  it("injects model override when request has no model", async () => {
    let receivedBody: unknown;
    const { server, port } = await startFixtureServer((req) => {
      receivedBody = req.body;
      return { status: 200, body: sampleResponse };
    });
    try {
      const provider = createHttpProvider({
        id: "test",
        endpoint: `http://localhost:${port}`,
        model: "jev-custom",
      });
      await provider.execute(
        { ...sampleRequest, model: undefined },
        { decisionId: DECISION_ID, requestHash: REQUEST_HASH, deadlineMs: 5000, attempt: 1 },
      );
      expect((receivedBody as { model?: string }).model).toBe("jev-custom");
    } finally {
      server.close();
    }
  });

  it("does not override model when request specifies one", async () => {
    let receivedBody: unknown;
    const { server, port } = await startFixtureServer((req) => {
      receivedBody = req.body;
      return { status: 200, body: sampleResponse };
    });
    try {
      const provider = createHttpProvider({
        id: "test",
        endpoint: `http://localhost:${port}`,
        model: "jev-custom",
      });
      await provider.execute(sampleRequest, {
        decisionId: DECISION_ID,
        requestHash: REQUEST_HASH,
        deadlineMs: 5000,
        attempt: 1,
      });
      expect((receivedBody as { model?: string }).model).toBe("jev-latest");
    } finally {
      server.close();
    }
  });

  it("health check returns available when server responds 200", async () => {
    const { server, port } = await startFixtureServer(() => ({ status: 200, body: { ok: true } }));
    try {
      const provider = createHttpProvider({ id: "test", endpoint: `http://localhost:${port}` });
      const health = await provider.health({ now: new Date().toISOString(), deadlineMs: 5000 });
      expect(health.available).toBe(true);
    } finally {
      server.close();
    }
  });

  it("health check returns unavailable when server is down", async () => {
    const provider = createHttpProvider({ id: "test", endpoint: "http://localhost:1" });
    const health = await provider.health({ now: new Date().toISOString(), deadlineMs: 2000 });
    expect(health.available).toBe(false);
  });
});

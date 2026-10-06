import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { createDex } from "@haxitag/yueli-dex";
import { createCloudflareProvider } from "@haxitag/yueli-dex-provider-cloudflare";
import type { TemplatePack } from "@haxitag/yueli-dex-plugin-sdk";
import type { RoutingConfig } from "@haxitag/yueli-dex/types.js";

/**
 * End-to-end test for the Cloudflare Clef integration.
 *
 * A local fixture server emulates the Workers AI Account REST endpoint
 * (`POST /client/v4/accounts/:id/ai/run/@cf/cloudflare/clef[:flash]`)
 * including the `{ success, result }` envelope, and the full DEX flow
 * (template → routing → Clef → receipt) is exercised.
 */

interface Captured {
  url: string;
  body: { model?: string; state?: unknown; questions?: unknown };
}

function startClefFixtureServer(opts: {
  failFlash?: boolean;
}): Promise<{ server: Server; port: number; requests: Captured[] }> {
  const requests: Captured[] = [];
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      const captured: Captured = { url: req.url ?? "", body };
      requests.push(captured);

      const isFlash = (req.url ?? "").endsWith("clef-flash");

      if (opts.failFlash && isFlash) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, errors: ["model overloaded"] }));
        return;
      }

      // Jev-compatible Clef response wrapped in the Workers AI REST envelope.
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          result: {
            model: isFlash ? "clef-flash" : "clef",
            answers: {
              handler: {
                type: "choice",
                choice: isFlash ? "technical" : "billing",
                confidence: isFlash ? 0.91 : 0.96,
                probabilities: {
                  billing: isFlash ? 0.05 : 0.96,
                  technical: isFlash ? 0.91 : 0.03,
                  needs_review: isFlash ? 0.04 : 0.01,
                },
              },
            },
            usage: { input_tokens: 74, output_tokens: 5 },
          },
        }),
      );
    });
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port, requests });
    });
  });
}

const supportTriagePack: TemplatePack = {
  id: "support-pack",
  version: "1.0.0",
  templates: [
    {
      apiVersion: "yueli-dex-template/v1",
      id: "support-triage",
      version: "1.0.0",
      state: { from: { message: "$.message" } },
      choices: [
        {
          id: "handler",
          instructions: "Which team should own this request?",
          criteria: {
            billing: "Payments, invoices, refunds, and subscriptions",
            technical: "Product bugs, incidents, and integrations",
            needs_review: "Evidence is insufficient or spans multiple teams",
          },
        },
      ],
      constraints: { requireFallbackOption: "needs_review", maxOptions: 12 },
      actions: {
        handler: {
          billing: { kind: "queue.assign", queue: "billing" },
          technical: { kind: "queue.assign", queue: "technical" },
          needs_review: { kind: "review.request" },
        },
      },
    },
  ],
};

describe("end-to-end: Cloudflare Clef provider", () => {
  let server: Server;
  let port: number;
  let requests: Captured[];

  beforeAll(async () => {
    const fixture = await startClefFixtureServer({});
    server = fixture.server;
    port = fixture.port;
    requests = fixture.requests;
  });

  afterAll(() => server.close());

  function clefProvider(overrides: Parameters<typeof createCloudflareProvider>[0] = {}) {
    return createCloudflareProvider({
      id: "cf-clef",
      accountId: "acct-e2e",
      apiToken: "tok-e2e",
      apiBaseUrl: `http://localhost:${port}`,
      ...overrides,
    });
  }

  it("completes template → routing → Clef REST → receipt, unwrapping the Workers AI envelope", async () => {
    const routing: RoutingConfig = {
      default: {
        providerIds: ["cf-clef"],
        maxAttempts: 2,
        circuitFailureThreshold: 3,
        circuitCooldownMs: 60000,
      },
    };
    const dex = createDex({
      providers: [clefProvider()],
      routing,
      templates: [supportTriagePack],
    });

    const request = await dex.templates.prepare({
      template: "support-triage",
      input: { message: "I was charged twice this month." },
    });

    let receipt: unknown;
    dex.on("choice.completed", (e) => { receipt = e.receipt; });

    const response = await dex.choice(request);

    // Clef response unwrapped from { success, result } envelope.
    expect(response.model).toBe("clef");
    expect(response.answers.handler.choice).toBe("billing");
    expect(response.usage).toEqual({ input_tokens: 74, output_tokens: 5 });

    // Receipt audit: the decision routed through the Clef provider.
    const r = receipt as {
      decisionId: string;
      route: { selectedProviderId: string };
      usage: { input_tokens: number };
    };
    expect(r.decisionId).toMatch(/^dex_/);
    expect(r.route.selectedProviderId).toBe("cf-clef");
    expect(r.usage.input_tokens).toBe(74);

    // The fixture saw the canonical Clef REST call.
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(`/client/v4/accounts/acct-e2e/ai/run/@cf/cloudflare/clef`);
    expect(requests[0].body.model).toBe("clef");
    expect(requests[0].body.questions).toBeDefined();
  });

  it("ActionIntent evidence carries Clef probabilities and model id", async () => {
    const dex = createDex({
      providers: [clefProvider()],
      routing: {
        default: {
          providerIds: ["cf-clef"],
          maxAttempts: 1,
          circuitFailureThreshold: 3,
          circuitCooldownMs: 60000,
        },
      },
      templates: [supportTriagePack],
    });
    const request = await dex.templates.prepare({
      template: "support-triage",
      input: { message: "My checkout is broken." },
    });
    const response = await dex.choice({ ...request, model: "clef-flash" });

    expect(response.model).toBe("clef-flash");
    expect(response.answers.handler.choice).toBe("technical");

    const intents = dex.templates.toActionIntent({
      template: "support-triage",
      request,
      response,
    });
    expect(intents).toHaveLength(1);
    expect(intents[0].kind).toBe("queue.assign");
    expect(intents[0].confidence).toBeCloseTo(0.91, 6);
    expect(intents[0].probabilities).toMatchObject({ technical: 0.91 });
  });
});

describe("end-to-end: clef-flash primary with clef fallback", () => {
  it("fails over from clef-flash to clef when flash is overloaded", async () => {
    // Flash returns 500 (model overloaded); clef succeeds.
    const { server, port, requests } = await startClefFixtureServer({ failFlash: true });
    try {
      const flash = createCloudflareProvider({
        id: "cf-clef-flash",
        accountId: "acct-e2e",
        apiToken: "tok-e2e",
        apiBaseUrl: `http://localhost:${port}`,
        model: "clef-flash",
      });
      const primary = createCloudflareProvider({
        id: "cf-clef",
        accountId: "acct-e2e",
        apiToken: "tok-e2e",
        apiBaseUrl: `http://localhost:${port}`,
      });

      const routing: RoutingConfig = {
        default: {
          providerIds: ["cf-clef-flash", "cf-clef"],
          maxAttempts: 2,
          circuitFailureThreshold: 3,
          circuitCooldownMs: 60000,
          retryableStatusCodes: [500],
        },
      };
      const dex = createDex({ providers: [flash, primary], routing });

      let receipt: unknown;
      dex.on("choice.completed", (e) => { receipt = e.receipt; });

      const response = await dex.choice({
        state: "Support request routed during a flash outage.",
        questions: {
          handler: {
            type: "choice",
            instructions: "Which team?",
            criteria: {
              billing: "billing",
              technical: "technical",
              needs_review: "review",
            },
          },
        },
      });

      // Fallback answered via the full clef model.
      expect(response.model).toBe("clef");
      expect(response.answers.handler.choice).toBe("billing");

      const r = receipt as {
        route: {
          selectedProviderId: string;
          attempts: Array<{ providerId: string; outcome: string }>;
        };
      };
      expect(r.route.selectedProviderId).toBe("cf-clef");
      expect(r.route.attempts).toHaveLength(2);
      expect(r.route.attempts[0].outcome).toBe("failed");
      expect(r.route.attempts[1].outcome).toBe("success");

      // First attempt hit the flash endpoint, second the full model.
      expect(requests[0].url).toBe(`/client/v4/accounts/acct-e2e/ai/run/@cf/cloudflare/clef-flash`);
      expect(requests[1].url).toBe(`/client/v4/accounts/acct-e2e/ai/run/@cf/cloudflare/clef`);
    } finally {
      server.close();
    }
  });
});

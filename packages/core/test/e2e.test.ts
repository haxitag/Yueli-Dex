import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { createDex } from "../src/index.js";
import { createHttpProvider } from "../../provider-http/src/index.js";
import type { ChoiceRequest, ChoiceResponse, TemplatePack } from "@haxitag/yueli-dex-plugin-sdk";
import type { RuleSet, RoutingConfig } from "../src/types.js";

/**
 * End-to-end test: runs a deterministic local jev-choice/v1 fixture server
 * and exercises the full three-layer DEX flow through the public SDK.
 */

const supportTriagePack: TemplatePack = {
  id: "support-pack",
  version: "1.0.0",
  templates: [
    {
      apiVersion: "yueli-dex-template/v1",
      id: "support-triage",
      version: "1.0.0",
      state: { from: { message: "$.message", accountPlan: "$.account.plan" } },
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

function startJevFixtureServer(): Promise<{ server: Server; port: number; requests: unknown[] }> {
  const requests: unknown[] = [];
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      requests.push(body);

      // Deterministic response: always select "billing" for handler question
      const response: ChoiceResponse = {
        model: "jev-fixture@1.0.0",
        answers: {
          handler: {
            type: "choice",
            choice: "billing",
            confidence: 0.92,
            probabilities: { billing: 0.92, technical: 0.05, needs_review: 0.03 },
          },
        },
        usage: { input_tokens: 120, output_tokens: 15 },
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
    });
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port, requests });
    });
  });
}

describe("end-to-end: local fixture server", () => {
  let server: Server;
  let port: number;
  let requests: unknown[];

  beforeAll(async () => {
    const fixture = await startJevFixtureServer();
    server = fixture.server;
    port = fixture.port;
    requests = fixture.requests;
  });

  afterAll(() => server.close());

  it("completes the full three-layer flow: template -> choice -> action intent", async () => {
    const provider = createHttpProvider({ id: "local-jev", endpoint: `http://localhost:${port}` });
    const routing: RoutingConfig = {
      default: {
        providerIds: ["local-jev"],
        maxAttempts: 2,
        circuitFailureThreshold: 3,
        circuitCooldownMs: 60000,
      },
    };
    const dex = createDex({ providers: [provider], routing, templates: [supportTriagePack] });

    // Layer 1 & 2: template compilation
    const request = await dex.templates.prepare({
      template: "support-triage",
      input: { message: "I was charged twice.", account: { plan: "pro" } },
    });
    expect(request.questions.handler.criteria).toHaveProperty("billing");

    // Layer 3: choice execution
    let receipt: unknown;
    dex.on("choice.completed", (e) => { receipt = e.receipt; });
    const response = await dex.choice(request);

    expect(response.model).toBe("jev-fixture@1.0.0");
    expect(response.answers.handler.choice).toBe("billing");
    expect(response.usage).toEqual({ input_tokens: 120, output_tokens: 15 });

    // Action intent mapping
    const intents = dex.templates.toActionIntent({
      template: "support-triage",
      request,
      response,
    });
    expect(intents).toHaveLength(1);
    expect(intents[0]).toEqual({
      template: { id: "support-triage", version: "1.0.0" },
      questionId: "handler",
      choice: "billing",
      kind: "queue.assign",
      params: { queue: "billing" },
      // P1-5: evidence fields are populated from ChoiceAnswer when present.
      confidence: 0.92,
      probabilities: { billing: 0.92, technical: 0.05, needs_review: 0.03 },
    });

    // Receipt audit
    const r = receipt as { decisionId: string; route: { selectedProviderId: string }; usage: { input_tokens: number } };
    expect(r.decisionId).toMatch(/^dex_/);
    expect(r.route.selectedProviderId).toBe("local-jev");
    expect(r.usage.input_tokens).toBe(120);

    // The provider received exactly the canonical request (no DEX fields)
    expect(requests).toHaveLength(1);
    const sent = requests[0] as ChoiceRequest;
    expect(sent).not.toHaveProperty("provider");
    expect(sent).not.toHaveProperty("route");
    expect(sent.questions.handler.type).toBe("choice");
  });

  it("rules can short-circuit without calling the provider", async () => {
    requests.length = 0;
    const ruleSet: RuleSet = {
      id: "short-circuit",
      version: "1.0.0",
      scope: "organization",
      document: {
        apiVersion: "yueli-dex-rules/v1",
        rules: [
          {
            id: "always-review",
            when: { path: "$.input.message", op: "equals", value: "uncertain" },
            then: { kind: "shortCircuit", questionId: "handler", choice: "needs_review" },
          },
        ],
      },
    };
    const provider = createHttpProvider({ id: "local-jev", endpoint: `http://localhost:${port}` });
    const dex = createDex({
      providers: [provider],
      routing: {
        default: {
          providerIds: ["local-jev"],
          maxAttempts: 1,
          circuitFailureThreshold: 3,
          circuitCooldownMs: 60000,
        },
      },
      templates: [supportTriagePack],
      ruleSets: [ruleSet],
    });

    const request = await dex.templates.prepare({
      template: "support-triage",
      input: { message: "uncertain", account: { plan: "free" } },
    });
    const response = await dex.choice(request);
    expect(response.model).toBe("yueli-dex/rules@1");
    expect(response.answers.handler.choice).toBe("needs_review");
    // Provider was never called
    expect(requests).toHaveLength(0);
  });

  it("multi-provider failover works when primary is down", async () => {
    requests.length = 0;
    // Start a second provider that always returns 500 for choice but 200 for health
    const failingServer = createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "fail" }));
    });
    const failingPort = await new Promise<number>((resolve) => {
      failingServer.listen(0, () => {
        const addr = failingServer.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    try {
      const primary = createHttpProvider({ id: "primary", endpoint: `http://localhost:${failingPort}` });
      const secondary = createHttpProvider({ id: "secondary", endpoint: `http://localhost:${port}` });
      const dex = createDex({
        providers: [primary, secondary],
        routing: {
          default: {
            providerIds: ["primary", "secondary"],
            maxAttempts: 2,
            circuitFailureThreshold: 3,
            circuitCooldownMs: 60000,
            retryableStatusCodes: [500],
          },
        },
      });

      let receipt: unknown;
      dex.on("choice.completed", (e) => { receipt = e.receipt; });
      const response = await dex.choice({
        state: "test",
        questions: {
          handler: {
            type: "choice",
            instructions: "Which team?",
            criteria: {
              billing: "billing",
              technical: "technical",
              needs_review: "needs review",
            },
          },
        },
      });
      expect(response.answers.handler.choice).toBeDefined();
      const r = receipt as { route: { selectedProviderId: string; attempts: Array<{ providerId: string; outcome: string }> } };
      expect(r.route.selectedProviderId).toBe("secondary");
      expect(r.route.attempts).toHaveLength(2);
      expect(r.route.attempts[0].outcome).toBe("failed");
      expect(r.route.attempts[1].outcome).toBe("success");
    } finally {
      failingServer.close();
    }
  });
});

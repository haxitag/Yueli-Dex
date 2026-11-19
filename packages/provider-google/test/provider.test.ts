import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import {
  createGoogleProvider,
  stateToGoogleInput,
  instructionsToText,
  GOOGLE_DECISION_MODEL_ID,
} from "../src/index.js";
import type { ChoiceRequest } from "@haxitag/yueli-dex-plugin-sdk";

const DECISION_ID = "test-decision";
const REQUEST_HASH = "hash";

const audioBlock = {
  type: "audio",
  uri: "https://storage.googleapis.com/generativeai-downloads/audio/rehearsing.wav",
  mime_type: "audio/wav",
};

const sampleRequest: ChoiceRequest = {
  state: [audioBlock],
  questions: {
    mentions_launch: {
      type: "noul",
      instructions: "Is the speaker talking about a product campaign launch?",
    },
    delivery: {
      type: "score",
      instructions: "How fluent and prepared does the speaker sound?",
      criteria: [
        "Hesitant, searching for notes, or self-correcting.",
        "Mostly steady with minor pauses.",
        "Polished, fluent, and confident throughout.",
      ],
    },
    route: {
      type: "choice",
      instructions: "Which queue should handle the recording?",
      criteria: {
        qa: "Quality review for a prepared speech.",
        sales: "Outbound campaign content.",
      },
    },
  },
};

const sampleAnswerPayload = {
  answers: {
    mentions_launch: { type: "noul", noul: 0.88, confidence: 0.88 },
    delivery: {
      type: "score",
      score: 1.12,
      confidence: 0.83,
      probabilities: { "0": 0.03, "1": 0.83, "2": 0.14 },
      legend: {
        "0": "Hesitant, searching for notes, or self-correcting.",
        "1": "Mostly steady with minor pauses.",
        "2": "Polished, fluent, and confident throughout.",
      },
    },
    route: {
      type: "choice",
      choice: "qa",
      confidence: 0.7,
      probabilities: { qa: 0.7, sales: 0.3 },
    },
  },
  usage: {
    total_input_tokens: 1200,
    total_output_tokens: 0,
    total_tokens: 1200,
    input_tokens_by_modality: [{ modality: "audio", tokens: 1200 }],
  },
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

function callContext(overrides: Record<string, unknown> = {}) {
  return {
    decisionId: DECISION_ID,
    requestHash: REQUEST_HASH,
    deadlineMs: 5000,
    attempt: 1,
    ...overrides,
  };
}

describe("stateToGoogleInput", () => {
  it("passes text through unchanged", () => {
    expect(stateToGoogleInput("hello")).toBe("hello");
  });

  it("passes media block arrays through", () => {
    expect(stateToGoogleInput([audioBlock])).toEqual([audioBlock]);
  });

  it("serializes structured state to JSON text", () => {
    expect(stateToGoogleInput({ order: { id: "8821" } })).toBe('{"order":{"id":"8821"}}');
  });
});

describe("instructionsToText", () => {
  it("keeps strings as-is", () => {
    expect(instructionsToText("Is it damaged?")).toBe("Is it damaged?");
  });

  it("joins text blocks with newlines", () => {
    expect(
      instructionsToText([{ type: "text", text: "Line one" }, { type: "text", text: "Line two" }]),
    ).toBe("Line one\nLine two");
  });

  it("serializes non-text instructions", () => {
    expect(instructionsToText({ rule: "check" })).toBe('{"rule":"check"}');
  });
});

describe("Google Decisions provider (REST)", () => {
  let server: Server;
  let port: number;
  let requests: CapturedRequest[];

  beforeAll(async () => {
    const fixture = await startFixtureServer(() => ({
      status: 200,
      body: sampleAnswerPayload,
    }));
    server = fixture.server;
    port = fixture.port;
    requests = fixture.requests;
  });

  afterAll(() => server.close());

  function makeProvider(overrides: Parameters<typeof createGoogleProvider>[0] = {}) {
    return createGoogleProvider({
      apiKey: "test-key",
      apiBaseUrl: `http://localhost:${port}`,
      ...overrides,
    });
  }

  it("declares noul, choice, score and multimodal capabilities", () => {
    const provider = makeProvider();
    expect(provider.manifest.id).toBe("google-gemini-decision");
    expect(provider.manifest.capabilities).toEqual([
      "choice",
      "noul",
      "score",
      "multimodal",
    ]);
  });

  it("posts mixed-type questions with one multimodal input", async () => {
    const provider = makeProvider();
    await provider.execute(sampleRequest, callContext());

    expect(requests).toHaveLength(1);
    const captured = requests[0];
    expect(captured.method).toBe("POST");
    expect(captured.url).toBe("/v1beta/decisions");
    expect(captured.headers["x-goog-api-key"]).toBe("test-key");
    expect(captured.headers["x-dex-decision-id"]).toBe(DECISION_ID);

    const body = captured.body as {
      model: string;
      input: unknown;
      questions: Record<string, { type: string; instructions: string; criteria?: unknown }>;
    };
    expect(body.model).toBe(GOOGLE_DECISION_MODEL_ID);
    expect(body.input).toEqual([audioBlock]);
    expect(body.questions.mentions_launch).toEqual({
      type: "noul",
      instructions: "Is the speaker talking about a product campaign launch?",
    });
    expect(body.questions.delivery.type).toBe("score");
    expect(body.questions.delivery.criteria).toEqual(sampleRequest.questions.delivery.criteria);
    expect(body.questions.route).toEqual({
      type: "choice",
      instructions: "Which queue should handle the recording?",
      criteria: {
        qa: "Quality review for a prepared speech.",
        sales: "Outbound campaign content.",
      },
    });
  });

  it("maps noul, score, and choice answers into the canonical response", async () => {
    const provider = makeProvider();
    const response = await provider.execute(sampleRequest, callContext());

    expect(response.model).toBe(GOOGLE_DECISION_MODEL_ID);
    expect(response.answers.mentions_launch).toEqual({
      type: "noul",
      noul: 0.88,
      confidence: 0.88,
    });
    const delivery = response.answers.delivery;
    expect(delivery.type).toBe("score");
    if (delivery.type === "score") {
      expect(delivery.score).toBe(1.12);
      expect(delivery.legend?.["1"]).toBe("Mostly steady with minor pauses.");
    }
    expect(response.answers.route).toEqual({
      type: "choice",
      choice: "qa",
      confidence: 0.7,
      probabilities: { qa: 0.7, sales: 0.3 },
    });
  });

  it("maps Google usage to input/output tokens", async () => {
    const provider = makeProvider();
    const response = await provider.execute(sampleRequest, callContext());
    expect(response.usage).toEqual({
      input_tokens: 1200,
      output_tokens: 0,
      input_tokens_by_modality: [{ modality: "audio", tokens: 1200 }],
    });
  });

  it("serializes object state as a shared text input", async () => {
    const provider = makeProvider();
    await provider.execute(
      { ...sampleRequest, state: { message: "I was charged twice." } },
      callContext(),
    );
    const captured = requests[requests.length - 1];
    expect((captured.body as { input: string }).input).toBe(
      '{"message":"I was charged twice."}',
    );
  });

  it("request.model takes precedence over provider config", async () => {
    const provider = makeProvider({ model: "gemini-decision-preview" });
    await provider.execute({ ...sampleRequest, model: GOOGLE_DECISION_MODEL_ID }, callContext());
    const captured = requests[requests.length - 1];
    expect((captured.body as { model: string }).model).toBe(GOOGLE_DECISION_MODEL_ID);
  });

  it("uses the configured model when the request omits one", async () => {
    const provider = makeProvider({ model: "gemini-decision-preview" });
    await provider.execute(sampleRequest, callContext());
    const captured = requests[requests.length - 1];
    expect((captured.body as { model: string }).model).toBe("gemini-decision-preview");
  });

  it("honors a custom mapState hook", async () => {
    const provider = makeProvider({ mapState: () => "custom input" });
    await provider.execute(sampleRequest, callContext());
    const captured = requests[requests.length - 1];
    expect((captured.body as { input: string }).input).toBe("custom input");
  });
});

describe("Google Decisions provider (validation)", () => {
  it("rejects an invalid question key before calling the network", async () => {
    const provider = createGoogleProvider({
      apiKey: "test-key",
      apiBaseUrl: "http://localhost:1",
    });
    const request: ChoiceRequest = {
      state: "x",
      questions: {
        "bad key.with spaces": { type: "noul", instructions: "Check?" },
      },
    };
    await expect(provider.execute(request, callContext())).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("[A-Za-z0-9_-]+"),
    });
  });

  it("rejects a choice question with fewer than two options", async () => {
    const provider = createGoogleProvider({
      apiKey: "test-key",
      apiBaseUrl: "http://localhost:1",
    });
    const request: ChoiceRequest = {
      state: "x",
      questions: {
        route: { type: "choice", instructions: "Pick", criteria: { only: "Only option" } },
      },
    };
    await expect(provider.execute(request, callContext())).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe("Google Decisions provider (errors and health)", () => {
  it("throws 401 when the API key is missing", async () => {
    const savedGemini = process.env.GEMINI_API_KEY;
    const savedGoogle = process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    try {
      const provider = createGoogleProvider({ apiBaseUrl: "http://localhost:1" });
      await expect(provider.execute(sampleRequest, callContext())).rejects.toMatchObject({
        status: 401,
      });
      const health = await provider.health({
        now: new Date().toISOString(),
        deadlineMs: 1000,
      });
      expect(health.available).toBe(false);
    } finally {
      if (savedGemini !== undefined) process.env.GEMINI_API_KEY = savedGemini;
      if (savedGoogle !== undefined) process.env.GOOGLE_API_KEY = savedGoogle;
    }
  });

  it("surfaces safety blocks with the Google error code", async () => {
    const fixture = await startFixtureServer(() => ({
      status: 400,
      body: {
        error: {
          code: "safety",
          message: "Request blocked due to safety violations (harmful content).",
        },
      },
    }));
    try {
      const provider = createGoogleProvider({
        apiKey: "test-key",
        apiBaseUrl: `http://localhost:${fixture.port}`,
      });
      await expect(provider.execute(sampleRequest, callContext())).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining("safety"),
      });
    } finally {
      fixture.server.close();
    }
  });

  it("propagates 429 rate limits", async () => {
    const fixture = await startFixtureServer(() => ({
      status: 429,
      body: { error: { code: "rate_limit", message: "Too many requests" } },
    }));
    try {
      const provider = createGoogleProvider({
        apiKey: "test-key",
        apiBaseUrl: `http://localhost:${fixture.port}`,
      });
      await expect(provider.execute(sampleRequest, callContext())).rejects.toMatchObject({
        status: 429,
      });
    } finally {
      fixture.server.close();
    }
  });

  it("is available when an API key is configured", async () => {
    const provider = createGoogleProvider({ apiKey: "test-key" });
    const health = await provider.health({
      now: new Date().toISOString(),
      deadlineMs: 1000,
    });
    expect(health.available).toBe(true);
  });
});

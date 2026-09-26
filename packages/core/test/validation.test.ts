import { describe, it, expect } from "vitest";
import { validateChoiceRequest, validateChoiceResponse, buildShortCircuitResponse } from "../src/validation.js";
import type { ChoiceRequest, ChoiceResponse } from "@haxitag/yueli-dex-plugin-sdk";

const DECISION_ID = "test-decision";

const validRequest: ChoiceRequest = {
  state: "I was charged twice.",
  model: "jev-latest",
  questions: {
    handler: {
      type: "choice",
      instructions: "Which team should handle this?",
      criteria: {
        billing: "Payments and refunds",
        technical: "Product bugs",
        needs_review: "Insufficient evidence",
      },
    },
  },
};

describe("validateChoiceRequest", () => {
  it("accepts a valid Choice request", () => {
    const result = validateChoiceRequest(validRequest, DECISION_ID);
    expect(result).toEqual(validRequest);
  });

  it("rejects request without state", () => {
    expect(() => validateChoiceRequest({ questions: {} }, DECISION_ID)).toThrow(/state/);
  });

  it("rejects request with no questions", () => {
    expect(() => validateChoiceRequest({ state: "x" }, DECISION_ID)).toThrow(/question/);
  });

  it("rejects non-choice question type", () => {
    const req = {
      state: "x",
      questions: { q: { type: "score", instructions: "x", criteria: { a: "b" } } },
    };
    expect(() => validateChoiceRequest(req, DECISION_ID)).toThrow(/type "choice"/);
  });

  it("rejects question with empty criteria", () => {
    const req = {
      state: "x",
      questions: { q: { type: "choice", instructions: "x", criteria: {} } },
    };
    expect(() => validateChoiceRequest(req, DECISION_ID)).toThrow(/criterion/);
  });

  it("rejects question with more than 255 options", () => {
    const criteria: Record<string, string> = {};
    for (let i = 0; i < 256; i++) criteria[`opt${i}`] = `Option ${i}`;
    const req = {
      state: "x",
      questions: { q: { type: "choice", instructions: "x", criteria } },
    };
    expect(() => validateChoiceRequest(req, DECISION_ID)).toThrow(/255/);
  });

  it("accepts exactly 255 options", () => {
    const criteria: Record<string, string> = {};
    for (let i = 0; i < 255; i++) criteria[`opt${i}`] = `Option ${i}`;
    const req = {
      state: "x",
      questions: { q: { type: "choice", instructions: "x", criteria } },
    };
    expect(() => validateChoiceRequest(req, DECISION_ID)).not.toThrow();
  });

  it("rejects empty criterion key", () => {
    const req = {
      state: "x",
      questions: { q: { type: "choice", instructions: "x", criteria: { "": "empty" } } },
    };
    expect(() => validateChoiceRequest(req, DECISION_ID)).toThrow(/empty criterion/);
  });

  it("allows model to be optional", () => {
    const req = { state: "x", questions: { q: { type: "choice", instructions: "x", criteria: { a: "b" } } } };
    const result = validateChoiceRequest(req, DECISION_ID);
    expect(result.model).toBeUndefined();
  });
});

describe("validateChoiceResponse", () => {
  it("accepts a valid Choice response", () => {
    const response: ChoiceResponse = {
      model: "jev-1.13.0",
      answers: {
        handler: {
          type: "choice",
          choice: "billing",
          confidence: 0.81,
          probabilities: { billing: 0.87, technical: 0.08, needs_review: 0.05 },
        },
      },
    };
    const result = validateChoiceResponse(validRequest, response, DECISION_ID, "p1");
    expect(result.answers.handler.choice).toBe("billing");
  });

  it("rejects response with unknown choice", () => {
    const response = {
      model: "jev",
      answers: {
        handler: {
          type: "choice",
          choice: "unknown",
          confidence: 0.5,
          probabilities: { billing: 0.5, technical: 0.3, needs_review: 0.2 },
        },
      },
    };
    expect(() => validateChoiceResponse(validRequest, response, DECISION_ID, "p1")).toThrow(/unknown option/);
  });

  it("rejects response with mismatched probability keys", () => {
    const response = {
      model: "jev",
      answers: {
        handler: {
          type: "choice",
          choice: "billing",
          confidence: 0.5,
          probabilities: { billing: 1 },
        },
      },
    };
    expect(() => validateChoiceResponse(validRequest, response, DECISION_ID, "p1")).toThrow(/probability keys/);
  });

  it("rejects probabilities not summing to 1", () => {
    const response = {
      model: "jev",
      answers: {
        handler: {
          type: "choice",
          choice: "billing",
          confidence: 0.5,
          probabilities: { billing: 0.5, technical: 0.3, needs_review: 0.1 },
        },
      },
    };
    expect(() => validateChoiceResponse(validRequest, response, DECISION_ID, "p1")).toThrow(/sum/);
  });

  it("rejects confidence out of [0,1]", () => {
    const response = {
      model: "jev",
      answers: {
        handler: {
          type: "choice",
          choice: "billing",
          confidence: 1.5,
          probabilities: { billing: 1, technical: 0, needs_review: 0 },
        },
      },
    };
    expect(() => validateChoiceResponse(validRequest, response, DECISION_ID, "p1")).toThrow(/confidence/);
  });

  it("rejects negative probability", () => {
    const response = {
      model: "jev",
      answers: {
        handler: {
          type: "choice",
          choice: "billing",
          confidence: 0.5,
          probabilities: { billing: 1.2, technical: -0.2, needs_review: 0 },
        },
      },
    };
    expect(() => validateChoiceResponse(validRequest, response, DECISION_ID, "p1")).toThrow(/non-negative/);
  });

  it("rejects missing answer for a question", () => {
    const response = {
      model: "jev",
      answers: {},
    };
    expect(() => validateChoiceResponse(validRequest, response, DECISION_ID, "p1")).toThrow(/match/);
  });

  it("accepts optional usage", () => {
    const response: ChoiceResponse = {
      model: "jev",
      answers: {
        handler: {
          type: "choice",
          choice: "billing",
          confidence: 0.9,
          probabilities: { billing: 0.9, technical: 0.05, needs_review: 0.05 },
        },
      },
      usage: { input_tokens: 100, output_tokens: 10 },
    };
    const result = validateChoiceResponse(validRequest, response, DECISION_ID, "p1");
    expect(result.usage).toEqual({ input_tokens: 100, output_tokens: 10 });
  });
});

describe("buildShortCircuitResponse", () => {
  it("produces a normalized response with the selected option at probability 1", () => {
    const response = buildShortCircuitResponse(validRequest, { handler: "billing" });
    expect(response.model).toBe("yueli-dex/rules@1");
    expect(response.answers.handler.choice).toBe("billing");
    expect(response.answers.handler.confidence).toBe(1);
    expect(response.answers.handler.probabilities.billing).toBe(1);
    expect(response.answers.handler.probabilities.technical).toBe(0);
    expect(response.answers.handler.probabilities.needs_review).toBe(0);
  });

  it("throws for unknown choice", () => {
    expect(() => buildShortCircuitResponse(validRequest, { handler: "nonexistent" })).toThrow();
  });

  it("throws when a question is missing from the decisions map (no fabrication)", () => {
    const multi: ChoiceRequest = {
      ...validRequest,
      questions: {
        ...validRequest.questions,
        priority: {
          type: "choice",
          instructions: "urgency",
          criteria: { urgent: "u", normal: "n" },
        },
      },
    };
    expect(() => buildShortCircuitResponse(multi, { priority: "urgent" })).toThrow(/missing pinned/);
  });
});

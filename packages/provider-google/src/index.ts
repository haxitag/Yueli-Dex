import type {
  ChoiceProvider,
  ChoiceRequest,
  ChoiceResponse,
  DecisionAnswer,
  DecisionQuestion,
  DecisionUsage,
  JsonValue,
  ProviderCallContext,
  ProviderHealth,
  ProviderHealthContext,
  ProviderManifest,
} from "@haxitag/yueli-dex-plugin-sdk";

/**
 * Google Gemini Decisions API provider.
 *
 * The Decisions API evaluates one shared multimodal input against 1–1,000
 * independent, typed questions (noul / choice / score) in a single forward
 * pass and returns calibrated probabilities without generating output tokens.
 *
 * Reference: https://aistudio.google.com/docs/decisions-api
 */

export const GOOGLE_DECISION_MODEL_ID = "gemini-decision-1";

const DEFAULT_API_BASE_URL = "https://generativelanguage.googleapis.com";
const DEFAULT_API_VERSION = "v1beta";
const DEFAULT_PROVIDER_ID = "google-gemini-decision";

const MAX_QUESTIONS = 1000;
const MIN_CHOICE_OPTIONS = 2;
const MAX_CHOICE_OPTIONS = 255;
const MAX_QUESTION_KEY_LENGTH = 64;
const QUESTION_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

export type GoogleMediaType = "image" | "audio" | "video" | "document";
export type GoogleResolution = "low" | "medium" | "high" | "ultra_high";

export interface GoogleTextBlock {
  readonly type: "text";
  readonly text: string;
}

export interface GoogleMediaBlock {
  readonly type: GoogleMediaType;
  /** Base64-encoded bytes. Mutually exclusive with `uri`. */
  readonly data?: string;
  /** Files API URI or a public/signed HTTPS URL (≤15 MB). */
  readonly uri?: string;
  readonly mime_type: string;
  /** Images and video only. */
  readonly resolution?: GoogleResolution;
}

export type GoogleContentBlock = GoogleTextBlock | GoogleMediaBlock;
export type GoogleInput = string | readonly GoogleContentBlock[];

export interface GoogleProviderConfig {
  readonly id?: string;
  /** Gemini API key. Reads GEMINI_API_KEY or GOOGLE_API_KEY if omitted. */
  readonly apiKey?: string;
  /** Model id. Defaults to `gemini-decision-1`. */
  readonly model?: string;
  /** Base URL. Defaults to `https://generativelanguage.googleapis.com`. */
  readonly apiBaseUrl?: string;
  /** API version path segment. Defaults to `v1beta`. */
  readonly apiVersion?: string;
  /**
   * Override how DEX `state` becomes Gemini `input`.
   *
   * Defaults:
   * - string → passed as the shared text input
   * - array of media blocks → passed through as multimodal input
   * - any other JSON → serialized with JSON.stringify as a text block
   */
  readonly mapState?: (state: JsonValue) => GoogleInput;
}

interface GoogleQuestion {
  readonly type: "noul" | "choice" | "score";
  readonly instructions: string;
  readonly criteria?: unknown;
}

interface GoogleDecisionRequest {
  readonly model: string;
  readonly input: GoogleInput;
  readonly questions: Readonly<Record<string, GoogleQuestion>>;
}

interface GoogleUsagePayload {
  readonly total_input_tokens?: number;
  readonly total_output_tokens?: number;
  readonly total_tokens?: number;
  readonly input_tokens_by_modality?: readonly {
    readonly modality: string;
    readonly tokens: number;
  }[];
}

interface GoogleAnswerPayload {
  readonly type?: string;
  readonly noul?: number;
  readonly choice?: string;
  readonly confidence?: number;
  readonly probabilities?: Readonly<Record<string, number>>;
  readonly score?: number;
  readonly legend?: Readonly<Record<string, string>>;
}

interface GoogleDecisionResponse {
  readonly answers?: Readonly<Record<string, GoogleAnswerPayload>>;
  readonly usage?: GoogleUsagePayload;
}

export interface GoogleDecisionRequestBody extends GoogleDecisionRequest {}

/* ------------------------------------------------------------------ */
/* Input mapping                                                       */
/* ------------------------------------------------------------------ */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMediaBlock(value: unknown): value is GoogleMediaBlock {
  if (!isPlainObject(value)) return false;
  const type = value.type;
  if (type !== "image" && type !== "audio" && type !== "video" && type !== "document") {
    return false;
  }
  if (typeof value.mime_type !== "string" || value.mime_type === "") return false;
  return typeof value.uri === "string" || typeof value.data === "string";
}

/** Map a DEX JSON `state` to a Gemini shared `input`. */
export function stateToGoogleInput(state: JsonValue): GoogleInput {
  if (typeof state === "string") return state;
  if (Array.isArray(state) && state.length > 0 && state.every(isMediaBlock)) {
    return state as unknown as readonly GoogleMediaBlock[];
  }
  // Google's guidance: serialize structured data to a string so nested keys
  // stay plain data instead of being parsed as content blocks.
  return JSON.stringify(state) ?? String(state);
}

function isTextBlock(value: unknown): value is GoogleTextBlock {
  return (
    isPlainObject(value) &&
    value.type === "text" &&
    typeof value.text === "string"
  );
}

/**
 * The Decisions API accepts text-only instructions. DEX permits arbitrary
 * JSON; serialize anything that is not already text.
 */
export function instructionsToText(instructions: JsonValue): string {
  if (typeof instructions === "string") return instructions;
  if (Array.isArray(instructions) && instructions.length > 0 && instructions.every(isTextBlock)) {
    // Adjacent text blocks are concatenated without a separator by the API.
    return (instructions as unknown as readonly GoogleTextBlock[])
      .map((block) => block.text)
      .join("\n");
  }
  return JSON.stringify(instructions);
}

function criterionDescription(value: JsonValue): string {
  // Choice criteria are option ID → description. Non-string descriptions
  // (Jev permits JSON) are serialized so the option still has a description.
  return typeof value === "string" ? value : JSON.stringify(value);
}

function invalidRequest(message: string): Error & { status?: number } {
  const err: Error & { status?: number } = new Error(message);
  err.status = 400;
  return err;
}

/**
 * Translate DEX questions into the Decisions API question shape.
 *
 * The model never sees question keys, so instructions must contain the full
 * question. Question keys are validated up front because answers come back
 * under the same keys.
 */
export function buildGoogleQuestions(
  questions: Readonly<Record<string, DecisionQuestion>>,
): Readonly<Record<string, GoogleQuestion>> {
  const entries = Object.entries(questions);
  if (entries.length === 0 || entries.length > MAX_QUESTIONS) {
    throw invalidRequest(
      `Gemini Decisions requires 1-${MAX_QUESTIONS} questions, received ${entries.length}`,
    );
  }

  const mapped: Record<string, GoogleQuestion> = {};
  for (const [questionId, question] of entries) {
    validateQuestionKey(questionId);

    switch (question.type) {
      case "noul":
        mapped[questionId] = {
          type: "noul",
          instructions: instructionsToText(question.instructions),
          ...(question.criteria !== undefined ? { criteria: question.criteria } : {}),
        };
        break;
      case "choice": {
        const optionKeys = Object.keys(question.criteria);
        if (optionKeys.length < MIN_CHOICE_OPTIONS || optionKeys.length > MAX_CHOICE_OPTIONS) {
          throw invalidRequest(
            `Question "${questionId}" has ${optionKeys.length} choice options; Gemini Decisions requires ${MIN_CHOICE_OPTIONS}-${MAX_CHOICE_OPTIONS}`,
          );
        }
        const criteria: Record<string, string> = {};
        for (const key of optionKeys) {
          criteria[key] = criterionDescription(question.criteria[key]);
        }
        mapped[questionId] = {
          type: "choice",
          instructions: instructionsToText(question.instructions),
          criteria,
        };
        break;
      }
      case "score":
        mapped[questionId] = {
          type: "score",
          instructions: instructionsToText(question.instructions),
          criteria: [...question.criteria],
        };
        break;
    }
  }
  return mapped;
}

function validateQuestionKey(questionId: string): void {
  if (
    questionId.length === 0 ||
    questionId.length > MAX_QUESTION_KEY_LENGTH ||
    !QUESTION_KEY_PATTERN.test(questionId)
  ) {
    throw invalidRequest(
      `Question key "${questionId}" is invalid for Gemini Decisions: it must match [A-Za-z0-9_-]+ and be at most ${MAX_QUESTION_KEY_LENGTH} characters`,
    );
  }
}

/** Build the wire request body for `POST /v1beta/decisions`. */
export function buildGoogleDecisionRequest(
  request: ChoiceRequest,
  model: string,
  mapState: (state: JsonValue) => GoogleInput = stateToGoogleInput,
): GoogleDecisionRequestBody {
  return {
    model,
    input: mapState(request.state),
    questions: buildGoogleQuestions(request.questions),
  };
}

/* ------------------------------------------------------------------ */
/* Response mapping                                                    */
/* ------------------------------------------------------------------ */

/** Map the Decisions API response onto the canonical DEX response. */
export function toDecisionResponse(
  payload: GoogleDecisionResponse,
  model: string,
): ChoiceResponse {
  const answers: Record<string, DecisionAnswer> = {};
  for (const [questionId, raw] of Object.entries(payload.answers ?? {})) {
    answers[questionId] = mapAnswer(raw);
  }

  const mapped: ChoiceResponse = { model, answers };

  const usage = mapUsage(payload.usage);
  return usage ? { ...mapped, usage } : mapped;
}

function mapAnswer(raw: GoogleAnswerPayload): DecisionAnswer {
  switch (raw.type) {
    case "noul":
      return {
        type: "noul",
        noul: raw.noul as number,
        confidence: raw.confidence as number,
      };
    case "choice":
      return {
        type: "choice",
        choice: raw.choice as string,
        confidence: raw.confidence as number,
        probabilities: raw.probabilities ?? {},
      };
    case "score":
      return {
        type: "score",
        score: raw.score as number,
        confidence: raw.confidence as number,
        probabilities: raw.probabilities ?? {},
        ...(raw.legend !== undefined ? { legend: raw.legend } : {}),
      };
    default:
      // Unknown answer types are surfaced to the core validator, which
      // rejects them against the request question type.
      return raw as unknown as DecisionAnswer;
  }
}

function mapUsage(usage: GoogleUsagePayload | undefined): DecisionUsage | undefined {
  if (!usage) return undefined;
  return {
    input_tokens: usage.total_input_tokens ?? 0,
    // The Decisions API never generates output tokens.
    output_tokens: usage.total_output_tokens ?? 0,
    ...(usage.input_tokens_by_modality !== undefined
      ? { input_tokens_by_modality: usage.input_tokens_by_modality }
      : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

/**
 * Google provider for Gemini Decision 1.
 *
 * Model precedence: `request.model` > `config.model` > `gemini-decision-1`.
 * Capabilities: noul, choice, score, multimodal.
 */
export function createGoogleProvider(config: GoogleProviderConfig = {}): ChoiceProvider {
  const id = config.id ?? DEFAULT_PROVIDER_ID;
  const apiKey = config.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  const defaultModel = config.model ?? GOOGLE_DECISION_MODEL_ID;
  const apiBaseUrl = (config.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(/\/+$/, "");
  const apiVersion = (config.apiVersion ?? DEFAULT_API_VERSION).replace(/^\/+|\/+$/g, "");
  const mapState = config.mapState ?? stateToGoogleInput;

  const manifest: ProviderManifest = {
    id,
    apiVersion: "yueli-dex-plugin/v1",
    kind: "provider",
    version: "0.1.0",
    capabilities: ["choice", "noul", "score", "multimodal"],
  };

  async function health(_ctx: ProviderHealthContext): Promise<ProviderHealth> {
    if (!apiKey) return { available: false };
    return { available: true };
  }

  async function execute(
    request: ChoiceRequest,
    context: ProviderCallContext,
  ): Promise<ChoiceResponse> {
    if (!apiKey) {
      const err: Error & { status?: number } = new Error(
        "Gemini API key not configured (GEMINI_API_KEY or GOOGLE_API_KEY)",
      );
      err.status = 401;
      throw err;
    }

    const model = request.model?.trim() || defaultModel;
    // Mapping/validation errors are deterministic client errors; surface them
    // as HTTP 400 so routing treats them as non-retryable.
    const body = buildGoogleDecisionRequest(request, model, mapState);

    const url = `${apiBaseUrl}/${apiVersion}/decisions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
        "X-Dex-Decision-Id": context.decisionId,
        "X-Dex-Request-Hash": context.requestHash,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(context.deadlineMs),
    });

    if (!res.ok) {
      let detail = "";
      let errorCode = "";
      try {
        const text = await res.text();
        detail = text.slice(0, 400);
        try {
          const parsed = JSON.parse(text) as { error?: { code?: unknown } };
          if (typeof parsed.error?.code === "string") errorCode = parsed.error.code;
        } catch {
          /* non-JSON error body */
        }
      } catch {
        /* ignore body read failures */
      }

      const parts = [`Gemini Decisions HTTP ${res.status}`];
      if (errorCode) parts.push(`(${errorCode})`);
      if (detail) parts.push(`: ${detail}`);
      const err: Error & { status?: number } = new Error(parts.join(""));
      err.status = res.status;
      throw err;
    }

    const payload = (await res.json()) as GoogleDecisionResponse;
    return toDecisionResponse(payload, model);
  }

  return { manifest, health, execute };
}

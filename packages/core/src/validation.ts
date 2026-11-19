import type {
  ChoiceAnswer,
  ChoiceQuestion,
  ChoiceRequest,
  ChoiceResponse,
  DecisionAnswer,
  DecisionQuestion,
  DecisionUsage,
  JsonValue,
  NoulCriteria,
  NoulQuestion,
  ScoreQuestion,
} from "@haxitag/yueli-dex-plugin-sdk";
import { DexError } from "./errors.js";
import { MAX_CANONICALIZE_DEPTH } from "./utils.js";

const MAX_OPTIONS = 255;
const MIN_SCORE_LEVELS = 2;
const MAX_SCORE_LEVELS = 255;
const PROBABILITY_TOLERANCE = 1e-6;

/* ------------------------------------------------------------------ */
/* JSON scalar helpers                                                 */
/* ------------------------------------------------------------------ */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* ------------------------------------------------------------------ */
/* Request validation                                                  */
/* ------------------------------------------------------------------ */

export function validateChoiceRequest(
  request: unknown,
  decisionId: string,
): ChoiceRequest {
  if (!isPlainObject(request)) {
    throw new DexError("INVALID_CHOICE_REQUEST", "Choice request must be an object", {
      decisionId,
      recoveryHint: "Pass an object with state and questions fields.",
    });
  }

  const { state, model, questions } = request as Record<string, unknown>;

  // state is required and must be a JSON value (string/number/boolean/array/object/null)
  if (state === undefined) {
    throw new DexError("INVALID_CHOICE_REQUEST", "Choice request must include state", {
      decisionId,
      recoveryHint: "Provide the factual state for the decision.",
    });
  }
  if (!isJsonValue(state)) {
    throw new DexError(
      "INVALID_CHOICE_REQUEST",
      "Choice request state must be a JSON value",
      { decisionId },
    );
  }

  if (model !== undefined && typeof model !== "string") {
    throw new DexError("INVALID_CHOICE_REQUEST", "model must be a string", {
      decisionId,
    });
  }

  if (!isPlainObject(questions) || Object.keys(questions).length === 0) {
    throw new DexError(
      "INVALID_CHOICE_REQUEST",
      "Choice request must include at least one question",
      {
        decisionId,
        recoveryHint: "Add a question of type 'noul', 'choice', or 'score'.",
      },
    );
  }

  const validatedQuestions: Record<string, DecisionQuestion> = {};
  for (const [qid, rawQuestion] of Object.entries(questions)) {
    validatedQuestions[qid] = validateQuestion(qid, rawQuestion, decisionId);
  }

  return { state, model, questions: validatedQuestions };
}

function validateQuestion(
  questionId: string,
  raw: unknown,
  decisionId: string,
): DecisionQuestion {
  if (!isPlainObject(raw)) {
    throw new DexError(
      "INVALID_CHOICE_REQUEST",
      `Question "${questionId}" must be an object`,
      { decisionId },
    );
  }

  switch ((raw as Record<string, unknown>).type) {
    case "choice":
      return validateChoiceQuestion(questionId, raw, decisionId);
    case "noul":
      return validateNoulQuestion(questionId, raw, decisionId);
    case "score":
      return validateScoreQuestion(questionId, raw, decisionId);
    default:
      throw new DexError(
        "INVALID_CHOICE_REQUEST",
        `Question "${questionId}" must have type "noul", "choice", or "score"`,
        {
          decisionId,
          recoveryHint:
            "Supported question types: noul (yes/no), choice (pick one), score (ordered rubric).",
        },
      );
  }
}

function validateInstructions(
  questionId: string,
  raw: unknown,
  decisionId: string,
): JsonValue {
  if (raw === undefined) {
    throw new DexError(
      "INVALID_CHOICE_REQUEST",
      `Question "${questionId}" must include instructions`,
      { decisionId },
    );
  }
  if (!isJsonValue(raw)) {
    throw new DexError(
      "INVALID_CHOICE_REQUEST",
      `Question "${questionId}" instructions must be a JSON value`,
      { decisionId },
    );
  }
  return raw;
}

function validateChoiceQuestion(
  questionId: string,
  raw: Record<string, unknown>,
  decisionId: string,
): ChoiceQuestion {
  const instructions = validateInstructions(questionId, raw.instructions, decisionId);
  const criteria = raw.criteria;

  if (!isPlainObject(criteria)) {
    throw new DexError(
      "INVALID_CHOICE_REQUEST",
      `Question "${questionId}" must include a criteria object`,
      { decisionId },
    );
  }

  const keys = Object.keys(criteria);
  if (keys.length === 0) {
    throw new DexError(
      "INVALID_CHOICE_REQUEST",
      `Question "${questionId}" must have at least one criterion`,
      { decisionId },
    );
  }
  if (keys.length > MAX_OPTIONS) {
    throw new DexError(
      "INVALID_CHOICE_REQUEST",
      `Question "${questionId}" has ${keys.length} options, exceeding the maximum of ${MAX_OPTIONS}`,
      { decisionId },
    );
  }

  // Duplicate check: object keys are already unique, but ensure no empty keys
  for (const key of keys) {
    if (key === "") {
      throw new DexError(
        "INVALID_CHOICE_REQUEST",
        `Question "${questionId}" contains an empty criterion key`,
        { decisionId },
      );
    }
    if (!isJsonValue((criteria as Record<string, unknown>)[key])) {
      throw new DexError(
        "INVALID_CHOICE_REQUEST",
        `Criterion "${key}" in question "${questionId}" must be a JSON value`,
        { decisionId },
      );
    }
  }

  return {
    type: "choice",
    instructions,
    criteria: criteria as Record<string, JsonValue>,
  };
}

function validateNoulQuestion(
  questionId: string,
  raw: Record<string, unknown>,
  decisionId: string,
): NoulQuestion {
  const instructions = validateInstructions(questionId, raw.instructions, decisionId);

  if (raw.criteria === undefined) {
    return { type: "noul", instructions };
  }
  if (!isPlainObject(raw.criteria)) {
    throw new DexError(
      "INVALID_CHOICE_REQUEST",
      `Question "${questionId}" noul criteria must be an object`,
      { decisionId },
    );
  }

  const criteria = raw.criteria as Record<string, unknown>;
  const validated: { true_description?: string; false_description?: string } = {};
  for (const [key, value] of Object.entries(criteria)) {
    if (key !== "true_description" && key !== "false_description") {
      throw new DexError(
        "INVALID_CHOICE_REQUEST",
        `Question "${questionId}" noul criteria only supports "true_description" and "false_description"`,
        { decisionId },
      );
    }
    if (typeof value !== "string") {
      throw new DexError(
        "INVALID_CHOICE_REQUEST",
        `Question "${questionId}" noul criteria "${key}" must be a string`,
        { decisionId },
      );
    }
    validated[key] = value;
  }

  return { type: "noul", instructions, criteria: validated as NoulCriteria };
}

function validateScoreQuestion(
  questionId: string,
  raw: Record<string, unknown>,
  decisionId: string,
): ScoreQuestion {
  const instructions = validateInstructions(questionId, raw.instructions, decisionId);

  if (!Array.isArray(raw.criteria)) {
    throw new DexError(
      "INVALID_CHOICE_REQUEST",
      `Question "${questionId}" score criteria must be an array of level descriptions`,
      { decisionId, recoveryHint: "Order levels from lowest to highest." },
    );
  }
  if (
    raw.criteria.length < MIN_SCORE_LEVELS ||
    raw.criteria.length > MAX_SCORE_LEVELS
  ) {
    throw new DexError(
      "INVALID_CHOICE_REQUEST",
      `Question "${questionId}" has ${raw.criteria.length} score levels, expected ${MIN_SCORE_LEVELS}-${MAX_SCORE_LEVELS}`,
      { decisionId },
    );
  }

  const levels: string[] = [];
  for (const level of raw.criteria) {
    if (typeof level !== "string" || level.trim() === "") {
      throw new DexError(
        "INVALID_CHOICE_REQUEST",
        `Question "${questionId}" score levels must be non-empty strings`,
        { decisionId },
      );
    }
    levels.push(level);
  }

  return { type: "score", instructions, criteria: levels };
}

/* ------------------------------------------------------------------ */
/* Response validation                                                 */
/* ------------------------------------------------------------------ */

export function validateChoiceResponse(
  request: ChoiceRequest,
  rawResponse: unknown,
  decisionId: string,
  providerId: string,
): ChoiceResponse {
  if (!isPlainObject(rawResponse)) {
    throw new DexError(
      "INVALID_CHOICE_RESPONSE",
      `Provider "${providerId}" returned a non-object response`,
      { decisionId, providerId },
    );
  }

  const { model, answers, usage } = rawResponse as Record<string, unknown>;

  if (typeof model !== "string" || model === "") {
    throw new DexError(
      "INVALID_CHOICE_RESPONSE",
      `Provider "${providerId}" response must include a non-empty model string`,
      { decisionId, providerId },
    );
  }

  if (!isPlainObject(answers)) {
    throw new DexError(
      "INVALID_CHOICE_RESPONSE",
      `Provider "${providerId}" response must include an answers object`,
      { decisionId, providerId },
    );
  }

  const requestQuestionIds = Object.keys(request.questions);
  const responseQuestionIds = Object.keys(answers);

  // The response must answer exactly the questions in the request (same set).
  const requestSet = new Set(requestQuestionIds);
  const responseSet = new Set(responseQuestionIds);
  if (requestQuestionIds.length !== responseQuestionIds.length ||
      requestSet.size !== responseSet.size ||
      [...requestSet].some((k) => !responseSet.has(k))) {
    throw new DexError(
      "INVALID_CHOICE_RESPONSE",
      `Provider "${providerId}" response answers do not match request questions`,
      {
        decisionId,
        providerId,
        recoveryHint: "The response must answer exactly the requested questions.",
      },
    );
  }

  const validatedAnswers: Record<string, DecisionAnswer> = {};
  for (const qid of requestQuestionIds) {
    validatedAnswers[qid] = validateAnswer(
      qid,
      request.questions[qid],
      (answers as Record<string, unknown>)[qid],
      decisionId,
      providerId,
    );
  }

  if (usage !== undefined) {
    if (!isPlainObject(usage) ||
        typeof (usage as Record<string, unknown>).input_tokens !== "number" ||
        typeof (usage as Record<string, unknown>).output_tokens !== "number") {
      throw new DexError(
        "INVALID_CHOICE_RESPONSE",
        `Provider "${providerId}" response usage must be { input_tokens, output_tokens } numbers`,
        { decisionId, providerId },
      );
    }
    const breakdown = (usage as Record<string, unknown>).input_tokens_by_modality;
    if (breakdown !== undefined) {
      if (!Array.isArray(breakdown) || !breakdown.every((entry) =>
        isPlainObject(entry) &&
        typeof (entry as Record<string, unknown>).modality === "string" &&
        typeof (entry as Record<string, unknown>).tokens === "number")) {
        throw new DexError(
          "INVALID_CHOICE_RESPONSE",
          `Provider "${providerId}" usage.input_tokens_by_modality must be an array of { modality, tokens }`,
          { decisionId, providerId },
        );
      }
    }
  }

  return {
    model,
    answers: validatedAnswers,
    ...(usage !== undefined ? { usage: usage as unknown as DecisionUsage } : {}),
  };
}

function validateAnswer(
  questionId: string,
  question: DecisionQuestion,
  rawAnswer: unknown,
  decisionId: string,
  providerId: string,
): DecisionAnswer {
  if (!isPlainObject(rawAnswer)) {
    throw new DexError(
      "INVALID_CHOICE_RESPONSE",
      `Provider "${providerId}" answer for "${questionId}" must be an object`,
      { decisionId, providerId },
    );
  }

  const answerType = (rawAnswer as Record<string, unknown>).type;
  if (answerType !== question.type) {
    throw new DexError(
      "INVALID_CHOICE_RESPONSE",
      `Provider "${providerId}" answer for "${questionId}" must have type "${question.type}", got "${String(answerType)}"`,
      { decisionId, providerId },
    );
  }

  switch (question.type) {
    case "choice":
      return validateChoiceAnswer(questionId, question, rawAnswer, decisionId, providerId);
    case "noul":
      return validateNoulAnswer(questionId, rawAnswer, decisionId, providerId);
    case "score":
      return validateScoreAnswer(questionId, question, rawAnswer, decisionId, providerId);
  }
}

function validateChoiceAnswer(
  questionId: string,
  question: ChoiceQuestion,
  rawAnswer: Record<string, unknown>,
  decisionId: string,
  providerId: string,
): ChoiceAnswer {
  const { choice, confidence, probabilities } = rawAnswer;

  if (typeof choice !== "string") {
    throw new DexError(
      "INVALID_CHOICE_RESPONSE",
      `Provider "${providerId}" answer for "${questionId}" choice must be a string`,
      { decisionId, providerId },
    );
  }

  const criterionKeys = Object.keys(question.criteria);
  if (!criterionKeys.includes(choice)) {
    throw new DexError(
      "INVALID_CHOICE_RESPONSE",
      `Provider "${providerId}" answer for "${questionId}" selected unknown option "${choice}"`,
      {
        decisionId,
        providerId,
        recoveryHint: "Selected option must be one of the request criteria keys.",
      },
    );
  }

  assertConfidence(questionId, confidence, decisionId, providerId);

  if (!isPlainObject(probabilities)) {
    throw new DexError(
      "INVALID_CHOICE_RESPONSE",
      `Provider "${providerId}" answer for "${questionId}" must include probabilities`,
      { decisionId, providerId },
    );
  }

  const probKeys = Object.keys(probabilities);
  const criterionSet = new Set(criterionKeys);
  const probSet = new Set(probKeys);

  if (probKeys.length !== criterionKeys.length ||
      [...criterionSet].some((k) => !probSet.has(k))) {
    throw new DexError(
      "INVALID_CHOICE_RESPONSE",
      `Provider "${providerId}" answer for "${questionId}" probability keys must match criteria exactly`,
      { decisionId, providerId },
    );
  }

  let sum = 0;
  for (const key of criterionKeys) {
    const p = probabilities[key];
    if (typeof p !== "number" || !Number.isFinite(p) || p < 0) {
      throw new DexError(
        "INVALID_CHOICE_RESPONSE",
        `Provider "${providerId}" answer for "${questionId}" probability for "${key}" must be a finite non-negative number`,
        { decisionId, providerId },
      );
    }
    sum += p;
  }

  if (Math.abs(sum - 1) > PROBABILITY_TOLERANCE) {
    throw new DexError(
      "INVALID_CHOICE_RESPONSE",
      `Provider "${providerId}" answer for "${questionId}" probabilities sum to ${sum}, expected 1`,
      { decisionId, providerId },
    );
  }

  return {
    type: "choice",
    choice,
    confidence: confidence as number,
    probabilities: probabilities as Record<string, number>,
  };
}

function validateNoulAnswer(
  questionId: string,
  rawAnswer: Record<string, unknown>,
  decisionId: string,
  providerId: string,
): DecisionAnswer {
  const { noul, confidence } = rawAnswer;

  if (typeof noul !== "number" || !Number.isFinite(noul) || noul < 0 || noul > 1) {
    throw new DexError(
      "INVALID_CHOICE_RESPONSE",
      `Provider "${providerId}" answer for "${questionId}" noul must be in [0, 1]`,
      { decisionId, providerId },
    );
  }

  assertConfidence(questionId, confidence, decisionId, providerId);

  return { type: "noul", noul, confidence: confidence as number };
}

function validateScoreAnswer(
  questionId: string,
  question: ScoreQuestion,
  rawAnswer: Record<string, unknown>,
  decisionId: string,
  providerId: string,
): DecisionAnswer {
  const { score, confidence, probabilities, legend } = rawAnswer;
  const levels = question.criteria.length;
  const maxScore = levels - 1;

  if (typeof score !== "number" || !Number.isFinite(score) ||
      score < 0 || score > maxScore + PROBABILITY_TOLERANCE) {
    throw new DexError(
      "INVALID_CHOICE_RESPONSE",
      `Provider "${providerId}" answer for "${questionId}" score must be within [0, ${maxScore}]`,
      { decisionId, providerId },
    );
  }

  assertConfidence(questionId, confidence, decisionId, providerId);

  if (!isPlainObject(probabilities)) {
    throw new DexError(
      "INVALID_CHOICE_RESPONSE",
      `Provider "${providerId}" answer for "${questionId}" must include probabilities`,
      { decisionId, providerId },
    );
  }

  const expectedKeys = Array.from({ length: levels }, (_, i) => String(i));
  const probKeys = Object.keys(probabilities);
  const expectedSet = new Set(expectedKeys);
  const probSet = new Set(probKeys);

  if (probKeys.length !== expectedKeys.length ||
      [...expectedSet].some((k) => !probSet.has(k))) {
    throw new DexError(
      "INVALID_CHOICE_RESPONSE",
      `Provider "${providerId}" answer for "${questionId}" probability keys must be level indices "0".."${maxScore}"`,
      { decisionId, providerId },
    );
  }

  let sum = 0;
  for (const key of expectedKeys) {
    const p = probabilities[key];
    if (typeof p !== "number" || !Number.isFinite(p) || p < 0) {
      throw new DexError(
        "INVALID_CHOICE_RESPONSE",
        `Provider "${providerId}" answer for "${questionId}" probability for level "${key}" must be a finite non-negative number`,
        { decisionId, providerId },
      );
    }
    sum += p;
  }

  if (Math.abs(sum - 1) > PROBABILITY_TOLERANCE) {
    throw new DexError(
      "INVALID_CHOICE_RESPONSE",
      `Provider "${providerId}" answer for "${questionId}" probabilities sum to ${sum}, expected 1`,
      { decisionId, providerId },
    );
  }

  if (legend !== undefined) {
    if (!isPlainObject(legend)) {
      throw new DexError(
        "INVALID_CHOICE_RESPONSE",
        `Provider "${providerId}" answer for "${questionId}" legend must be an object`,
        { decisionId, providerId },
      );
    }
    const legendKeys = Object.keys(legend);
    if (legendKeys.length !== expectedKeys.length ||
        legendKeys.some((k) => !expectedSet.has(k)) ||
        legendKeys.some((k) => typeof legend[k] !== "string")) {
      throw new DexError(
        "INVALID_CHOICE_RESPONSE",
        `Provider "${providerId}" answer for "${questionId}" legend must map every level index to a description`,
        { decisionId, providerId },
      );
    }
  }

  return {
    type: "score",
    score,
    confidence: confidence as number,
    probabilities: probabilities as Record<string, number>,
    ...(legend !== undefined ? { legend: legend as Record<string, string> } : {}),
  };
}

function assertConfidence(
  questionId: string,
  confidence: unknown,
  decisionId: string,
  providerId: string,
): void {
  if (typeof confidence !== "number" || !Number.isFinite(confidence) ||
      confidence < 0 || confidence > 1) {
    throw new DexError(
      "INVALID_CHOICE_RESPONSE",
      `Provider "${providerId}" answer for "${questionId}" confidence must be in [0, 1]`,
      { decisionId, providerId },
    );
  }
}

/* ------------------------------------------------------------------ */
/* JSON value type guard                                               */
/* ------------------------------------------------------------------ */

function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  // P0: bound recursion so adversarially-deep input surfaces as a validation
  // error instead of an uncontrolled RangeError (stack overflow).
  if (depth > MAX_CANONICALIZE_DEPTH) return false;
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((v) => isJsonValue(v, depth + 1));
  }
  if (isPlainObject(value)) {
    return Object.values(value).every((v) => isJsonValue(v, depth + 1));
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Rule-engine short-circuit response validator                        */
/* ------------------------------------------------------------------ */

/**
 * Build a single-question answer with probability 1 / confidence 1 for a
 * rule-pinned choice. Used by full short-circuit responses and by post-route
 * merges of partial pins.
 */
export function buildPinnedAnswer(
  request: ChoiceRequest,
  questionId: string,
  selectedChoice: string,
): ChoiceAnswer {
  const question = request.questions[questionId];
  if (!question) {
    throw new Error(`buildPinnedAnswer: unknown question "${questionId}"`);
  }
  if (question.type !== "choice") {
    throw new Error(
      `buildPinnedAnswer: question "${questionId}" is type "${question.type}", not "choice"`,
    );
  }
  const criteria = question.criteria;
  if (!Object.prototype.hasOwnProperty.call(criteria, selectedChoice)) {
    throw new Error(
      `buildPinnedAnswer: choice "${selectedChoice}" not in criteria of "${questionId}"`,
    );
  }
  const probabilities: Record<string, number> = {};
  for (const key of Object.keys(criteria)) {
    probabilities[key] = key === selectedChoice ? 1 : 0;
  }
  return {
    type: "choice",
    choice: selectedChoice,
    confidence: 1,
    probabilities,
  };
}

/**
 * Build a deterministic ChoiceResponse that covers EVERY question in the
 * request with rule-pinned answers. Callers must supply a choice for each
 * questionId — partial coverage must not invent answers for undecided
 * questions (that was a P0 false-certainty bug).
 */
export function buildShortCircuitResponse(
  request: ChoiceRequest,
  decisions: Readonly<Record<string, string>>,
): ChoiceResponse {
  const questionIds = Object.keys(request.questions);
  const answers: Record<string, DecisionAnswer> = {};
  for (const qid of questionIds) {
    const selected = decisions[qid];
    if (selected === undefined) {
      throw new Error(
        `buildShortCircuitResponse: missing pinned choice for question "${qid}" (partial shortCircuit must not fabricate answers)`,
      );
    }
    answers[qid] = buildPinnedAnswer(request, qid, selected);
  }
  return {
    model: "yueli-dex/rules@1",
    answers,
  };
}

/**
 * Overlay rule-pinned answers onto a provider response. Unpinned questions
 * keep the provider's answer; pinned ones are forced to confidence 1.
 */
export function applyPinnedAnswers(
  request: ChoiceRequest,
  response: ChoiceResponse,
  pinned: Readonly<Record<string, string>>,
): ChoiceResponse {
  if (Object.keys(pinned).length === 0) return response;
  const answers: Record<string, DecisionAnswer> = { ...response.answers };
  for (const [qid, choice] of Object.entries(pinned)) {
    const question = request.questions[qid];
    // Local rules can only pin the choice primitive; ignore anything else.
    if (!question || question.type !== "choice") continue;
    answers[qid] = buildPinnedAnswer(request, qid, choice);
  }
  return { ...response, answers };
}

/**
 * @deprecated Prefer `buildShortCircuitResponse(request, { [questionId]: choice })`
 * when all questions are covered. Kept for call-site migration clarity.
 */
export function buildShortCircuitResponseForQuestion(
  request: ChoiceRequest,
  questionId: string,
  selectedChoice: string,
): ChoiceResponse {
  return buildShortCircuitResponse(request, { [questionId]: selectedChoice });
}

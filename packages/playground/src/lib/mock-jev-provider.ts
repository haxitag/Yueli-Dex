/**
 * Built-in deterministic mock JEV provider for the playground.
 *
 * Goal: let the L2 tier be exercised end-to-end without any external service,
 * API key, or network access. The synthesized response is clearly labelled with
 * model = "yueli-dex/mock-jev@1" so downstream observers can tell at a glance
 * that the answer was not produced by a real JEV model.
 *
 * Synthesis algorithm (deterministic for a given input):
 *   1. Tokenize each criteria label + the criterion text.
 *   2. For every option in the criteria map, score it by how many of its
 *      tokens appear in the JSON-serialized request.state (case-insensitive,
 *      word-boundary regex; baseline +1 so every option gets a non-zero share).
 *   3. Normalize scores → probabilities (sum = 1).
 *   4. Pick the highest-scoring option as `choice`. If the top score < 0.6,
 *      boost its confidence to 0.6 so the demo still shows a decisive pick.
 *
 * This is intentionally trivial: it exists to validate wiring, routing,
 * receipt emission, and UI rendering — not to compete with a real JEV model.
 */

import type {
  ChoiceAnswer,
  ChoiceProvider,
  ChoiceRequest,
  ChoiceResponse,
  ProviderCallContext,
  ProviderHealth,
  ProviderHealthContext,
  ProviderManifest,
} from "@haxitag/yueli-dex-plugin-sdk";

export interface MockJevConfig {
  readonly id?: string;
  readonly model?: string;
}

const DEFAULT_ID = "mock-jev";
const DEFAULT_MODEL = "yueli-dex/mock-jev@1";

/** Escape regex metacharacters so user-supplied tokens can't crash the matcher. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Pull useful tokens out of a criteria option label + its criterion definition. */
function tokensForOption(choice: string, criterion: unknown): string[] {
  const out: string[] = [];
  // Split camelCase / kebab-case / snake_case labels into words.
  for (const part of choice.split(/[_\-\s]+/)) {
    if (part.length >= 3) out.push(part);
  }
  if (typeof criterion === "string") {
    for (const word of criterion.toLowerCase().split(/\s+/)) {
      // Strip trailing punctuation so "refunds," → "refunds"
      const cleaned = word.replace(/[^a-z0-9]+/gi, "");
      if (cleaned.length >= 4) out.push(cleaned);
      // Light stemming: refunds→refund, payments→payment so state "refund"
      // matches criteria text "refunds".
      if (cleaned.length >= 5 && cleaned.endsWith("s")) {
        out.push(cleaned.slice(0, -1));
      }
    }
  }
  return Array.from(new Set(out.map((t) => t.toLowerCase())));
}

/** Score how many option tokens appear in the state string (substring + word). */
function scoreOption(stateStr: string, tokens: string[]): number {
  let score = 1; // baseline so every option has a non-zero share
  for (const tok of tokens) {
    // Prefer word-boundary hits, but also accept substring for short stems
    // (e.g. "refund" inside "refunded") so the canonical support-triage
    // example ("need a refund") actually picks billing over a flat tie.
    const re = new RegExp(`\\b${escapeRe(tok)}`, "gi");
    const hits = stateStr.match(re);
    if (hits) score += hits.length;
  }
  return score;
}

export function createMockJevProvider(config: MockJevConfig = {}): ChoiceProvider {
  const id = config.id ?? DEFAULT_ID;
  const model = config.model ?? DEFAULT_MODEL;

  const manifest: ProviderManifest = {
    id,
    apiVersion: "yueli-dex-plugin/v1",
    kind: "provider",
    version: "0.1.0",
    capabilities: ["choice"],
  };

  async function health(_ctx: ProviderHealthContext): Promise<ProviderHealth> {
    return { available: true, observedP95LatencyMs: 5 };
  }

  async function execute(
    request: ChoiceRequest,
    _context: ProviderCallContext,
  ): Promise<ChoiceResponse> {
    const stateStr = (() => {
      // Prefer human text fields over raw JSON key names so that keys like
      // "account" / "accountPlan" do not inflate the "account" option score.
      const state = request.state;
      if (typeof state === "string") return state.toLowerCase();
      if (state && typeof state === "object" && !Array.isArray(state)) {
        const parts: string[] = [];
        for (const v of Object.values(state as Record<string, unknown>)) {
          if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
            parts.push(String(v));
          } else if (v != null) {
            parts.push(JSON.stringify(v));
          }
        }
        return parts.join(" ").toLowerCase();
      }
      return JSON.stringify(state ?? null).toLowerCase();
    })();

    const answers: Record<string, ChoiceAnswer> = {};
    let totalInput = 0;
    let totalOutput = 0;

    for (const [questionId, question] of Object.entries(request.questions)) {
      const choices = Object.keys(question.criteria);
      if (choices.length === 0) continue;

      const scores: Record<string, number> = {};
      let totalScore = 0;
      for (const choice of choices) {
        const score = scoreOption(stateStr, tokensForOption(choice, question.criteria[choice]));
        scores[choice] = score;
        totalScore += score;
      }

      // Normalize → probabilities (sum = 1, all > 0).
      const probabilities: Record<string, number> = {};
      for (const choice of choices) {
        probabilities[choice] = scores[choice] / totalScore;
      }

      // Top option.
      let topChoice = choices[0];
      let topProb = probabilities[topChoice];
      for (const choice of choices) {
        if (probabilities[choice] > topProb) {
          topChoice = choice;
          topProb = probabilities[choice];
        }
      }

      answers[questionId] = {
        type: "choice",
        choice: topChoice,
        // Honest confidence = top probability. Do not floor at 0.6 — a flat
        // distribution (all options tied) must not claim decisive confidence.
        confidence: topProb,
        probabilities,
      };

      totalInput += Math.max(1, Math.ceil(stateStr.length / 4));
      totalOutput += 8;
    }

    return {
      model,
      answers,
      usage: { input_tokens: totalInput, output_tokens: totalOutput },
    };
  }

  return { manifest, health, execute };
}
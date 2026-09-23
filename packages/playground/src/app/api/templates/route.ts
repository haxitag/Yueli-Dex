import { NextResponse } from "next/server";
import { createRuleEngine, isDexError } from "@haxitag/yueli-dex";
import type { ChoiceRequest, RuleSet } from "@haxitag/yueli-dex";
import {
  CATALOG,
  TEMPLATES,
  buildCallExample,
  getLocalRuleSets,
} from "@haxitag/yueli-dex-templates-core";

/**
 * GET /api/templates
 *
 * Serves the four-dimension catalog (theme / scenario / use case / utility),
 * the full template definitions, per-template local rule sets, and a runnable
 * TypeScript call example — everything the Template Tester needs to generate
 * and actually verify a scenario use case end to end.
 */
export async function GET() {
  const entries = TEMPLATES.map((t) => {
    const catalogEntry = CATALOG.find((c) => c.id === t.id);
    const localRules = getLocalRuleSets(t.id);
    return {
      id: t.id,
      version: t.version,
      theme: t.meta.theme,
      scenario: t.meta.scenario,
      useCase: t.meta.useCase,
      utility: t.meta.utility,
      references: t.meta.references,
      exampleInput: t.meta.exampleInput,
      template: t,
      localRules,
      hasLocalRules: localRules.length > 0,
      example: buildCallExample(t.id),
      _catalog: catalogEntry,
    };
  });

  return NextResponse.json({
    pack: { id: "yueli-dex/templates-core", version: "0.1.0", count: entries.length },
    templates: entries,
  });
}

/**
 * POST /api/templates  { action: "rules", ruleSets, request }
 *
 * Evaluates local rule sets against a compiled ChoiceRequest — pre-routing,
 * exactly as `dex.choice()` does. A `shortCircuit` hit means the decision is
 * resolved locally and NO remote Jev-class model is called.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json();
  const { ruleSets, choiceRequest } = body as {
    ruleSets?: Array<{ id: string; version: string; scope?: string; document: unknown }>;
    choiceRequest?: ChoiceRequest;
  };

  if (!ruleSets || !Array.isArray(ruleSets) || ruleSets.length === 0) {
    return NextResponse.json(
      { error: "ruleSets array required for local rule evaluation" },
      { status: 400 },
    );
  }
  if (!choiceRequest || !choiceRequest.questions) {
    return NextResponse.json(
      { error: "choiceRequest (compiled ChoiceRequest) required — run Compile first" },
      { status: 400 },
    );
  }

  try {
    const engine = createRuleEngine(
      ruleSets.map((rs) => ({
        id: rs.id,
        version: rs.version ?? "0.0.0",
        scope: (rs.scope ?? "template") as RuleSet["scope"],
        document: rs.document as never,
      })),
    );

    const result = engine.evaluatePreRouting(
      {
        input: choiceRequest.state,
        compiled: choiceRequest,
        route: { eligibleProviderIds: [] },
      },
      "playground-rules",
    );

    return NextResponse.json({
      matched: result.matches.map((m) => ({
        ruleId: m.ruleId,
        ruleSetId: m.ruleSetId,
        action: m.action,
      })),
      pinnedAnswers: result.pinnedAnswers,
      shortCircuit: result.shortCircuit
        ? {
            questionId: result.shortCircuit.match.action.questionId,
            choice: result.shortCircuit.match.action.choice,
            message: result.shortCircuit.match.action.message,
            response: result.shortCircuit.response,
            complete: true,
          }
        : Object.keys(result.pinnedAnswers).length > 0
          ? {
              // Partial pin: rules decided some questions but not all.
              // Do NOT claim full local resolution / zero remote.
              questionId: Object.keys(result.pinnedAnswers)[0],
              choice: Object.values(result.pinnedAnswers)[0],
              message: `Partial pin: ${Object.entries(result.pinnedAnswers)
                .map(([q, c]) => `${q}=${c}`)
                .join(", ")} — remaining questions need a provider`,
              response: null,
              complete: false,
              pinnedAnswers: result.pinnedAnswers,
            }
          : null,
      forcedRoute: result.forcedRoute ?? null,
      constraints: result.constraints,
      // Only true when every question was pinned (honest zero-remote claim).
      resolvedLocally: result.shortCircuit !== undefined,
    });
  } catch (err) {
    if (isDexError(err)) {
      return NextResponse.json({
        rejected: {
          code: err.code,
          message: err.message,
          recoveryHint: err.recoveryHint,
        },
        resolvedLocally: true, // a local reject still never calls a remote model
      });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

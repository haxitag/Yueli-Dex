import { NextResponse } from "next/server";
import { createRuleEngine } from "@haxitag/yueli-dex";
import type { RuleSet } from "@haxitag/yueli-dex";
import { isDexError } from "@haxitag/yueli-dex";
import type { ChoiceRequest } from "@haxitag/yueli-dex-plugin-sdk";

export async function POST(request: Request) {
  const body = await request.json();
  const { ruleSet, input, compiledRequest, phase } = body as {
    ruleSet: { id: string; version: string; scope: RuleSet["scope"]; document: unknown };
    input: unknown;
    compiledRequest?: ChoiceRequest;
    phase?: "pre" | "post";
  };

  try {
    const engine = createRuleEngine([{
      id: ruleSet.id,
      version: ruleSet.version,
      scope: ruleSet.scope,
      document: ruleSet.document as never,
    }]);

    if (phase === "post") {
      if (!compiledRequest) {
        return NextResponse.json({ error: "compiledRequest required for post phase" }, { status: 400 });
      }
      const matches = engine.evaluatePostResponse({
        input: input as never,
        compiled: compiledRequest,
        route: { selectedProviderId: "probe", eligibleProviderIds: ["probe"] },
        response: undefined,
      }, "playground");
      return NextResponse.json({ matches });
    }

    const result = engine.evaluatePreRouting({
      input: input as never,
      compiled: (compiledRequest ?? {
        state: input,
        questions: {},
      }) as ChoiceRequest,
      route: { eligibleProviderIds: [] },
    }, "playground");

    return NextResponse.json({
      matches: result.matches,
      forcedRoute: result.forcedRoute,
      constraints: result.constraints,
      shortCircuit: result.shortCircuit ? {
        response: result.shortCircuit.response,
        ruleId: result.shortCircuit.match.ruleId,
      } : undefined,
    });
  } catch (err) {
    if (isDexError(err)) {
      return NextResponse.json({
        error: { code: err.code, message: err.message },
      }, { status: 200 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 200 });
  }
}

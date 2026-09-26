import { NextResponse } from "next/server";
import { createTemplateRegistry } from "@haxitag/yueli-dex";
import type { TemplatePack } from "@haxitag/yueli-dex";
import { readJsonBody } from "@/lib/http";
import type { ChoiceRequest, ChoiceResponse } from "@haxitag/yueli-dex-plugin-sdk";

export async function POST(request: Request): Promise<NextResponse> {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = (parsed.body ?? {}) as {
    template?: unknown;
    input?: unknown;
    action?: "prepare" | "intent";
    request?: ChoiceRequest;
    response?: ChoiceResponse;
  };
  const { template, input, action, request: intentRequest, response: intentResponse } = body;

  try {
    const pack: TemplatePack = {
      id: "playground-pack",
      version: "0.0.0",
      templates: [template] as never,
    };
    const registry = createTemplateRegistry([pack]);

    // Extract the template id from the definition for lookup
    const templateId = (template as { id?: string })?.id ?? "playground-template";
    const templateVersion = (template as { version?: string })?.version;
    const lookupKey = templateVersion ? `${templateId}@${templateVersion}` : templateId;

    if (action === "intent") {
      if (!intentRequest || !intentResponse) {
        return NextResponse.json({ error: "request and response required for intent mapping" }, { status: 400 });
      }
      const intents = registry.toActionIntent({
        template: lookupKey,
        request: intentRequest,
        response: intentResponse,
      });
      return NextResponse.json({ intents });
    }

    const prepared = await registry.prepare({
      template: lookupKey,
      input: input as never,
    });
    return NextResponse.json({ request: prepared });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 200 });
  }
}

import { NextResponse } from "next/server";
import { createTemplateRegistry } from "@haxitag/yueli-dex";
import type { TemplatePack, ChoiceRequest, ChoiceResponse } from "@haxitag/yueli-dex-plugin-sdk";

export async function POST(request: Request) {
  const body = await request.json();
  const { template, input, action } = body as {
    template: unknown;
    input: unknown;
    action?: "prepare" | "intent";
    request?: ChoiceRequest;
    response?: ChoiceResponse;
  };

  try {
    const pack: TemplatePack = {
      id: "playground-pack",
      version: "0.0.0",
      templates: [template],
    };
    const registry = createTemplateRegistry([pack]);

    // Extract the template id from the definition for lookup
    const templateId = (template as { id?: string })?.id ?? "playground-template";
    const templateVersion = (template as { version?: string })?.version;
    const lookupKey = templateVersion ? `${templateId}@${templateVersion}` : templateId;

    if (action === "intent") {
      if (!body.request || !body.response) {
        return NextResponse.json({ error: "request and response required for intent mapping" }, { status: 400 });
      }
      const intents = registry.toActionIntent({
        template: lookupKey,
        request: body.request,
        response: body.response,
      });
      return NextResponse.json({ intents });
    }

    const prepared = await registry.prepare({
      template: lookupKey,
      input,
    });
    return NextResponse.json({ request: prepared });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 200 });
  }
}

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http";

/**
 * POST /api/generate-template  —  第三层（L3）：LLM 生成场景效用模板
 *
 * Input:  { scenario, useCase, utility, theme?, exampleInput? }
 * Output: { template, source: "llm" | "scaffold", model?, note? }
 *
 * Generation strategy (first available wins):
 *   1. OpenAI-compatible LLM  — OPENAI_API_KEY (+ optional OPENAI_BASE_URL / OPENAI_MODEL)
 *   2. Cloudflare Workers AI  — CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (text-gen model)
 *   3. Deterministic scaffold — no key needed; builds a valid yueli-dex-template/v1
 *      document directly from the caller's 场景 / 用例 / 效用 description.
 *
 * Every generated document is shape-validated before returning; on failure the
 * scaffold generator is used so the playground always yields a runnable template.
 */

interface GenerateBody {
  scenario?: string;
  useCase?: string;
  utility?: string;
  theme?: string;
  exampleInput?: Record<string, unknown>;
}

const THEMES = [
  "customer-operations",
  "communication",
  "agent-infrastructure",
  "developer-tooling",
  "security",
  "automation",
] as const;

function slugify(text: string, fallback: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || fallback;
}

/** Minimal structural validation for a yueli-dex-template/v1 document. */
function validateTemplate(t: unknown): t is Record<string, unknown> {
  if (typeof t !== "object" || t === null) return false;
  const doc = t as Record<string, unknown>;
  if (doc.apiVersion !== "yueli-dex-template/v1") return false;
  if (typeof doc.id !== "string" || !doc.id) return false;
  if (!Array.isArray(doc.choices) || doc.choices.length === 0) return false;
  for (const c of doc.choices) {
    const choice = c as Record<string, unknown>;
    if (typeof choice.id !== "string") return false;
    if (typeof choice.instructions !== "string") return false;
    if (typeof choice.criteria !== "object" || choice.criteria === null) return false;
    if (Object.keys(choice.criteria as object).length === 0) return false;
  }
  return true;
}

function buildPrompt(body: Required<Pick<GenerateBody, "scenario" | "useCase" | "utility">> & GenerateBody): string {
  return [
    "你是 Yueli DEX 决策模板架构师。根据用户给出的企业应用场景信息，生成一个 yueli-dex-template/v1 决策模板 JSON 文档。",
    "围绕 agent 自动化与 AI 自主决策：模板把一次模糊的业务情境变成一个可审计、带置信度、可映射为动作的决策。",
    "",
    "硬性要求：",
    "- apiVersion 固定为 \"yueli-dex-template/v1\"",
    "- id 为小写中划线 slug；version 为 \"1.0.0\"",
    "- meta 包含 theme(取值: " + THEMES.join(" | ") + ")、scenario、useCase、utility、references(数组)、exampleInput(对象)",
    "- state.from 将输入字段映射到编译态，路径形如 \"$.field\"",
    "- choices 数组：每项含 id、instructions、criteria(选项→判据说明)",
    "- 每个 choice 的 criteria 必须包含 \"needs_review\" 选项作为兜底（低置信走人工）",
    "- constraints: { requireFallbackOption: \"needs_review\", maxOptions: ≤24 }",
    "- actions: 每个 choice 的每个选项 → { kind: 动作类型, ...参数 }，动作 kind 用企业可执行语义（如 queue.assign / gate.verdict / tool.invoke / review.request）",
    "- 只输出 JSON，不要 markdown 代码块，不要任何解释",
    "",
    "场景信息：",
    `- 场景 (scenario): ${body.scenario}`,
    `- 用例 (useCase): ${body.useCase}`,
    `- 效用 (utility): ${body.utility}`,
    body.theme ? `- 主题 (theme): ${body.theme}` : "",
    body.exampleInput ? `- 示例输入: ${JSON.stringify(body.exampleInput)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function generateByOpenAI(prompt: string): Promise<{ template: unknown; model: string } | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? "";
  const jsonText = content.replace(/```json?|```/g, "").trim();
  const start = jsonText.indexOf("{");
  const end = jsonText.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return { template: JSON.parse(jsonText.slice(start, end + 1)), model };
}

async function generateByCloudflare(prompt: string): Promise<{ template: unknown; model: string } | null> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) return null;
  const model = "@cf/meta/llama-3.1-8b-instruct";
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiToken}` },
    body: JSON.stringify({
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2000,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { result?: { response?: string } };
  const content = data.result?.response ?? "";
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return { template: JSON.parse(content.slice(start, end + 1)), model };
}

/** Deterministic scaffold: no LLM required, always produces a runnable template. */
function generateScaffold(body: GenerateBody): Record<string, unknown> {
  const scenario = (body.scenario ?? "custom-scenario").trim();
  const useCase = (body.useCase ?? "Decide the next action for this scenario").trim();
  const utility = (body.utility ?? "Replaces ad-hoc prompting with a typed, auditable decision").trim();
  const theme = THEMES.includes((body.theme ?? "") as (typeof THEMES)[number]) ? body.theme! : "automation";
  const exampleInput = body.exampleInput && typeof body.exampleInput === "object" ? body.exampleInput : { message: "<示例输入>" };

  const stateFrom: Record<string, string> = {};
  for (const key of Object.keys(exampleInput)) stateFrom[key] = `$.${key}`;

  const id = slugify(scenario, "custom-scenario");
  return {
    apiVersion: "yueli-dex-template/v1",
    id,
    version: "1.0.0",
    meta: { theme, scenario, useCase, utility, references: ["playground L3 scaffold generation"], exampleInput },
    state: { from: stateFrom },
    choices: [
      {
        id: "next_action",
        instructions: `In the "${scenario}" scenario, ${useCase}. Which action should be taken?`,
        criteria: {
          proceed: "Evidence clearly supports executing the standard action",
          escalate: "The situation needs a human decision or higher authority",
          needs_review: "Evidence is insufficient to decide automatically",
        },
      },
    ],
    constraints: { requireFallbackOption: "needs_review", maxOptions: 12 },
    actions: {
      next_action: {
        proceed: { kind: "task.execute", scenario },
        escalate: { kind: "human.escalate" },
        needs_review: { kind: "review.request" },
      },
    },
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = (parsed.body ?? {}) as GenerateBody;
  if (!body.scenario && !body.useCase) {
    return NextResponse.json(
      { error: "scenario or useCase description required for L3 template generation" },
      { status: 400 },
    );
  }

  const prompt = buildPrompt({
    scenario: body.scenario ?? body.useCase ?? "custom scenario",
    useCase: body.useCase ?? body.scenario ?? "",
    utility: body.utility ?? "",
    theme: body.theme,
    exampleInput: body.exampleInput,
  });

  const attempts: Array<{ name: string; run: () => Promise<{ template: unknown; model: string } | null> }> = [
    { name: "openai", run: () => generateByOpenAI(prompt) },
    { name: "cloudflare", run: () => generateByCloudflare(prompt) },
  ];

  for (const attempt of attempts) {
    try {
      const result = await attempt.run();
      if (result && validateTemplate(result.template)) {
        return NextResponse.json({
          template: result.template,
          source: "llm",
          model: result.model,
          generator: attempt.name,
        });
      }
    } catch {
      // fall through to the next generator
    }
  }

  return NextResponse.json({
    template: generateScaffold(body),
    source: "scaffold",
    generator: "scaffold",
    note: "未配置 LLM（OPENAI_API_KEY / CLOUDFLARE_API_TOKEN），已用确定性脚手架生成可运行模板",
  });
}

import type { TemplatePack } from "@haxitag/yueli-dex";
import type { JsonValue } from "@haxitag/yueli-dex-plugin-sdk";
import type { TemplateDefinition } from "./types.js";

/**
 * Yueli DEX base template pack.
 *
 * Templates were selected by cross-analyzing Jev ecosystem aggregators:
 *
 * - awesomejev.com (802 entries): top categories are Agent tooling (166),
 *   Browser & computer use (69), Integrations (33); top projects are
 *   browser-use/Jev Ultrafast (13.9k stars), fast-jev-compaction (~6k),
 *   jev-trader, jevmail.
 * - awesome-jev-projects (448 human-verified repos, 17 architecture
 *   categories, 20 topic tags): SDK & Decision Frameworks (83), Security &
 *   Guardrails (39), High-Frequency/Games (37), Browser & OS Action (HOT),
 *   Model Routing (35), Context GC (27).
 * - tryjevai.com preset use cases: support routing, agent tool selection,
 *   risk assessment, agent loop decision, urgency detection.
 * - Industry taxonomy of 28 Jev-class application cases collapsed into 8
 *   directions: agent dispatch, memory & context management, code & software
 *   quality, browser & computer use, business triage & moderation, search &
 *   data processing, realtime interactive assistance, games & complex control.
 *   The four directions expected to scale first (agent dispatch, business
 *   triage, memory screening, quality checking) share: high-frequency
 *   judgments, bounded candidate sets, context dependence, and
 *   discoverable/remediable errors.
 *
 * Each template carries a `meta` block labeled on four dimensions:
 * 主题 (theme) / 场景 (scenario) / 用例 (use case) / 效用 (utility).
 */

const templates: readonly TemplateDefinition[] = [
  {
    apiVersion: "yueli-dex-template/v1",
    id: "support-triage",
    version: "1.0.0",
    meta: {
      theme: "customer-operations",
      scenario: "ticket-routing",
      useCase: "Route an inbound support ticket to the owning team and set its priority",
      utility:
        "Replaces keyword/regex routing with semantic routing; the needs_review fallback prevents silent misrouting instead of guessing",
      references: [
        "TypeSafe Choice canonical example",
        "tryjevai.com use case #1 (Customer Support Routing)",
        "typesafe-jev-workflow (LangGraph mail routing)",
      ],
      exampleInput: {
        message: "I was charged twice and need a refund.",
        account: { plan: "pro", region: "eu" },
      },
    },
    state: {
      from: {
        message: "$.message",
        accountPlan: "$.account.plan",
        region: "$.account.region",
        goal: "$.goal",
      },
    },
    choices: [
      {
        id: "handler",
        instructions: "Which team should own this request?",
        criteria: {
          billing: "Payments, invoices, refunds, subscriptions, and pricing",
          technical: "Product bugs, outages, incidents, and integrations",
          account: "Login, permissions, profile, and data export requests",
          needs_review: "Evidence is insufficient or spans multiple teams",
        },
      },
      {
        id: "priority",
        instructions: "How severe is this issue for the customer?",
        criteria: {
          urgent: "Blocking with financial or data loss, or an active outage",
          high: "Blocking, but a workaround exists",
          normal: "Degraded experience or informational",
          needs_review: "Not enough evidence to judge severity",
        },
      },
    ],
    constraints: { requireFallbackOption: "needs_review", maxOptions: 12 },
    actions: {
      handler: {
        billing: { kind: "queue.assign", queue: "billing" },
        technical: { kind: "queue.assign", queue: "technical" },
        account: { kind: "queue.assign", queue: "account" },
        needs_review: { kind: "review.request" },
      },
      priority: {
        urgent: { kind: "priority.set", level: "urgent" },
        high: { kind: "priority.set", level: "high" },
        normal: { kind: "priority.set", level: "normal" },
        needs_review: { kind: "review.request" },
      },
    },
    examples: {
      fixtures: [
        {
          name: "enterprise-charged-twice",
          input: {
            message: "I was charged twice on my enterprise account",
            account: { plan: "enterprise" },
            goal: "resolve billing issue",
          },
          expected: { priority: "urgent" },
        },
      ],
    },
  },

  {
    apiVersion: "yueli-dex-template/v1",
    id: "email-triage",
    version: "1.0.0",
    meta: {
      theme: "communication",
      scenario: "inbox-routing",
      useCase: "Classify incoming email and apply a mailbox label",
      utility:
        "Sub-cent batch triage (~$0.03 per 1000 emails) replaces manual filing and lossy LLM summarization",
      references: [
        "jevmail (Gmail inbox classification)",
        "jev-mailroom",
        "awesomejev.com — Applications",
      ],
      exampleInput: {
        subject: "Invoice #4923 paid",
        sender: "billing@acme.com",
        snippet: "Your payment was received. Thanks for your business.",
      },
    },
    state: {
      from: {
        subject: "$.subject",
        sender: "$.sender",
        snippet: "$.snippet",
      },
    },
    choices: [
      {
        id: "category",
        instructions: "Which mailbox label fits this email?",
        criteria: {
          action_required: "A reply or task is expected from the user",
          newsletter: "Broadcast content the user subscribed to",
          notification: "Automated system, transactional, or account alerts",
          social: "Social network mentions and direct messages",
          spam_suspect: "Unsolicited bulk, marketing blast, or phishing-like mail",
          needs_review: "Cannot be classified with the available evidence",
        },
      },
    ],
    constraints: { requireFallbackOption: "needs_review", maxOptions: 16 },
    actions: {
      category: {
        action_required: { kind: "label.apply", label: "inbox" },
        newsletter: { kind: "label.apply", label: "newsletters" },
        notification: { kind: "label.apply", label: "notifications" },
        social: { kind: "label.apply", label: "social" },
        spam_suspect: { kind: "label.apply", label: "spam-review" },
        needs_review: { kind: "review.request" },
      },
    },
  },

  {
    apiVersion: "yueli-dex-template/v1",
    id: "agent-tool-selection",
    version: "1.0.0",
    meta: {
      theme: "agent-infrastructure",
      scenario: "tool-routing",
      useCase: "Pick the next tool for an agent step from the available toolset",
      utility:
        "Moves tool selection out of prompt engineering into a typed decision; modeling slots scale criteria to large toolboxes (up to 255)",
      references: [
        "tryjevai.com use case #2 (Agent Tool Selection)",
        "awesome-jev-projects — Model Routing (35 repos)",
        "ask-jev-skill / typesafe-skill-router",
      ],
      exampleInput: {
        goal: "Find the failing test and fix it",
        availableTools: ["read_file", "run_command", "search_web", "ask_user"],
        recentSteps: ["ran vitest: 2 failures in auth module"],
      },
    },
    state: {
      from: {
        goal: "$.goal",
        availableTools: "$.availableTools",
        recentSteps: "$.recentSteps",
      },
    },
    choices: [
      {
        id: "tool",
        instructions: "Which tool should the agent invoke next?",
        criteria: {
          search_web: "External knowledge or documentation is needed",
          read_file: "Repository content must be inspected before acting",
          write_file: "A concrete edit is ready to be applied",
          run_command: "A build, test, or script must be executed",
          ask_user: "The goal is ambiguous or needs a human decision",
          needs_review: "No tool clearly fits the current state",
        },
      },
    ],
    constraints: {
      requireFallbackOption: "needs_review",
      maxOptions: 24,
      allowedActionKinds: ["tool.invoke", "agent.ask_user"],
    },
    actions: {
      tool: {
        search_web: { kind: "tool.invoke", tool: "search_web" },
        read_file: { kind: "tool.invoke", tool: "read_file" },
        write_file: { kind: "tool.invoke", tool: "write_file" },
        run_command: { kind: "tool.invoke", tool: "run_command" },
        ask_user: { kind: "agent.ask_user" },
        needs_review: { kind: "agent.ask_user" },
      },
    },
    modeling: {
      mode: "optional",
      allow: { refineInstructions: true, addCriteria: true, changeActionKinds: false },
      requireEvidenceRefs: true,
    },
  },

  {
    apiVersion: "yueli-dex-template/v1",
    id: "agent-loop-control",
    version: "1.0.0",
    meta: {
      theme: "agent-infrastructure",
      scenario: "loop-decision",
      useCase: "Decide whether an agent loop should continue, retry, stop, or escalate",
      utility:
        "Prevents infinite loops and premature abandonment using calibrated confidence instead of step-count heuristics",
      references: [
        "tryjevai.com use case #4 (Agent Loop Decision)",
        "awesome-jev-projects — SDK & Decision Frameworks (83 repos)",
      ],
      exampleInput: {
        goal: "Deploy the service to staging",
        attempts: 3,
        lastAction: "run_command",
        lastError: "timeout after 30s",
      },
    },
    state: {
      from: {
        goal: "$.goal",
        attempts: "$.attempts",
        lastAction: "$.lastAction",
        lastError: "$.lastError",
      },
    },
    choices: [
      {
        id: "next_step",
        instructions: "What should the agent loop do next?",
        criteria: {
          continue: "The goal is not reached and the last step made progress",
          retry: "The last step failed transiently and may succeed on retry",
          stop_success: "The goal is already achieved",
          stop_failure: "The goal is unreachable with the available actions",
          escalate: "Stuck, or a human decision is required",
          needs_review: "The evidence is insufficient to choose",
        },
      },
    ],
    constraints: {
      requireFallbackOption: "needs_review",
      maxOptions: 8,
      allowedActionKinds: ["loop.control", "human.escalate"],
    },
    actions: {
      next_step: {
        continue: { kind: "loop.control", step: "continue" },
        retry: { kind: "loop.control", step: "retry" },
        stop_success: { kind: "loop.control", step: "stop_success" },
        stop_failure: { kind: "loop.control", step: "stop_failure" },
        escalate: { kind: "human.escalate" },
        needs_review: { kind: "human.escalate" },
      },
    },
  },

  {
    apiVersion: "yueli-dex-template/v1",
    id: "context-compaction",
    version: "1.0.0",
    meta: {
      theme: "agent-infrastructure",
      scenario: "context-gc",
      useCase: "Decide per tool call/result whether to keep verbatim, truncate, or drop during context compaction",
      utility:
        "Replaces lossy summarization compaction; kept content stays verbatim — pattern validated by fast-jev-compaction (~6k stars)",
      references: [
        "tamaratran/fast-jev-compaction",
        "jev-pruner, jev-recall",
        "awesome-jev-projects — Context GC (27 repos)",
      ],
      exampleInput: {
        conversation: [
          "user: fix the auth bug in login",
          "assistant: reading src/auth.ts",
        ],
        tool: { name: "read_file", input: "src/auth.ts", result: "4213 chars" },
      },
    },
    state: {
      from: {
        conversation: "$.conversation",
        toolName: "$.tool.name",
        toolInput: "$.tool.input",
        toolResult: "$.tool.result",
      },
    },
    choices: [
      {
        id: "disposition",
        instructions: "How should this tool call and its result be treated in the compacted context?",
        criteria: {
          keep_verbatim: "The call or its result is likely still needed later",
          truncate: "The call matters but the full result is replaceable by a short note",
          drop: "Neither the call nor the result is likely needed again",
          needs_review: "Importance cannot be judged from the current state",
        },
      },
    ],
    constraints: {
      requireFallbackOption: "needs_review",
      maxOptions: 8,
      allowedActionKinds: ["context.gc"],
    },
    actions: {
      disposition: {
        keep_verbatim: { kind: "context.gc", disposition: "keep_verbatim" },
        truncate: { kind: "context.gc", disposition: "truncate" },
        drop: { kind: "context.gc", disposition: "drop" },
        needs_review: { kind: "context.gc", disposition: "keep_verbatim" },
      },
    },
  },

  {
    apiVersion: "yueli-dex-template/v1",
    id: "security-gate",
    version: "1.0.0",
    meta: {
      theme: "security",
      scenario: "tool-call-approval",
      useCase: "Approve, require confirmation for, or block a tool call or shell command before execution",
      utility:
        "Prompt-injection and destructive-command defense; pair with per-action thresholds (read-only >= 0.7, destructive >= 0.9) and human fallback",
      references: [
        "awesome-jev-projects — Security & Guardrails (39 repos)",
        "jev-guard, jev-shield, agent-chaperone",
        "Vercel KB — Auto-approve tool calls in eve with Jev",
      ],
      exampleInput: {
        command: "rm",
        args: "-rf node_modules",
        environment: "development",
        actor: "claude-code",
      },
    },
    state: {
      from: {
        command: "$.command",
        args: "$.args",
        environment: "$.environment",
        actor: "$.actor",
      },
    },
    choices: [
      {
        id: "verdict",
        instructions: "Should this tool call be executed?",
        criteria: {
          approve: "The call is safe, intended, and within policy",
          require_confirmation: "The call is plausibly intended but carries side effects worth confirming",
          block: "The call is destructive, out of policy, or looks injected",
          needs_review: "Safety cannot be judged from the available evidence",
        },
      },
    ],
    constraints: {
      requireFallbackOption: "needs_review",
      maxOptions: 8,
      allowedActionKinds: ["gate.verdict"],
    },
    actions: {
      verdict: {
        approve: { kind: "gate.verdict", verdict: "approve" },
        require_confirmation: { kind: "gate.verdict", verdict: "require_confirmation" },
        block: { kind: "gate.verdict", verdict: "block" },
        needs_review: { kind: "gate.verdict", verdict: "require_confirmation" },
      },
    },
  },

  {
    apiVersion: "yueli-dex-template/v1",
    id: "content-moderation",
    version: "1.0.0",
    meta: {
      theme: "security",
      scenario: "content-filter",
      useCase: "Moderate user-generated content in real time (allow, flag, or hide)",
      utility:
        "Sub-500ms decisions enable timeline cleanup, extension-grade filtering, and feed curation at feed scale",
      references: [
        "slop-filter, lkclean, vibecheck, xtags",
        "awesomejev.com — Browser & computer use / Applications",
      ],
      exampleInput: {
        content: "You won't believe this one weird trick doctors hate...",
        channel: "timeline",
        author: { notes: "new account, no history" },
      },
    },
    state: {
      from: {
        content: "$.content",
        channel: "$.channel",
        authorNotes: "$.author.notes",
      },
    },
    choices: [
      {
        id: "verdict",
        instructions: "What should happen to this piece of content?",
        criteria: {
          allow: "Normal, on-topic, policy-compliant content",
          flag: "Borderline: spammy, low-value, or mildly violating",
          hide: "Clearly violating, spam, or abusive content",
          needs_review: "The content cannot be judged with the given context",
        },
      },
    ],
    constraints: {
      requireFallbackOption: "needs_review",
      maxOptions: 8,
      allowedActionKinds: ["content.verdict"],
    },
    actions: {
      verdict: {
        allow: { kind: "content.verdict", verdict: "allow" },
        flag: { kind: "content.verdict", verdict: "flag" },
        hide: { kind: "content.verdict", verdict: "hide" },
        needs_review: { kind: "content.verdict", verdict: "flag" },
      },
    },
  },

  {
    apiVersion: "yueli-dex-template/v1",
    id: "model-routing",
    version: "1.0.0",
    meta: {
      theme: "agent-infrastructure",
      scenario: "llm-routing",
      useCase: "Classify request complexity to select a model tier before generation",
      utility:
        "Cuts generation cost by sending easy traffic to small tiers; dual-threshold policy defaults to a safe tier when routing is ambiguous",
      references: [
        "LiteLLM, jev-router family, pi-jev-router",
        "awesome-jev-projects — Model Routing (35 repos)",
      ],
      exampleInput: {
        prompt: "Summarize this changelog in three bullets",
        taskType: "summarization",
        historyTokens: 1200,
      },
    },
    state: {
      from: {
        prompt: "$.prompt",
        taskType: "$.taskType",
        historyTokens: "$.historyTokens",
      },
    },
    choices: [
      {
        id: "tier",
        instructions: "Which model tier should serve this request?",
        criteria: {
          nano: "Trivial transforms: reformat, trim, simple extraction",
          small: "Routine summarization, classification, light editing",
          mid: "Multi-step rewriting or synthesis over one document",
          large: "Cross-document reasoning, design, or subtle judgment",
          frontier: "Novel problems, deep reasoning, or high-stakes drafting",
          needs_review: "Complexity cannot be determined from the request",
        },
      },
    ],
    constraints: {
      requireFallbackOption: "needs_review",
      maxOptions: 12,
      allowedActionKinds: ["route.model"],
    },
    actions: {
      tier: {
        nano: { kind: "route.model", tier: "nano" },
        small: { kind: "route.model", tier: "small" },
        mid: { kind: "route.model", tier: "mid" },
        large: { kind: "route.model", tier: "large" },
        frontier: { kind: "route.model", tier: "frontier" },
        needs_review: { kind: "route.model", tier: "mid" },
      },
    },
    modeling: {
      mode: "optional",
      allow: { refineInstructions: true, addCriteria: true, changeActionKinds: false },
      requireEvidenceRefs: true,
    },
  },

  {
    apiVersion: "yueli-dex-template/v1",
    id: "browser-action",
    version: "1.0.0",
    meta: {
      theme: "automation",
      scenario: "browser-control",
      useCase: "Select the next browser action (and element target) for an automation agent",
      utility:
        "~300ms decision latency makes voice and real-time agents viable; selecting from indexed elements instead of generating coordinates eliminates hallucinated targets",
      references: [
        "browser-use / Jev Ultrafast (13.9k stars)",
        "moritzkremb/jev-voice-browser",
        "typesafe-computer-use",
        "awesome-jev-projects — Browser & OS Action (HOT, 36 repos)",
      ],
      exampleInput: {
        goal: "Book a flight to Tokyo",
        page: {
          url: "https://example.com/flights",
          elements: [
            { id: "e01", role: "textbox", label: "From" },
            { id: "e02", role: "textbox", label: "To" },
            { id: "e03", role: "button", label: "Search" },
          ],
        },
      },
    },
    state: {
      from: {
        goal: "$.goal",
        url: "$.page.url",
        elements: "$.page.elements",
      },
    },
    choices: [
      {
        id: "action",
        instructions: "Which browser action should be performed next?",
        criteria: {
          navigate: "Open a URL or go to a site",
          click: "Activate a specific indexed element on the page",
          type: "Enter text into a specific indexed field",
          scroll: "Reveal more of the page",
          wait: "The page is loading or an element is not yet present",
          done: "The goal has been achieved",
          blocked: "The goal cannot be achieved on this page",
          needs_review: "The next action is ambiguous or needs a human",
        },
      },
    ],
    constraints: {
      requireFallbackOption: "needs_review",
      maxOptions: 255,
      allowedActionKinds: ["browser.act", "agent.ask_user"],
    },
    actions: {
      action: {
        navigate: { kind: "browser.act", action: "navigate" },
        click: { kind: "browser.act", action: "click" },
        type: { kind: "browser.act", action: "type" },
        scroll: { kind: "browser.act", action: "scroll" },
        wait: { kind: "browser.act", action: "wait" },
        done: { kind: "browser.act", action: "done" },
        blocked: { kind: "browser.act", action: "blocked" },
        needs_review: { kind: "agent.ask_user" },
      },
    },
    modeling: {
      mode: "optional",
      allow: { refineInstructions: true, addCriteria: true, changeActionKinds: false },
      requireEvidenceRefs: true,
    },
  },

  {
    apiVersion: "yueli-dex-template/v1",
    id: "code-review-gate",
    version: "1.0.0",
    meta: {
      theme: "developer-tooling",
      scenario: "pr-review",
      useCase: "Gate a pull request or generated change: approve, request changes, or request tests",
      utility:
        "Auditable CI gate for coding agents; the most crowded Jev category (Agent tooling, 166 entries) validates the demand",
      references: [
        "jev-review, clean-code-review, diffjury, jev-commit",
        "awesomejev.com — Agent tooling (166 entries)",
      ],
      exampleInput: {
        title: "Fix auth token refresh",
        description: "Refresh tokens before expiry instead of after",
        diff: "@@ -12,6 +12,9 @@\n+if (expired) refresh();",
        testDelta: "+3 tests",
      },
    },
    state: {
      from: {
        title: "$.title",
        description: "$.description",
        diff: "$.diff",
        testDelta: "$.testDelta",
      },
    },
    choices: [
      {
        id: "verdict",
        instructions: "What should the review verdict be for this change?",
        criteria: {
          approve: "The change is correct, described, and adequately tested",
          request_changes: "The change has defects or risks that must be fixed",
          request_tests: "The change looks correct but lacks verification",
          needs_review: "The diff is too ambiguous to judge automatically",
        },
      },
    ],
    constraints: {
      requireFallbackOption: "needs_review",
      maxOptions: 12,
      allowedActionKinds: ["review.verdict"],
    },
    actions: {
      verdict: {
        approve: { kind: "review.verdict", verdict: "approve" },
        request_changes: { kind: "review.verdict", verdict: "request_changes" },
        request_tests: { kind: "review.verdict", verdict: "request_tests" },
        needs_review: { kind: "review.verdict", verdict: "needs_review" },
      },
    },
  },

  /* ---------------------------------------------------------------- */
  /*   Mode A · Chunk triage  —  Winnow / winnowfast-jev-compaction    */
  /*   "Per chunk, keep verbatim, hide with stub, or fall back"       */
  /* ---------------------------------------------------------------- */

  {
    apiVersion: "yueli-dex-template/v1",
    id: "chunk-triage",
    version: "1.0.0",
    meta: {
      theme: "agent-infrastructure",
      scenario: "context-chunk-sieve",
      useCase:
        "For each chunk of tool output or memory entry, decide keep verbatim, hide with a recallable stub, or keep a summary",
      utility:
        "Replaces lossy summarization; Winnow hits ~80% token reduction with calibrated probabilities; hidden chunks stay recoverable via a cache key",
      references: [
        "GhalebDweikat/winnow — context sieve for Claude Code",
        "tamaratran/fast-jev-compaction — tool-call compaction",
        "jkudish/jev-mcp — jev_screen, jev_find",
      ],
      exampleInput: {
        chunkId: "src/auth.ts:41-188",
        chunkText: "function authenticate(token: string) { ... }",
        goal: "fix refresh-token bug",
        provenance: { tool: "read_file", file: "src/auth.ts" },
      },
    },
    state: {
      from: {
        chunkId: "$.chunkId",
        goal: "$.goal",
        toolName: "$.provenance.tool",
        chunkSize: "$.chunkText",
      },
    },
    choices: [
      {
        id: "disposition",
        instructions: "What should happen to this chunk in the agent context?",
        criteria: {
          keep_verbatim: "The chunk is likely needed verbatim for the current goal",
          hide_with_stub: "The chunk is unlikely to matter but should be cached for recall",
          keep_summary: "Keep a short summary; the full text (headers, imports, comments) is replaceable",
          needs_review: "Cannot be judged from the available evidence",
        },
      },
    ],
    constraints: {
      requireFallbackOption: "needs_review",
      maxOptions: 8,
      allowedActionKinds: ["context.chunk"],
    },
    actions: {
      disposition: {
        keep_verbatim: { kind: "context.chunk", disposition: "keep_verbatim" },
        hide_with_stub: { kind: "context.chunk", disposition: "hide_with_stub" },
        keep_summary: { kind: "context.chunk", disposition: "keep_summary" },
        needs_review: { kind: "context.chunk", disposition: "keep_verbatim" },
      },
    },
  },

  /* ---------------------------------------------------------------- */
  /*   Mode B · Claim verification  —  jev-mcp jev_verify / jev_gate */
  /* ---------------------------------------------------------------- */

  {
    apiVersion: "yueli-dex-template/v1",
    id: "claim-verify",
    version: "1.0.0",
    meta: {
      theme: "communication",
      scenario: "claim-verification",
      useCase: "Verify, contradict, or mark unsupported each claim against its cited evidence",
      utility:
        "Audit-grade claim verification in batch; runs in CI for PR descriptions, research briefs, and RAG answers",
      references: [
        "jkudish/jev-mcp — jev_verify, jev_gate",
        "Vercel KB — typesafe-jev-and-ai-sdk",
        "awesome-jev-projects — Decision Frameworks",
      ],
      exampleInput: {
        claim: "Authentication uses HS256 with a 24-hour token lifetime",
        evidence:
          "src/auth.ts#L42 exports jwt.sign(payload, SECRET, { algorithm: 'HS256', expiresIn: '24h' })",
        threshold: 0.8,
      },
    },
    state: {
      from: {
        claim: "$.claim",
        evidence: "$.evidence",
        threshold: "$.threshold",
      },
    },
    choices: [
      {
        id: "verdict",
        instructions: "How should this claim be classified against the evidence?",
        criteria: {
          verified: "The evidence clearly supports the claim",
          contradicted: "The evidence clearly refutes the claim",
          unsupported: "The evidence does not address the claim",
          needs_review: "The claim is ambiguous or the evidence is missing",
        },
      },
    ],
    constraints: {
      requireFallbackOption: "needs_review",
      maxOptions: 8,
      allowedActionKinds: ["claim.verdict"],
    },
    actions: {
      verdict: {
        verified: { kind: "claim.verdict", verdict: "verified" },
        contradicted: { kind: "claim.verdict", verdict: "contradicted" },
        unsupported: { kind: "claim.verdict", verdict: "unsupported" },
        needs_review: { kind: "claim.verdict", verdict: "unsupported" },
      },
    },
  },

  /* ---------------------------------------------------------------- */
  /*   Mode C · Real-time action  —  mario / OneVOne / trader / drone */
  /*   "Per tick, pick the next macro action + risk level"             */
  /* ---------------------------------------------------------------- */

  {
    apiVersion: "yueli-dex-template/v1",
    id: "realtime-action",
    version: "1.0.0",
    meta: {
      theme: "automation",
      scenario: "real-time-control",
      useCase:
        "Per tick, pick the next macro action from a closed action space and rate the immediate risk — code owns safety and timing, Jev owns tactics",
      utility:
        "Sub-300ms decisions enable voice, gaming, trading, and drone control; closed action space and risk headroom keep the system recoverable",
      references: [
        "fhshaik/typesafe-mario (NES, 7 actions, RAM state)",
        "emrickgarrett/OneVOneJev (1v1 FPS, 6 axes @ 9Hz)",
        "jarrodwatts/jev-trader (Monad MM, ~81ms per block)",
        "RomanSlack/jev-drone (4 layers, Jev at 2.5Hz)",
        "browser-use/jev-ultrafast (browser agent, ~7s end-to-end)",
      ],
      exampleInput: {
        tickHz: 9,
        actionSpace: ["noop", "advance", "advance_jump", "retreat", "defend", "use_ability"],
        state: {
          player: { x: 172, y: 79, vx: 1, grounded: true },
          hazards: [{ kind: "goomba", dx: 42, dy: 0 }],
          terrain: { gapAhead: 0, climbableTop: null },
          goal: "reach flagpole alive",
        },
      },
    },
    state: {
      from: {
        tickHz: "$.tickHz",
        grounded: "$.state.player.grounded",
        hazards: "$.state.hazards",
        goal: "$.state.goal",
      },
    },
    choices: [
      {
        id: "action",
        instructions:
          "Pick the next macro action. Code already owns safety reflexes — Jev only owns tactics.",
        criteria: {
          noop: "Hold position; the current state needs no change",
          advance: "Move forward through clear terrain",
          advance_jump: "Move forward and jump over the near hazard or gap",
          retreat: "A hazard requires backing off this tick",
          defend: "Block, brake, or take a non-progress defensive action",
          use_ability: "Trigger an ability, item, or special move",
          needs_review: "The state is ambiguous; fall back to a reflex or a human",
        },
      },
      {
        id: "risk",
        instructions: "How risky is the immediate future of this state?",
        criteria: {
          clear: "Wide open, no nearby threat",
          narrow: "Tight space, near a hazard",
          imminent: "A collision or failure is likely within one tick",
          needs_review: "Risk is unclear; the caller should assume imminent danger",
        },
      },
    ],
    constraints: {
      requireFallbackOption: "needs_review",
      maxOptions: 8,
      allowedActionKinds: ["realtime.act", "realtime.risk"],
    },
    actions: {
      action: {
        noop: { kind: "realtime.act", action: "noop" },
        advance: { kind: "realtime.act", action: "advance" },
        advance_jump: { kind: "realtime.act", action: "advance_jump" },
        retreat: { kind: "realtime.act", action: "retreat" },
        defend: { kind: "realtime.act", action: "defend" },
        use_ability: { kind: "realtime.act", action: "use_ability" },
        needs_review: { kind: "realtime.act", action: "noop" },
      },
      risk: {
        clear: { kind: "realtime.risk", level: "clear" },
        narrow: { kind: "realtime.risk", level: "narrow" },
        imminent: { kind: "realtime.risk", level: "imminent" },
        needs_review: { kind: "realtime.risk", level: "imminent" },
      },
    },
    examples: {
      fixtures: [
        {
          name: "airborne-with-hazard",
          input: {
            tickHz: 9,
            actionSpace: ["noop", "advance", "defend"],
            state: {
              player: { grounded: false },
              hazards: [{ kind: "goomba" }],
              goal: "reach flagpole",
            },
          },
          expected: { action: "defend" },
        },
        {
          name: "grounded-with-hazard",
          input: {
            tickHz: 9,
            actionSpace: ["noop", "advance", "defend"],
            state: {
              player: { grounded: true },
              hazards: [{ kind: "goomba" }],
              goal: "reach flagpole",
            },
          },
          // No local rule fires — falls through to provider. Fixture documents
          // the expected behavior: NOT short-circuited, so `action` is
          // not predicted here.
        },
      ],
    },
  },

  /* ---------------------------------------------------------------- */
  /*   Mode D · Graph/tree traverse  —  Blink / neo4jev / agent-desktop*/
  /*   "At each node, pick the next structural move"                  */
  /* ---------------------------------------------------------------- */

  {
    apiVersion: "yueli-dex-template/v1",
    id: "graph-traverse",
    version: "1.0.0",
    meta: {
      theme: "developer-tooling",
      scenario: "graph-hop",
      useCase:
        "At each node, pick the next structural move — dive into a child, branch across siblings, stay at the current node, backtrack, or stop",
      utility:
        "Walker-style navigation over trees/graphs; the L2 provider picks the structural move while the caller resolves the chosen edge id",
      references: [
        "ellipsis-dev/blink (codebase walker, Jev per directory level)",
        "jexp/neo4jev (Neo4j beam search, Jev per node)",
        "lahfir/agent-desktop (progressive skeleton traversal of the OS UI tree)",
      ],
      exampleInput: {
        goal: "where is authentication handled?",
        currentNode: { label: "src/", depth: 0 },
        candidateEdges: ["auth/", "ui/", "utils/"],
        found: false,
        budget: { topK: 1, maxDepth: 5 },
      },
    },
    state: {
      from: {
        goal: "$.goal",
        nodeLabel: "$.currentNode.label",
        depth: "$.currentNode.depth",
        candidates: "$.candidateEdges",
        found: "$.found",
        maxDepth: "$.budget.maxDepth",
      },
    },
    choices: [
      {
        id: "next_move",
        instructions:
          "What is the next structural move at this node? Code resolves the chosen edge id locally.",
        criteria: {
          dive_in: "One candidate looks clearly best and depth budget allows",
          branch: "Two or more candidates look plausible and budget allows parallel walkers",
          stay: "The current node already contains the answer; stop walking",
          backtrack: "No candidate looks promising; move back up",
          needs_review: "Cannot tell from the available evidence",
        },
      },
    ],
    constraints: {
      requireFallbackOption: "needs_review",
      maxOptions: 8,
      allowedActionKinds: ["graph.walk"],
    },
    actions: {
      next_move: {
        dive_in: { kind: "graph.walk", move: "dive_in" },
        branch: { kind: "graph.walk", move: "branch" },
        stay: { kind: "graph.walk", move: "stay" },
        backtrack: { kind: "graph.walk", move: "backtrack" },
        needs_review: { kind: "graph.walk", move: "backtrack" },
      },
    },
  },

  /* ---------------------------------------------------------------- */
  /*   Mode E · Structured extract  —  jev-mcp jev_extract / jev-curate*/
  /*   "Pick the best-matching candidate from a regex-pre-filtered set"*/
  /* ---------------------------------------------------------------- */

  {
    apiVersion: "yueli-dex-template/v1",
    id: "extract-field",
    version: "1.0.0",
    meta: {
      theme: "developer-tooling",
      scenario: "structured-extract",
      useCase:
        "Pick the best-matching candidate (or none) for a named field from up to 4 pre-filtered candidates; values stay verbatim",
      utility:
        "Regex pre-filter at line speed, Jev picks the right match; extracted values are never rephrased by the model — caller copies the chosen string byte-for-byte",
      references: [
        "jkudish/jev-mcp — jev_extract",
        "AkashPriyadarshii/jev-curate — data quality filter",
      ],
      exampleInput: {
        field: "package_version",
        candidates: [
          { id: "c1", text: '"version": "1.2.3"' },
          { id: "c2", text: 'package_version = "1.2.3"' },
          { id: "c3", text: 'name = "demo"' },
        ],
        context: "package manifest",
      },
    },
    state: {
      from: {
        field: "$.field",
        candidates: "$.candidates",
        context: "$.context",
      },
    },
    choices: [
      {
        id: "match",
        instructions:
          "Which candidate (if any) is the field value in context? Caller copies the matched text verbatim — never rephrased.",
        criteria: {
          c1: "First candidate is the field value in context",
          c2: "Second candidate is the field value in context",
          c3: "Third candidate is the field value in context",
          c4: "Fourth candidate is the field value in context",
          not_found: "No candidate matches the field in context",
        },
      },
    ],
    constraints: {
      requireFallbackOption: "not_found",
      maxOptions: 8,
      allowedActionKinds: ["extract.match"],
    },
    actions: {
      match: {
        c1: { kind: "extract.match", choice: "c1" },
        c2: { kind: "extract.match", choice: "c2" },
        c3: { kind: "extract.match", choice: "c3" },
        c4: { kind: "extract.match", choice: "c4" },
        not_found: { kind: "extract.match", choice: "not_found" },
      },
    },
  },

  /* ---------------------------------------------------------------- */
  /*   Mode F · Multi-dim scoring  —  killmyidea                       */
  /*   "Aggregate 8 dimension scores into a KILL/FIX/SHIP verdict"     */
  /* ---------------------------------------------------------------- */

  {
    apiVersion: "yueli-dex-template/v1",
    id: "startup-pitch",
    version: "1.0.0",
    meta: {
      theme: "agent-infrastructure",
      scenario: "idea-evaluation",
      useCase: "Score a startup idea across 8 dimensions and decide KILL, FIX, or SHIP",
      utility:
        "Reproducible pre-investment gate; calibrated 0-4 scores avoid LLM-style hallucinated quality opinions; threshold floor prevents false SHIP on weak signals",
      references: [
        "monteduro/killmyidea",
        "awesome-jev-projects — Decision Frameworks",
      ],
      exampleInput: {
        idea:
          "A TypeScript ORM that runs in the browser and syncs via CRDTs for offline-first apps",
        goal: "money",
        context: "B2B SaaS, indie team, target devs at early-stage startups",
      },
    },
    state: {
      from: {
        idea: "$.idea",
        goal: "$.goal",
        context: "$.context",
      },
    },
    choices: [
      {
        id: "verdict",
        instructions:
          "Based on multi-dimensional scoring, what's the verdict for this idea?",
        criteria: {
          kill: "Average dimension score is below 50; the idea should not be pursued",
          fix: "Average score is 50-64; meaningful changes are required before re-evaluation",
          ship: "Average score is >=65; the idea is worth pursuing",
          needs_review: "The idea is too short or ambiguous to score",
        },
      },
    ],
    constraints: {
      requireFallbackOption: "needs_review",
      maxOptions: 8,
      allowedActionKinds: ["idea.verdict"],
    },
    actions: {
      verdict: {
        kill: { kind: "idea.verdict", verdict: "kill" },
        fix: { kind: "idea.verdict", verdict: "fix" },
        ship: { kind: "idea.verdict", verdict: "ship" },
        needs_review: { kind: "idea.verdict", verdict: "needs_review" },
      },
    },
    examples: {
      fixtures: [
        {
          name: "short-idea",
          input: { idea: "AI todo", goal: "money" },
          expected: { verdict: "needs_review" },
        },
        {
          name: "long-idea",
          input: {
            idea:
              "An offline-first TypeScript ORM that syncs via CRDTs and runs in the browser for collaborative apps",
            goal: "money",
          },
          // Long enough not to short-circuit. Fixture documents behavior:
          // no local rule fires, falls through to provider.
        },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // The six templates below close coverage gaps against the industry's
  // eight-direction taxonomy of Jev-class model use cases (agent dispatch,
  // memory & context, code & QA, computer use, business triage & moderation,
  // search & data, realtime assistance, games & complex control).
  // ─────────────────────────────────────────────────────────────────────────

  {
    apiVersion: "yueli-dex-template/v1",
    id: "agent-handoff",
    version: "1.0.0",
    meta: {
      theme: "agent-infrastructure",
      scenario: "agent-dispatch",
      useCase:
        "Decide how to handle a task: process it directly, escalate to a stronger model, or hand off to a human",
      utility:
        "Cuts wasted calls and wall-clock waiting; the same label (e.g. 'urgent') maps to different handling per business, so criteria carry the business's own examples rather than a fixed threshold",
      references: [
        "Industry direction #1: Agent 调度 (model / tool / skill selection, human handoff)",
        "tryjevai.com use case family (Agent orchestration)",
      ],
      exampleInput: {
        task: "Refactor the billing module to use the new invoice schema",
        availableSkills: ["code-edit", "docs-search"],
        budgetRemainingUsd: 0.8,
      },
    },
    state: {
      from: {
        task: "$.task",
        availableSkills: "$.availableSkills",
        budgetRemainingUsd: "$.budgetRemainingUsd",
      },
    },
    choices: [
      {
        id: "dispatch",
        instructions:
          "How should this task be handled right now? Judge by task difficulty vs. local capability, blast radius of getting it wrong, and remaining budget.",
        criteria: {
          handle_locally:
            "Routine, well-bounded work the current agent and skills can complete reliably",
          escalate_model:
            "Requires deeper reasoning or domain knowledge; a stronger model should take it before a human ever sees it",
          handoff_human:
            "Irreversible, high-stakes, or outside policy; a person must decide",
          needs_review: "Task description is too vague to judge",
        },
      },
    ],
    constraints: { requireFallbackOption: "needs_review", maxOptions: 6 },
    actions: {
      dispatch: {
        handle_locally: { kind: "agent.dispatch", target: "self" },
        escalate_model: { kind: "agent.dispatch", target: "stronger-model" },
        handoff_human: { kind: "agent.dispatch", target: "human" },
        needs_review: { kind: "review.request" },
      },
    },
    examples: {
      fixtures: [
        {
          name: "irreversible-refactor",
          input: {
            task: "Drop and recreate the production invoices table with the new schema",
            availableSkills: ["db-migrate"],
            budgetRemainingUsd: 2.5,
          },
          expected: { dispatch: "handoff_human" },
        },
      ],
    },
  },

  {
    apiVersion: "yueli-dex-template/v1",
    id: "memory-recall",
    version: "1.0.0",
    meta: {
      theme: "agent-infrastructure",
      scenario: "memory-recall-gating",
      useCase:
        "For each candidate memory entry, decide whether to recall it into the current task context or skip it",
      utility:
        "Separates 'topically similar' from 'applicable right now' — the more an agent remembers, the more retrieval noise costs; gate each entry instead of stuffing the k-nearest neighbors",
      references: [
        "Industry direction #2: 记忆与上下文管理 (history screening, retrieval re-ranking)",
        "fast-jev-compaction / Winnow family (context budgeting)",
      ],
      exampleInput: {
        task: "Fix a refund double-charge bug reported by an EU enterprise customer",
        memoryEntry: {
          summary: "EU customer filed a double-charge refund in March; resolution SLA is 2h",
          recordedAt: "2026-03-04",
          tags: ["billing", "eu"],
        },
      },
    },
    state: {
      from: {
        task: "$.task",
        memorySummary: "$.memoryEntry.summary",
        memoryRecordedAt: "$.memoryEntry.recordedAt",
        memoryTags: "$.memoryEntry.tags",
      },
    },
    choices: [
      {
        id: "recall",
        instructions:
          "Should this memory be recalled for the current task? Judge applicability to THIS task, not mere topic overlap.",
        criteria: {
          recall:
            "Directly informs the current task: same entities, same policy, or a precedent the task should follow",
          defer:
            "Not needed for the current step, but will matter for an expected next step — keep it warm for retrieval",
          skip:
            "Topically similar but not applicable now — older policy, different product area, or background noise",
          needs_review: "Cannot tell from the summary alone",
        },
      },
    ],
    constraints: { requireFallbackOption: "needs_review", maxOptions: 6 },
    actions: {
      recall: {
        recall: { kind: "memory.recall", mode: "inject" },
        defer: { kind: "memory.recall", mode: "warm" },
        skip: { kind: "memory.recall", mode: "skip" },
        needs_review: { kind: "review.request" },
      },
    },
    examples: {
      fixtures: [
        {
          name: "same-entity-precedent",
          input: {
            task: "Fix a refund double-charge bug reported by an EU enterprise customer",
            memoryEntry: {
              summary: "EU enterprise double-charge cases qualify for the 2h priority SLA",
              recordedAt: "2026-08-01",
              tags: ["billing", "eu", "sla"],
            },
          },
          expected: { recall: "recall" },
        },
      ],
    },
  },

  {
    apiVersion: "yueli-dex-template/v1",
    id: "qa-check-targeting",
    version: "1.0.0",
    meta: {
      theme: "developer-tooling",
      scenario: "qa-check-targeting",
      useCase:
        "For each changed file or area, decide whether it merits additional checks — extra tests, a coding-model review, or human confirmation",
      utility:
        "Finds where extra checking actually pays off instead of blanket-gating every diff; test/coding models and humans then confirm the flagged spots, keeping review budget proportional to risk",
      references: [
        "Industry direction #3: 代码与软件质量检查 (PR review, code scoring, QA triage)",
        "jev-review / diffjury / clean-code-review family",
      ],
      exampleInput: {
        file: "packages/core/src/routing.ts",
        changeKind: "logic-rewrite",
        diffSummary:
          "Replaces the round-robin tie-break in provider selection with a latency-weighted score",
        coverage: "78%",
      },
    },
    state: {
      from: {
        file: "$.file",
        changeKind: "$.changeKind",
        diffSummary: "$.diffSummary",
        coverage: "$.coverage",
      },
    },
    choices: [
      {
        id: "verdict",
        instructions:
          "Does this change merit additional checking beyond the default CI? Consider blast radius, logic vs. cosmetic nature, and coverage around the touched lines.",
        criteria: {
          add_checks:
            "Behavioral logic changed with real failure blast radius — queue targeted tests and a model review",
          human_confirm:
            "Subtle or policy-laden change a model review cannot settle alone — a human should look",
          pass:
            "Cosmetic, generated, or fully covered change; default CI is sufficient",
          needs_review: "Diff summary is too thin to judge",
        },
      },
    ],
    constraints: { requireFallbackOption: "needs_review", maxOptions: 6 },
    actions: {
      verdict: {
        add_checks: { kind: "qa.target", action: "extra-checks" },
        human_confirm: { kind: "qa.target", action: "human-confirm" },
        pass: { kind: "qa.target", action: "default-ci" },
        needs_review: { kind: "review.request" },
      },
    },
    examples: {
      fixtures: [
        {
          name: "cosmetic-readme-change",
          input: {
            file: "README.md",
            changeKind: "docs",
            diffSummary: "Fixes a typo in the install section",
            coverage: "n/a",
          },
          expected: { verdict: "pass" },
        },
      ],
    },
  },

  {
    apiVersion: "yueli-dex-template/v1",
    id: "review-queue",
    version: "1.0.0",
    meta: {
      theme: "customer-operations",
      scenario: "review-queue-priority",
      useCase:
        "Rank items in a human review queue: how deep should the reviewer go, and how soon",
      utility:
        "Orders the human-escalation backlog so scarce reviewer time lands where mistakes are expensive; high-frequency calls, explicit flow, easily checkable outcomes — the most commercially grounded Jev direction",
      references: [
        "Industry direction #5: 业务分流与内容审核 (human review ranking)",
        "slop-filter / moderation queue patterns",
      ],
      exampleInput: {
        item: "Payout hold released automatically for a flagged seller",
        flags: ["payout-auto-release", "seller-history-clean"],
        businessImpact: "monetary",
      },
    },
    state: {
      from: {
        item: "$.item",
        flags: "$.flags",
        businessImpact: "$.businessImpact",
      },
    },
    choices: [
      {
        id: "depth",
        instructions: "How deep should the human review of this item go?",
        criteria: {
          deep:
            "Monetary/legal/reputational impact or conflicting signals — senior reviewer, full context",
          standard:
            "Ordinary flagged item within known patterns — standard reviewer pass",
          quick:
            "Low-stakes, likely auto-resolvable — a glance or batch confirm",
          needs_review: "Item description insufficient to rank",
        },
      },
      {
        id: "urgency",
        instructions: "How soon must a human look at this item?",
        criteria: {
          now: "Active harm or SLA clock is running — interrupt the queue",
          today: "Should be handled within the working day",
          backlog: "Can wait for the next batch window",
          needs_review: "Not enough evidence to judge timing",
        },
      },
    ],
    constraints: { requireFallbackOption: "needs_review", maxOptions: 8 },
    actions: {
      depth: {
        deep: { kind: "review.rank", depth: "deep" },
        standard: { kind: "review.rank", depth: "standard" },
        quick: { kind: "review.rank", depth: "quick" },
        needs_review: { kind: "review.request" },
      },
      urgency: {
        now: { kind: "review.rank", urgency: "now" },
        today: { kind: "review.rank", urgency: "today" },
        backlog: { kind: "review.rank", urgency: "backlog" },
        needs_review: { kind: "review.request" },
      },
    },
    examples: {
      fixtures: [
        {
          name: "monetary-impact-deep-now",
          input: {
            item: "Payout hold released automatically for a flagged seller",
            flags: ["payout-auto-release", "seller-history-clean"],
            businessImpact: "monetary",
          },
          expected: { depth: "deep", urgency: "now" },
        },
      ],
    },
  },

  {
    apiVersion: "yueli-dex-template/v1",
    id: "record-filter",
    version: "1.0.0",
    meta: {
      theme: "automation",
      scenario: "nl-record-filter",
      useCase:
        "Apply a natural-language filtering rule to each record: include, exclude, or send to manual review",
      utility:
        "Handles conditions that cannot be enumerated as keyword rules but CAN be shown by concrete examples — entity matching, fuzzy scope, per-record judgment; the chosen records are passed through untouched",
      references: [
        "Industry direction #6: 搜索与数据处理 (NL filtering, entity match, SQL condition expansion)",
        "jev-curate / jev-mcp extraction family",
      ],
      exampleInput: {
        rule: "Keep records about EU enterprise customers disputing a duplicate charge",
        record: {
          customer: "Acme GmbH",
          region: "eu",
          plan: "enterprise",
          note: "Customer reports being billed twice for the March invoice",
        },
      },
    },
    state: {
      from: {
        rule: "$.rule",
        customer: "$.record.customer",
        region: "$.record.region",
        plan: "$.record.plan",
        note: "$.record.note",
      },
    },
    choices: [
      {
        id: "filter",
        instructions:
          "Does this record satisfy the rule? Match the rule's intent, not just its keywords.",
        criteria: {
          include: "The record clearly falls inside the rule's scope",
          exclude: "The record clearly falls outside the rule's scope",
          rule_gap:
            "The record sits on a boundary the rule does not cover — suggest refining the rule itself instead of guessing per-record",
          needs_review: "Ambiguous — likely relevant but the rule's intent is not met cleanly",
        },
      },
    ],
    constraints: { requireFallbackOption: "needs_review", maxOptions: 6 },
    actions: {
      filter: {
        include: { kind: "record.filter", decision: "include" },
        exclude: { kind: "record.filter", decision: "exclude" },
        rule_gap: { kind: "record.filter", decision: "rule-gap" },
        needs_review: { kind: "review.request" },
      },
    },
    examples: {
      fixtures: [
        {
          name: "eu-enterprise-duplicate-charge",
          input: {
            rule: "Keep records about EU enterprise customers disputing a duplicate charge",
            record: {
              customer: "Acme GmbH",
              region: "eu",
              plan: "enterprise",
              note: "Customer reports being billed twice for the March invoice",
            },
          },
          expected: { filter: "include" },
        },
      ],
    },
  },

  {
    apiVersion: "yueli-dex-template/v1",
    id: "proactive-assist",
    version: "1.0.0",
    meta: {
      theme: "communication",
      scenario: "proactive-assist",
      useCase:
        "Per moment, decide whether to surface a suggestion now, stay silent, or only log it — meeting observation, instant hints, autocomplete, predictive launchers",
      utility:
        "Product success hinges on the disturbance rate: staying silent while the user is in flow beats a helpful but untimely interruption; every surfaced suggestion must be on-task and skippable in one glance",
      references: [
        "Industry direction #7: 实时交互辅助 (meeting observer, proactive suggestions, predictive launchers)",
        "Emoji-candidate / autocomplete ranking patterns",
      ],
      exampleInput: {
        moment: "user has been stuck on the same compile error for 6 minutes",
        userFocus: "debugging a TypeScript build",
        candidateSuggestion: "Offer the known fix for TS2355 in this codebase",
        consentLevel: "ambient",
      },
    },
    state: {
      from: {
        moment: "$.moment",
        userFocus: "$.userFocus",
        candidateSuggestion: "$.candidateSuggestion",
        consentLevel: "$.consentLevel",
      },
    },
    choices: [
      {
        id: "assist",
        instructions:
          "Should the assistant surface this suggestion now? The default posture is silence; interruption must earn its slot.",
        criteria: {
          offer_now:
            "User is blocked or paused AND the suggestion is squarely on-task — showing it now saves real time",
          stay_silent:
            "User is in flow, or the suggestion is only tangentially related — do not disturb",
          log_only:
            "Useful later but not now — record it for when the user asks or pauses",
          needs_review: "Cannot read the user's current state",
        },
      },
    ],
    constraints: { requireFallbackOption: "needs_review", maxOptions: 6 },
    actions: {
      assist: {
        offer_now: { kind: "assist.surface", mode: "offer-now" },
        stay_silent: { kind: "assist.surface", mode: "silent" },
        log_only: { kind: "assist.surface", mode: "log-only" },
        needs_review: { kind: "review.request" },
      },
    },
    examples: {
      fixtures: [
        {
          name: "blocked-user-on-task",
          input: {
            moment: "user has been stuck on the same compile error for 6 minutes",
            userFocus: "debugging a TypeScript build",
            candidateSuggestion: "Offer the known fix for TS2355 in this codebase",
            consentLevel: "ambient",
          },
          expected: { assist: "offer_now" },
        },
      ],
    },
  },

  {
    apiVersion: "yueli-dex-template/v1",
    id: "arxiv-benchmark-screen",
    version: "1.0.0",
    meta: {
      theme: "automation",
      scenario: "paper-screening",
      useCase:
        "From title and abstract alone, decide whether a paper proposes, releases, or systematically evaluates a benchmark / evaluation suite / leaderboard / competition, and classify its subtype",
      utility:
        "Literature-stream benchmark screening for LLM-as-annotator pipelines; a single 4+1 verdict eliminates the boolean/subtype label contradiction, the needs_review fallback keeps the labeled set clean, and every decision lands as a JSONL training sample (verdict + derived boolean + probabilities + decisionId)",
      references: [
        "Industry direction #6: 搜索与数据处理 (natural-language record filtering; same family as nl-record-filter)",
        "LLM-as-annotator labeling pipelines (5000-sample fine-tune data generation)",
      ],
      exampleInput: {
        title: "HELM: A Holistic Evaluation of Language Models",
        abstract:
          "We present HELM, a holistic evaluation framework for language models spanning numerous scenarios and metrics.",
        categories: ["cs.CL"],
      },
    },
    state: {
      from: {
        title: "$.title",
        abstract: "$.abstract",
        categories: "$.categories",
      },
    },
    choices: [
      {
        id: "verdict",
        instructions:
          "Judge from title and abstract alone. If the main contribution is a new model or method — even one reporting SOTA on existing benchmarks — it is NOT a benchmark paper.",
        criteria: {
          new_benchmark:
            "Main contribution is a new dataset, evaluation suite, test set, or evaluation protocol (HELM, BIG-bench, MMLU style)",
          new_leaderboard:
            "Main contribution is a leaderboard, competition, or continuous evaluation platform",
          eval_existing:
            "Systematic evaluation, comparison study, or meta-analysis of existing models/methods; proposes no new model",
          not_benchmark:
            "Main contribution is a new model, method, theory, or application; existing benchmarks are used only for validation",
          needs_review:
            "Title and abstract are insufficient to judge (missing abstract, ambiguous, or multiple co-equal contributions)",
        },
      },
    ],
    constraints: { requireFallbackOption: "needs_review", maxOptions: 8 },
    actions: {
      verdict: {
        new_benchmark: { kind: "paper.label", label: "benchmark.new" },
        new_leaderboard: { kind: "paper.label", label: "benchmark.leaderboard" },
        eval_existing: { kind: "paper.label", label: "benchmark.eval" },
        not_benchmark: { kind: "paper.label", label: "none" },
        needs_review: { kind: "review.request" },
      },
    },
    examples: {
      fixtures: [
        {
          name: "systematic-eval-framework",
          input: {
            title: "HELM: A Holistic Evaluation of Language Models",
            abstract:
              "We present HELM, a holistic evaluation framework for language models spanning numerous scenarios and metrics.",
            categories: ["cs.CL"],
          },
          expected: { verdict: "eval_existing" },
        },
        {
          name: "new-model-using-benchmarks",
          input: {
            title: "GPT-5: Scaling Language Models with Sparse Attention",
            abstract:
              "We introduce a new sparse attention mechanism reaching SOTA on MMLU and GSM8K.",
            categories: ["cs.LG"],
          },
          expected: { verdict: "not_benchmark" },
        },
      ],
    },
  },
];

export const TEMPLATES: readonly TemplateDefinition[] = templates;

/**
 * The installable `TemplatePack`. Feed it to `createDex({ templates: [TEMPLATES_CORE_PACK] })`
 * or `createTemplateRegistry([TEMPLATES_CORE_PACK])`.
 */
export const TEMPLATES_CORE_PACK: TemplatePack = {
  id: "yueli-dex/templates-core",
  version: "0.1.0",
  templates: templates as unknown as readonly JsonValue[],
};

import type { JsonValue } from "@haxitag/yueli-dex-plugin-sdk";

/**
 * Four-dimension labeling system for Yueli DEX templates.
 *
 * Derived from cross-analyzing the Jev ecosystem aggregators
 * (awesomejev.com — 802 entries, awesome-jev-projects — 448 verified repos /
 * 17 architecture categories / 20 topic tags) and TypeSafe's own docs.
 *
 * - theme (主题):     the business domain the decision lives in
 * - scenario (场景):  the concrete situation where the decision fires
 * - useCase (用例):   what the caller asks the decision to do
 * - utility (效用):   what it replaces or improves, with evidence
 */
export type ThemeLabel =
  | "customer-operations"
  | "communication"
  | "agent-infrastructure"
  | "developer-tooling"
  | "security"
  | "automation";

export type TemplateLabels = {
  readonly theme: ThemeLabel;
  readonly scenario: string;
  readonly useCase: string;
  readonly utility: string;
  /** Ecosystem evidence (source projects / aggregator categories) validating demand. */
  readonly references: string[];
  /** A representative input accepted by `TemplateRegistry.prepare()`. */
  readonly exampleInput: Record<string, JsonValue>;
};

export type TemplateCatalogEntry = {
  readonly id: string;
  readonly version: string;
  readonly theme: ThemeLabel;
  readonly scenario: string;
  readonly useCase: string;
  readonly utility: string;
  readonly references: readonly string[];
  /** P2-1: number of evaluation fixtures attached to the template. */
  readonly fixtureCount?: number;
};

export type TemplateFilter = {
  readonly theme?: ThemeLabel;
  readonly scenario?: string;
  readonly useCase?: string;
  readonly utility?: string;
};

/**
 * A `yueli-dex-template/v1` document plus a `meta` block carrying the
 * four-dimension labels. The compiler ignores `meta`; it exists for catalog
 * tooling, agent skills, and human review.
 */
export type TemplateDefinition = {
  readonly apiVersion: "yueli-dex-template/v1";
  readonly id: string;
  readonly version: string;
  readonly meta: TemplateLabels;
  readonly state?: { readonly from: Record<string, string> };
  readonly choices: readonly {
    readonly id: string;
    readonly instructions: string;
    readonly criteria: Record<string, string>;
  }[];
  readonly constraints?: {
    readonly requireFallbackOption?: string;
    readonly maxOptions?: number;
    readonly allowedActionKinds?: readonly string[];
  };
  readonly actions?: Readonly<Record<string, Readonly<Record<string, Record<string, JsonValue>>>>>;
  readonly modeling?: {
    readonly mode: "off" | "optional" | "required";
    readonly allow?: {
      readonly refineInstructions: boolean;
      readonly addCriteria: boolean;
      readonly changeActionKinds: boolean;
    };
    readonly requireEvidenceRefs?: boolean;
  };
  /** P2-1: optional evaluation fixtures. */
  readonly examples?: {
    readonly fixtures?: ReadonlyArray<{
      readonly name: string;
      readonly input: JsonValue;
      readonly expected?: Readonly<Record<string, unknown>>;
    }>;
  };
};

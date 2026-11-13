/**
 * Shared paths and text extractors for the shipped-prerequisite check
 * contract test (CodySwannGT/lisa#4761).
 * @module tests/unit/strategies/shipped-prerequisite-check-helpers
 */
import { readFileSync } from "node:fs";
import path from "node:path";

/** Every skill root a runtime reads: the source plus each projection. */
export const SKILL_ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
  "plugins/lisa-devin/skills",
  "plugins/lisa/.codex-plugin/skills",
] as const;

/** The three tracker validators that enforce S13. */
export const VALIDATORS = [
  "lisa-jira-validate-ticket",
  "lisa-github-validate-issue",
  "lisa-linear-validate-issue",
] as const;

/** Every checked-in copy of the definition-of-ready rule. */
export const READY_RULES = [
  "plugins/src/base/rules/reference/work-item-definition-of-ready.md",
  "plugins/lisa/rules/reference/work-item-definition-of-ready.md",
  "plugins/lisa-copilot/rules/reference/work-item-definition-of-ready.md",
  "plugins/lisa-devin/rules/reference/work-item-definition-of-ready.md",
  "plugins/lisa-cursor/rules/work-item-definition-of-ready-reference.mdc",
] as const;

export const CHECK_NAME = "shipped-prerequisite check";
const BLOCK_MARKER = "# shipped-prerequisite check";
/** The tri-state every copy of the gate must state. */
export const TRI_STATE = "anything else means the check failed";
/** A file the fixture remote ships on its default branch. */
export const PRESENT_FILE = "src/resolvers.ts";
/** Non-shipped paths below the root, each holding a symbol found nowhere else. */
export const NESTED_NOT_SHIPPED: readonly (readonly [string, string])[] = [
  ["pkg/api/tests/x.ts", "nestedTestsOnly"],
  ["pkg/api/docs/x.md", "nestedDocsOnly"],
  ["src/__tests__/x.ts", "dunderTestsOnly"],
  ["foo.test.ts", "rootTestFileOnly"],
  ["README.md", "readmeOnly"],
];
/** Nested shipped source: a hit here is present. */
export const NESTED_SHIPPED = ["pkg/api/src/x.ts", "nestedShipped"] as const;
/** A non-`main` default branch, so the lookup is really exercised. */
export const DEFAULT_BRANCH = "trunk";

/**
 * Read a repo-relative file.
 * @param relativePath - Path from the repository root
 * @returns File contents
 */
export const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

/**
 * The step 4 command block from a decomposition skill copy.
 * @param skill - The skill text
 * @returns The block's lines, or an empty list when absent
 */
export const commandBlock = (skill: string): readonly string[] =>
  (
    new RegExp(
      `\`\`\`bash\\n[ ]*(${BLOCK_MARKER}[\\s\\S]*?)\\n[ ]*\`\`\``
    ).exec(skill)?.[1] ?? ""
  )
    .split("\n")
    .map(line => line.trim())
    .filter(line => line !== "");

/**
 * Text of step 4 "Map Dependencies" in a decomposition skill copy.
 * @param skill - The skill text
 * @returns Step 4 up to step 4.5
 */
export const stepFour = (skill: string): string =>
  skill.split("### 4. Map Dependencies")[1]?.split("### 4.5.")[0] ?? "";

/**
 * Text of the S13 gate definition in a validator copy.
 * @param skill - The validator text
 * @returns S13 up to S14
 */
export const gateS13 = (skill: string): string =>
  skill.split("#### S13 — Relationship Search")[1]?.split("#### S14")[0] ?? "";

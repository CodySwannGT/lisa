/**
 * Every tracked file Lisa authors carries no suppression directive (#4929).
 *
 * The edit hooks stop an agent writing a new `eslint-disable` or `c8 ignore`,
 * but nothing in CI looked at what was already there, and an inventory run
 * with a pathspec that matched nothing reported a clean tree for months. This
 * test is that inventory, run on every unit pass: it lists the tracked files
 * the way `git ls-files` sees them, drops the same trees the PR inventory
 * drops (tests, docs, wiki, plans, evidence, and the generated `plugins/lisa*`
 * builds), and fails on any line naming a directive outside the files below.
 *
 * The files below are not exemptions. Each one names directives as data or
 * prose: the hooks that detect directives, the rules that explain them, and
 * the history that records their removal. Each entry pins the exact number of
 * matching lines, so a real directive added to one of these files still fails.
 * @module tests/unit/config/suppression-directive-inventory
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";

const repoRoot = process.cwd();

/** Every directive form that silences a type checker, linter, formatter or coverage tool. */
const DIRECTIVE =
  /eslint-disable|eslint-enable|@ts-ignore|@ts-expect-error|@ts-nocheck|istanbul ignore|[cv]8 ignore|NOSONAR|prettier-ignore|oxlint-disable|biome-ignore|noqa|rubocop:disable|shellcheck disable|Stryker disable|pragma: no cover|type: ignore|deno-lint-ignore|tslint:disable/u;

/** The trees the inventory leaves out, as `git ls-files` exclusion pathspecs. */
const EXCLUDED_TREES = [
  ":!tests",
  ":!**/*.test.*",
  ":!**/__tests__/**",
  ":!docs",
  ":!wiki",
  ":!plans",
  ":!evidence",
  ":!plugins/lisa*",
  ":!CHANGELOG.md",
] as const;

/**
 * Files whose matching lines are data or prose, with every matching line
 * pinned as text and why none of them is a directive. Pinning the text, not a
 * count, means a real directive cannot replace a prose line unseen. A `/` that
 * opens a comment is written `\u002f`, so this file holds no directive-shaped
 * comment of its own.
 */
const DATA_AND_PROSE: Readonly<
  Record<string, { lines: readonly string[]; why: string }>
> = {
  ".claude-pr/.claude/rules/PROJECT_RULES.md": {
    why: "rule prose describing directives",
    lines: [
      "All `eslint-disable` directives must include a description to satisfy the `eslint-comments/require-description` rule.",
      "Format: `\u002f* eslint-disable rule-name -- description of why this exception is needed */`",
      "\u002f* eslint-disable functional/no-let -- generator requires mutable pair to track consecutive Fibonacci values */",
      "\u002f* eslint-enable functional/no-let -- re-enable after generator state declaration */",
    ],
  },
  ".claude/hookify.block-suppression-directives.local.md": {
    why: "the hookify rule that blocks directives",
    lines: [
      'pattern: "(\u002f\u002f|/\\\\*)\\\\s*(@ts-(ignore|nocheck)|eslint-disable|biome-ignore|prettier-ignore)"',
      "You're adding a `@ts-ignore`, `@ts-nocheck`, or `eslint-disable` directive. These silence the type checker or linter instead of fixing the underlying problem, which is not allowed unless there is genuinely no other way around it.",
      "- Prefer `@ts-expect-error` over `@ts-ignore` (it fails if the error ever goes away).",
      "- Scope `eslint-disable` to a single line and a single rule (`eslint-disable-next-line <rule>`), never a whole file.",
    ],
  },
  ".lisa/plan-1539.md": {
    why: "a recorded plan's prose",
    lines: [
      '  "relevant_documentation": "src/cli/ui-status.ts (StatusProbe contract, runProbe, readStatusSnapshot); src/cli/ui-status-json.ts (ProbeResult tri-state); src/cli/ui-cmd.ts:298-336 (runUi, default probes [createGithubAuthProbe], /api/status handler); src/detection/index.ts:43-76 (detectAll, expandAndOrderTypes); src/cli/doctor.ts:136-149 (identical call chain — agreement AC holds by construction); ui/index.html:2006-2145 (DATA.sections.stacks catalog), 5613-5651 (buildStacks), 6000-6117 (live-status hydration + boot); tests/e2e/ui-live-status.spec.ts (existing probe-injection e2e pattern); PROJECT_RULES: enforce-statement-order, eslint-disable descriptions, plugins/src vs generated artifacts (ui/index.html is NOT a generated plugin artifact)",',
    ],
  },
  ".lisa/task-results/T14.json": {
    why: "a recorded task result's note",
    lines: [
      '      "note": "The block-suppress-directives hook rejects any eslint-disable, including one-line no-bitwise ones. Test permission bits with arithmetic: mode % 0o100 is the group and other bits.",',
    ],
  },
  "all/copy-overwrite/scripts/lisa-gates.mjs": {
    why: "the grep a gate runs to detect directives",
    lines: [
      "    \"grep -E '(\u002f\u002f|/\\\\*) *(@ts-ignore|@ts-nocheck|eslint-disable|biome-ignore|prettier-ignore)' <proposed-text>\"",
      "    \"grep -E '(\u002f\u002f|/\\\\*) *(@ts-ignore|@ts-nocheck|eslint-disable|biome-ignore|prettier-ignore)' <added-lines>\"",
    ],
  },
  "eslint-plugin-component-structure/README.md": {
    why: "README prose",
    lines: [
      "\u002f* eslint-disable component-structure/single-component-per-file --",
    ],
  },
  "plugins/src/base/rules/reference/base-rules.md": {
    why: "rule prose",
    lines: [
      "- A lint, formatter, or type-check suppression (e.g. eslint-disable, biome-ignore, noqa, ts-expect-error, type: ignore) is a last resort. Use one only when the code is correct and the tool is wrong, scope it to the narrowest line or rule, and write the reason on the same line. Include matching re-enable comments where applicable.",
    ],
  },
  "plugins/src/base/rules/reference/coding-philosophy.md": {
    why: "rule prose",
    lines: [
      "- Never silence a check: no `@ts-ignore`, `eslint-disable`, `any`, loosened compiler or linter config, lowered coverage thresholds, or skipped tests to get green",
    ],
  },
  "plugins/src/base/skills/lisa-parity-code-review/SKILL.md": {
    why: "skill prose",
    lines: [
      "A suppression silences only the lint or type finding it names. It never hides a correctness or security defect in that code. A changed `eval(req.body.code)` under `eslint-disable no-eval` is still remote code execution, so report it as Critical.",
    ],
  },
  "plugins/src/typescript/hooks/block-suppress-directives.sh": {
    why: "the hook that detects directives: its pattern and message",
    lines: [
      "# suppression directive. @ts-expect-error is intentionally NOT matched — it is",
      "DIRECTIVE_RE='(\u002f\u002f|/\\*)[[:space:]]*(@ts-(ignore|nocheck)|eslint-disable|biome-ignore|prettier-ignore)'",
      "You are adding a @ts-ignore / @ts-nocheck / eslint-disable / biome-ignore /",
      "prettier-ignore comment. These silence the type checker, linter, or formatter",
      "  - Prefer @ts-expect-error over @ts-ignore (it fails once the error is gone).",
    ],
  },
  "projects/archive/2026-01-28-tagged-merge/tasks/15-type-safety-linting.md": {
    why: "an archived task's prose",
    lines: ["5. Verify no ts-ignore or eslint-disable comments needed"],
  },
  "src/codex/scripts/block-suppress-directives.sh": {
    why: "the Codex hook that detects directives: its pattern and message",
    lines: [
      "# Blocks adding error-suppression directives (@ts-ignore, @ts-nocheck,",
      "# eslint-disable, biome-ignore, prettier-ignore) to JS/TS source. Suppressing",
      "# @ts-expect-error is intentionally NOT matched — it is the safer alternative.",
      "DIRECTIVE_RE='(\u002f\u002f|/\\*)[[:space:]]*(@ts-(ignore|nocheck)|eslint-disable|biome-ignore|prettier-ignore)'",
      "@ts-ignore / @ts-nocheck / eslint-disable / biome-ignore / prettier-ignore",
      "the user's approval first, prefer @ts-expect-error over @ts-ignore, scope the",
    ],
  },
  "src/configs/eslint/slow-expo.ts": {
    why: "doc comments explaining react-hooks/rule-suppression",
    lines: [
      " * - react-hooks/rule-suppression - eslint-disable of a React hooks rule",
      " * `eslint-disable` of `react-hooks/exhaustive-deps` or",
      " * Compiler options that make `react-hooks/rule-suppression` see eslint-disable",
    ],
  },
  "src/configs/eslint/slow.ts": {
    why: "a comment explaining why inline directives are not reported",
    lines: [
      "        \u002f\u002f Ignore inline eslint-disable comments since they reference rules",
    ],
  },
  "src/opencode/plugin-templates/lisa-block-suppress-directives.ts": {
    why: "the OpenCode plugin that detects directives: its pattern and message",
    lines: [
      " * Blocks adding error-suppression directives (@ts-ignore, @ts-nocheck,",
      " * eslint-disable, biome-ignore, prettier-ignore) to JS/TS source. Suppressing",
      " * underlying error. @ts-expect-error is intentionally NOT matched (it is the",
      "    /(\\/\\/|\\/\\*)\\s*(@ts-(ignore|nocheck)|eslint-disable|biome-ignore|prettier-ignore).*/g;",
      '        "@ts-ignore / @ts-nocheck / eslint-disable / biome-ignore / prettier-ignore",',
      '        "the user\'s approval first, prefer @ts-expect-error over @ts-ignore, scope the",',
    ],
  },
};

/**
 * Lists the tracked files the inventory covers.
 * @returns Repository-relative paths
 */
function inventoriedFiles(): readonly string[] {
  const listing = boundedExecFileSync({
    label: "git ls-files for the suppression-directive inventory",
    command: "git",
    args: ["ls-files", "-z", "--", ".", ...EXCLUDED_TREES],
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return String(listing)
    .split("\0")
    .filter(file => file.length > 0);
}

/**
 * Lists the lines in each file that name a directive.
 * @param files - Repository-relative paths
 * @returns Path to matching lines, for files with at least one match
 */
function directiveLines(
  files: readonly string[]
): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(
    files
      .map(file => {
        const text = readFileSync(path.join(repoRoot, file), "utf8");
        return [
          file,
          text.split("\n").filter(line => DIRECTIVE.test(line)),
        ] as const;
      })
      .filter(([, lines]) => lines.length > 0)
  );
}

describe("the suppression-directive inventory", () => {
  it("finds no directive outside the data and prose files", () => {
    const expected = Object.fromEntries(
      Object.entries(DATA_AND_PROSE).map(([file, { lines }]) => [file, lines])
    );

    expect(directiveLines(inventoriedFiles())).toEqual(expected);
  });

  it("sees the shipped copy-overwrite scripts, which a bare directory pathspec missed", () => {
    const files = inventoriedFiles();

    expect(files).toContain("all/copy-overwrite/scripts/lisa-gates.mjs");
    expect(files).toContain("all/copy-overwrite/scripts/lib/push-timing.mjs");
    expect(files).toContain("expo/copy-overwrite/jest.setup.ts");
  });

  it("detects each directive form it claims to", () => {
    // Each form is assembled from its comment marker and its body, so this
    // file never holds a directive-shaped comment the edit hooks would stop.
    const forms = [
      ["//", "eslint-disable-next-line no-console"],
      ["/*", "eslint-disable max-lines */"],
      ["//", "@ts-ignore"],
      ["//", "@ts-expect-error"],
      ["//", "@ts-nocheck"],
      ["/*", "istanbul ignore next */"],
      ["/*", "c8 ignore start */"],
      ["/*", "v8 ignore next */"],
      ["//", "NOSONAR"],
      ["//", "prettier-ignore"],
      ["//", "oxlint-disable-next-line"],
      ["//", "biome-ignore lint: x"],
      ["x = 1  #", "noqa: E501"],
      ["x #", "rubocop:disable Style/Foo"],
      ["#", "shellcheck disable=SC2086"],
      ["//", "Stryker disable next-line all"],
      ["x = 1  #", "pragma: no cover"],
      ["x = f()  #", "type: ignore"],
      ["//", "deno-lint-ignore no-explicit-any"],
      ["//", "tslint:disable-next-line"],
    ].map(([marker, body]) => `${marker} ${body}`);

    expect(forms.filter(form => !DIRECTIVE.test(form))).toEqual([]);
  });
});

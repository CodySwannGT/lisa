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
 * Files whose matching lines are data or prose, with the exact number of
 * matching lines each one holds and why none of them is a directive.
 */
const DATA_AND_PROSE: Readonly<Record<string, { lines: number; why: string }>> =
  {
    ".claude-pr/.claude/rules/PROJECT_RULES.md": {
      lines: 4,
      why: "rule prose describing directives",
    },
    ".claude/hookify.block-suppression-directives.local.md": {
      lines: 4,
      why: "the hookify rule that blocks directives",
    },
    ".lisa/plan-1539.md": { lines: 1, why: "a recorded plan's prose" },
    ".lisa/task-results/T14.json": {
      lines: 1,
      why: "a recorded task result's note",
    },
    "all/copy-overwrite/scripts/lisa-gates.mjs": {
      lines: 2,
      why: "the grep a gate runs to detect directives",
    },
    "eslint-plugin-component-structure/README.md": {
      lines: 1,
      why: "README prose",
    },
    "plugins/src/base/rules/reference/base-rules.md": {
      lines: 1,
      why: "rule prose",
    },
    "plugins/src/base/rules/reference/coding-philosophy.md": {
      lines: 1,
      why: "rule prose",
    },
    "plugins/src/base/skills/lisa-parity-code-review/SKILL.md": {
      lines: 1,
      why: "skill prose",
    },
    "plugins/src/typescript/hooks/block-suppress-directives.sh": {
      lines: 5,
      why: "the hook that detects directives: its pattern and message",
    },
    "projects/archive/2026-01-28-tagged-merge/tasks/15-type-safety-linting.md":
      { lines: 1, why: "an archived task's prose" },
    "src/codex/scripts/block-suppress-directives.sh": {
      lines: 6,
      why: "the Codex hook that detects directives: its pattern and message",
    },
    "src/configs/eslint/slow-expo.ts": {
      lines: 3,
      why: "doc comments explaining react-hooks/rule-suppression",
    },
    "src/configs/eslint/slow.ts": {
      lines: 1,
      why: "a comment explaining why inline directives are not reported",
    },
    "src/opencode/plugin-templates/lisa-block-suppress-directives.ts": {
      lines: 6,
      why: "the OpenCode plugin that detects directives: its pattern and message",
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
 * Counts the lines in each file that name a directive.
 * @param files - Repository-relative paths
 * @returns Path to matching-line count, for files with at least one match
 */
function directiveLineCounts(
  files: readonly string[]
): Readonly<Record<string, number>> {
  return Object.fromEntries(
    files
      .map(file => {
        const text = readFileSync(path.join(repoRoot, file), "utf8");
        return [
          file,
          text.split("\n").filter(line => DIRECTIVE.test(line)).length,
        ] as const;
      })
      .filter(([, count]) => count > 0)
  );
}

describe("the suppression-directive inventory", () => {
  it("finds no directive outside the data and prose files", () => {
    const expected = Object.fromEntries(
      Object.entries(DATA_AND_PROSE).map(([file, { lines }]) => [file, lines])
    );

    expect(directiveLineCounts(inventoriedFiles())).toEqual(expected);
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

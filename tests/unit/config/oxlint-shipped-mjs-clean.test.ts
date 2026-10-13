/**
 * Proof that every `.mjs` file Lisa INSTALLS into a consumer passes the oxlint
 * preset Lisa installs alongside it.
 *
 * The ESLint sibling (`eslint-shipped-mjs-clean.test.ts`) holds the payload to
 * the shipped ESLint config. A host's pre-commit runs oxlint first, though, and
 * against a different ruleset: `oxlint/typescript.json` enables the `jsdoc`
 * plugin, whose correctness category carries `require-yields`. Nothing held the
 * payload to that preset, so a shipped generator without `@yields` refused the
 * first commit of every TypeScript host that updated (CodySwannGT/lisa#4450).
 * The host cannot fix it: editing a managed file forks it from upstream.
 *
 * Lisa's own `oxlint` cannot catch this either, for the reason the ESLint
 * sibling records: the template trees are payload, not this repo's source, so
 * this test is the enforcement surface. Only error-severity findings fail it —
 * that is exactly what a host's `oxlint` exits non-zero on.
 *
 * The roster is the shared index-backed one, so an untracked scratch file in a
 * shipped tree cannot block someone else's push (CodySwannGT/lisa#2824).
 */
import { spawnSync } from "node:child_process";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { ioLatencyBudgetMs } from "../../helpers/io-latency-budget.js";
import { shippedMjsRoster } from "../../helpers/shipped-mjs-roster.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** The preset a TypeScript host's `.oxlintrc.json` extends. */
const HOST_PRESET = path.join(REPO_ROOT, "oxlint", "typescript.json");

const OXLINT_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "oxlint");

/** Calibrated, not fixed: a subprocess's wall clock measures the machine. */
const LINT_TIMEOUT_MS = ioLatencyBudgetMs(60_000);

/**
 * One oxlint diagnostic, reduced to what the assertion reports.
 */
interface OxlintDiagnostic {
  readonly code: string;
  readonly severity: string;
  readonly filename: string;
  readonly labels?: readonly { readonly span?: { readonly line?: number } }[];
}

/**
 * Lint files with the host preset and return the error-severity findings.
 * @param files - Repo-relative paths to lint
 * @returns One `path:line rule` line per error
 */
function presetErrors(files: readonly string[]): readonly string[] {
  const result = spawnSync(
    OXLINT_BIN,
    ["-c", HOST_PRESET, "--format", "json", ...files],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: LINT_TIMEOUT_MS,
    }
  );
  if (result.error) throw result.error;
  // A killed child returns empty streams; say so instead of failing to parse.
  if (result.signal !== null)
    throw new Error(`oxlint was killed by ${result.signal} before reporting`);
  const parsed = JSON.parse(result.stdout) as {
    readonly diagnostics: readonly OxlintDiagnostic[];
  };
  return parsed.diagnostics
    .filter(diagnostic => diagnostic.severity === "error")
    .map(
      diagnostic =>
        `${diagnostic.filename}:${diagnostic.labels?.[0]?.span?.line ?? "?"} ${diagnostic.code}`
    );
}

describe("shipped .mjs payload passes the host oxlint preset", () => {
  const { tracked } = shippedMjsRoster(REPO_ROOT);

  it("finds the shipped payload at all", () => {
    // Every assertion below is derived from this list; an empty roster would
    // pass by linting nothing.
    expect(tracked.length).toBeGreaterThanOrEqual(100);
  });

  it(
    "reports no error-severity finding in any shipped script",
    () => {
      expect(presetErrors(tracked)).toEqual([]);
    },
    LINT_TIMEOUT_MS
  );
});

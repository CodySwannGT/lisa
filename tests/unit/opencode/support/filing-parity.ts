/**
 * The two implementations of the ready-role filing guard, driven side by side.
 *
 * Extracted from `block-direct-issue-create-cross-repo-parity.test.ts` when
 * CodySwannGT/lisa#3885 added the syntax-check cases and put that file over the
 * 300-line budget. Shared rather than copied on purpose: a parity harness that
 * exists twice is the same defect the suites using it are built to catch.
 *
 * Every OpenCode case is evaluated in ONE Bun process. Spawning a runtime per
 * case cost ~10s each and put the file over the pre-push 60s per-test budget,
 * which fails the push as a test-correctness error rather than a slow test.
 * The plugin snapshots config at init from the process cwd, so each case
 * chdirs and re-imports the template with a cache-busting query.
 * @module tests/unit/opencode/support/filing-parity
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect } from "vitest";

import { boundedSpawnSync } from "../../../helpers/io-latency-budget.js";

const HOOK_PATH = path.resolve(
  "plugins/src/base/hooks/block-direct-issue-create.sh"
);
const PLUGIN_PATH = path.resolve(
  "src/opencode/plugin-templates/lisa-block-direct-issue-create.ts"
);
const BUN_PATH = boundedSpawnSync({
  label: "which bun",
  command: "/usr/bin/which",
  args: ["bun"],
}).stdout.trim();

/**
 * A throwaway project directory carrying a Lisa config.
 * @param config - The config to write.
 * @param files - Extra fixture files to write, keyed by name.
 * @returns The directory path.
 */
export const project = (
  config: Record<string, unknown>,
  files: Readonly<Record<string, string>> = {}
): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-issue-parity-"));
  writeFileSync(
    path.join(dir, ".lisa.config.json"),
    JSON.stringify(config),
    "utf-8"
  );
  for (const [name, body] of Object.entries(files))
    writeFileSync(path.join(dir, name), body, "utf-8");
  return dir;
};

/**
 * The bash guard's verdict.
 * @param command - The intercepted shell command.
 * @param cwd - The project directory.
 * @returns "allow" or "deny".
 */
export const bashVerdict = (command: string, cwd: string): string => {
  const result = boundedSpawnSync({
    label: "the block-direct-issue-create bash guard",
    command: "/bin/bash",
    args: [HOOK_PATH],
    cwd,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: "",
      LISA_ALLOW_DIRECT_ISSUE_CREATE: "",
    },
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
  });
  return result.status === 2 ? "deny" : "allow";
};

/**
 * Every OpenCode verdict, from a single Bun process.
 * @param cases - The directory and command for each case, in order.
 * @returns One "allow" / "deny" per case, in the same order.
 */
export const opencodeVerdicts = (
  cases: readonly { readonly dir: string; readonly command: string }[]
): readonly string[] => {
  const program = `
    const cases = JSON.parse(process.env.TEST_CASES);
    const verdicts = [];
    for (const [index, item] of cases.entries()) {
      process.chdir(item.dir);
      const imported = await import(process.env.PLUGIN_URL + "?case=" + index);
      const plugin = await imported.LisaBlockDirectIssueCreate();
      try {
        await plugin["tool.execute.before"](
          { tool: "bash" },
          { args: { command: item.command } }
        );
        verdicts.push("allow");
      } catch {
        verdicts.push("deny");
      }
    }
    console.log(JSON.stringify(verdicts));
  `;
  const result = boundedSpawnSync({
    label: "bun evaluating every OpenCode plugin case",
    command: BUN_PATH,
    args: ["-e", program],
    baseMs: 30_000,
    env: {
      ...process.env,
      PLUGIN_URL: `file://${PLUGIN_PATH}`,
      TEST_CASES: JSON.stringify(cases),
      LISA_ALLOW_DIRECT_ISSUE_CREATE: "",
    },
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.trim()) as readonly string[];
};

/** The upstream repository every caller in these fixtures files into. */
export const UPSTREAM_REPO = "up-org/up-repo";

/** A Linear-tracked caller, whose ready role is also a workflow state. */
export const LINEAR_CALLER = {
  tracker: "linear",
  linear: { workflow: { ready: "Ready" } },
  hardening: { upstreamRepo: UPSTREAM_REPO },
};

/** The GraphQL body a hand-rolled Linear creation submits. */
export const LINEAR_MUTATION =
  '{"query":"mutation{issueCreate(input:{title:\\"x\\"}){success}}"}';

/** A script that files a Linear issue and declares nothing about it. */
export const UNDECLARED_SCRIPT = [
  "#!/usr/bin/env bash",
  "curl -sS -X POST https://api.linear.app/graphql \\",
  `  -d '${LINEAR_MUTATION}'`,
  "",
].join("\n");

/** One command, its project config, and the verdict both guards must reach. */
export interface ParityCase {
  readonly label: string;
  readonly config: Record<string, unknown>;
  readonly command: string;
  readonly expected: string;
  /** Files written into the project directory before the case runs. */
  readonly files?: Readonly<Record<string, string>>;
  /** Command with `{dir}` replaced by the project directory. */
  readonly template?: string;
}

/**
 * Shared fixtures for the `block-direct-issue-create.sh` suites.
 *
 * Extracted rather than copied because the guard's tests are split across
 * three files — classification, declarations, and missing interpreters — and a
 * per-file copy of `runHook` is exactly how two of them would quietly drift
 * onto different environments and stop testing the same guard.
 *
 * Not named `*.test.ts`, so vitest collects nothing from it.
 * @module tests/unit/hooks/support/direct-issue-create
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { boundedSpawnSync } from "../../../helpers/io-latency-budget.js";

/** The guard under test, as it lives in the plugin source. */
export const SCRIPT_PATH = path.resolve(
  "plugins/src/base/hooks/block-direct-issue-create.sh"
);
export const BASH_PATH = "/bin/bash";

/** Claude's refusal code. Anything else lets the command through. */
export const EXIT_BLOCKED = 2;
export const EXIT_ALLOWED = 0;

/** The one command shape the audit found filed 13 times out of 13. */
export const UNDECLARED_CREATE = 'gh issue create --title "x"';
/** The marker a deliberate human gate stamps on the item. */
export const GATE_MARKER = "<!-- [lisa-human-gate] reason=pricing -->";
/** A non-default build-ready role, to prove the guard reads it from config. */
export const CUSTOM_ROLE = "state:queued";
/**
 * The canonical container declaration, verbatim.
 *
 * Defined once by the `derived-branch-plan` rule as the Target Backend
 * Environment value that marks a container, and stamped by
 * `lisa-github-write-issue` on every container it writes. The guard reads that
 * one string rather than a declared `type:Epic`, so there is nothing here for
 * the guard, the rule and the writer to drift apart on.
 */
export const CONTAINER_DECLARATION =
  "None — container: state rolls up from children";

/** The default config: a GitHub tracker with the stock build-ready label. */
export const DEFAULT_CONFIG: Record<string, unknown> = {
  tracker: "github",
  github: { labels: { build: { ready: "status:ready" } } },
};

/**
 * A throwaway project directory whose `.lisa.config.json` configures a tracker.
 * @param config - The Lisa config to write.
 * @returns The directory path.
 */
export const projectWithTracker = (
  config: Record<string, unknown> = DEFAULT_CONFIG
): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-issue-guard-"));
  writeFileSync(
    path.join(dir, ".lisa.config.json"),
    JSON.stringify(config),
    "utf-8"
  );
  return dir;
};

/**
 * A project directory with no Lisa config at all — the bootstrapping case.
 * @returns The directory path.
 */
export const projectWithoutTracker = (): string =>
  mkdtempSync(path.join(tmpdir(), "lisa-issue-guard-bare-"));

/**
 * Run the guard against a PreToolUse payload.
 * @param payload - The JSON given on stdin.
 * @param options - Overrides for the run.
 * @param options.cwd - The project directory the guard resolves config from.
 * @param options.env - Environment entries layered over the process env.
 * @returns Exit status and stderr.
 */
export const runHook = (
  payload: unknown,
  options: { cwd?: string; env?: Readonly<Record<string, string>> } = {}
): { status: number | null; stderr: string } => {
  const result = boundedSpawnSync({
    label: "block-direct-issue-create.sh",
    command: BASH_PATH,
    args: [SCRIPT_PATH],
    cwd: options.cwd ?? projectWithTracker(),
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: "",
      LISA_ALLOW_DIRECT_ISSUE_CREATE: "",
      ...options.env,
    },
    input: JSON.stringify(payload),
  });
  return { status: result.status, stderr: result.stderr };
};

/**
 * A PreToolUse Bash payload.
 * @param command - The shell command the agent is attempting.
 * @returns The payload object.
 */
export const bash = (command: string) => ({
  tool_name: "Bash",
  tool_input: { command },
});

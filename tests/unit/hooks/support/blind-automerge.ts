/**
 * Shared fixtures for the `block-blind-automerge.sh` suites.
 *
 * The guard asks GitHub a question, so every case here supplies a fake `gh` on
 * PATH. That is the whole point of the fixture: the discriminating case for
 * this defect is a PR with ZERO failing checks and a `CHANGES_REQUESTED`
 * review, which no amount of check-run data can produce and no real repository
 * can be relied on to hold still.
 *
 * Not named `*.test.ts`, so vitest collects nothing from it.
 * @module tests/unit/hooks/support/blind-automerge
 */
import { chmodSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { boundedSpawnSync } from "../../../helpers/io-latency-budget.js";

/** The guard under test, as it lives in the plugin source. */
export const SCRIPT_PATH = path.resolve(
  "plugins/src/base/hooks/block-blind-automerge.sh"
);
export const BASH_PATH = "/bin/bash";

/** Claude's refusal code. Anything else lets the command through. */
export const EXIT_BLOCKED = 2;
export const EXIT_ALLOWED = 0;

/** The PR every fixture below describes, as GitHub names it. */
export const PR_URL = "https://github.com/o/r/pull/3720";

/** The arming command every caller in the fleet runs. */
export const ARM = "gh pr merge 3720 --auto --merge";

/**
 * The PR shape that made this defect invisible: every check green, no failing
 * check to count, and a review verdict that blocks the merge forever.
 */
export const BLOCKED_PR = {
  number: 3720,
  reviewDecision: "CHANGES_REQUESTED",
  state: "OPEN",
  url: PR_URL,
  statusCheckRollup: [
    { name: "quality checks", conclusion: "SUCCESS" },
    { context: "CodeRabbit", state: "SUCCESS" },
  ],
};

/**
 * A PR that cannot merge for a reason this guard deliberately does not police.
 *
 * Measured on a PR opened against a base where reviews are disabled: the review
 * bot reports `success` with a description saying the review was skipped, and
 * the repository's two review-evidence gates fail. It looks like this ticket and
 * is not it — the failing-check count is 2, so every check-based signal reports
 * it correctly. Only that one bot's conclusion misleads, and this guard reads no
 * conclusions at all. Kept as a boundary case so the scope reads as decided.
 */
export const REVIEW_SKIPPED_PR = {
  number: 3720,
  reviewDecision: null,
  state: "OPEN",
  url: PR_URL,
  statusCheckRollup: [
    {
      context: "CodeRabbit",
      state: "SUCCESS",
      description: "Review skipped: reviews are disabled for this base branch",
    },
    {
      name: "Did the required review checks do any work?",
      conclusion: "FAILURE",
    },
    { name: "Review evidence verdict", conclusion: "FAILURE" },
  ],
};

/** The same PR once the blocker clears. `reviewDecision` is then absent. */
export const READY_PR = {
  number: 3720,
  reviewDecision: null,
  state: "OPEN",
  url: PR_URL,
  statusCheckRollup: BLOCKED_PR.statusCheckRollup,
};

/** How a fake `gh` should behave for one case. */
export type GhBehavior = {
  /** JSON printed on stdout. Ignored when `exitCode` is non-zero. */
  readonly payload?: unknown;
  /** Raw stdout, for the malformed-response cases. */
  readonly rawStdout?: string;
  /** Exit status the fake returns. */
  readonly exitCode?: number;
};

/** Where a fake `gh` records the arguments it was called with. */
const CALL_LOG = "gh-calls.log";

/**
 * A PATH entry holding a fake `gh` that answers with a fixed payload.
 * @param behavior - What the fake should print and return.
 * @returns The bin directory and the path of its call log.
 */
export const fakeGh = (
  behavior: GhBehavior
): { bin: string; callLog: string } => {
  const bin = mkdtempSync(path.join(tmpdir(), "lisa-automerge-gh-"));
  const callLog = path.join(bin, CALL_LOG);
  const stdout =
    behavior.rawStdout ?? JSON.stringify(behavior.payload ?? READY_PR);
  const script = [
    "#!/usr/bin/env bash",
    `printf '%s\\n' "$*" >> ${JSON.stringify(callLog)}`,
    `printf '%s' ${JSON.stringify(stdout)}`,
    `exit ${behavior.exitCode ?? 0}`,
    "",
  ].join("\n");
  const ghPath = path.join(bin, "gh");
  writeFileSync(ghPath, script, "utf-8");
  chmodSync(ghPath, 0o755);
  return { bin, callLog };
};

/**
 * A PATH holding exactly the named tools and nothing else.
 *
 * Built by symlinking real binaries into a fresh directory rather than by
 * trimming the ambient PATH, because the ambient one cannot be trimmed
 * reliably in either direction: `gh` lives in `/usr/bin` on a GitHub runner
 * and in `/opt/homebrew/bin` here, so "PATH minus the brew dir" still finds it
 * in CI, and `jq` lives in `/usr/bin` in CI but not here, so the same
 * subtraction removes different tools on different machines. Naming the whole
 * set makes each degrade path — no gh, no jq — reachable on its own terms
 * instead of by accident.
 * @param tools - Executables to make available, resolved from the live PATH.
 * @returns A PATH value containing only those tools.
 */
export const pathWith = (tools: readonly string[]): string => {
  const bin = mkdtempSync(path.join(tmpdir(), "lisa-automerge-path-"));
  for (const tool of tools) {
    const resolved = boundedSpawnSync({
      label: `which ${tool}`,
      command: "/usr/bin/env",
      args: ["which", tool],
    }).stdout.trim();
    if (resolved) symlinkSync(resolved, path.join(bin, tool));
  }
  return bin;
};

/** Everything the guard needs to run, except the `gh` it must ask. */
export const TOOLS_WITHOUT_GH = ["cat", "jq", "python3"] as const;

/** Everything except `jq`, which the guard parses its own stdin with. */
export const TOOLS_WITHOUT_JQ = ["cat", "python3"] as const;

/**
 * Run the guard against a PreToolUse payload.
 * @param payload - The JSON given on stdin.
 * @param options - Overrides for the run.
 * @param options.ghBin - A directory prepended to PATH, normally a fake gh.
 * @param options.path - A complete PATH replacement, for the absent-tool cases.
 * @returns Exit status and stderr.
 */
export const runHook = (
  payload: unknown,
  options: { ghBin?: string; path?: string } = {}
): { status: number | null; stderr: string } => {
  const resolvedPath =
    options.path ??
    (options.ghBin
      ? `${options.ghBin}:${process.env["PATH"] ?? ""}`
      : (process.env["PATH"] ?? ""));
  const result = boundedSpawnSync({
    label: "block-blind-automerge.sh",
    command: BASH_PATH,
    args: [SCRIPT_PATH],
    env: { ...process.env, PATH: resolvedPath },
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

/**
 * The branch rules GitHub returns for a ref two rulesets cover.
 *
 * Trimmed from the live response for this repository's default branch, which
 * carries fifteen required contexts across two rulesets. Two are enough to pin
 * the property; the shape — `parameters.required_status_checks[].context` — is
 * verbatim, because that nesting is the only thing separating a ref with gates
 * from a ref without them.
 */
export const COVERED_RULES = [
  { ruleset_id: 11912821, type: "deletion" },
  { ruleset_id: 11912821, type: "non_fast_forward" },
  { ruleset_id: 11912821, type: "pull_request" },
  {
    ruleset_id: 18805189,
    type: "required_status_checks",
    parameters: {
      required_status_checks: [
        { context: "🔍 Quality Checks / 🔗 Work-Item Traceability" },
        { context: "🧩 Plugin artifacts match source" },
      ],
      strict_required_status_checks_policy: false,
    },
  },
];

/**
 * What GitHub returns for a ref no ruleset covers — a stack base, or any
 * ordinary feature branch. Read live for `stack/queue-drain-20260904-b`: `[]`.
 */
export const UNCOVERED_RULES: readonly unknown[] = [];

/**
 * A `required_status_checks` rule that enforces nothing.
 *
 * A guard counting RULES rather than CONTEXTS reports this ref as protected.
 * Nothing in it can block a merge.
 */
export const VACUOUS_RULES = [
  {
    ruleset_id: 1,
    type: "required_status_checks",
    parameters: { required_status_checks: [] },
  },
];

/** The stack base every fixture below batches onto. */
export const STACK_BASE = "stack/queue-drain-20260904-b";

/** A wholly green PR sitting on a stack base — nothing red, nothing enforced. */
export const STACK_BASED_PR = {
  number: 3922,
  reviewDecision: null,
  state: "OPEN",
  url: "https://github.com/o/r/pull/3922",
  baseRefName: STACK_BASE,
  statusCheckRollup: [{ name: "quality checks", conclusion: "SUCCESS" }],
};

/** The same PR on the default branch, where the rulesets do apply. */
export const COVERED_PR = { ...STACK_BASED_PR, baseRefName: "main" };

/**
 * The PR as CodySwannGT/lisa#3922 measured it: on a covered base, blocked by
 * two genuinely failing REQUIRED checks, one of which arrives as a check-run
 * and one as a commit status — so a guard reading only one shape reports it
 * clean.
 */
export const CHECK_BLOCKED_PR = {
  number: 3922,
  reviewDecision: null,
  state: "OPEN",
  url: "https://github.com/o/r/pull/3922",
  baseRefName: "main",
  statusCheckRollup: [
    {
      name: "🔍 Quality Checks / 🔗 Work-Item Traceability",
      conclusion: "FAILURE",
    },
    { context: "🧩 Plugin artifacts match source", state: "ERROR" },
    { name: "🔍 Quality Checks / 🧹 Lint", conclusion: "SUCCESS" },
  ],
};

/** The arming and re-targeting commands the fleet actually runs. */
export const RETARGET = `gh pr edit 3922 --base ${STACK_BASE}`;

/**
 * A fake `gh` that answers the PR question and the ruleset question separately.
 *
 * One fixed payload cannot express this defect: the whole point is that the
 * pull request reads exactly the same whether its base has fifteen required
 * checks or none, and only a SECOND question — asked of a different endpoint —
 * tells them apart. A fake that returned one body would make the two cases
 * indistinguishable in the suite as well as in production.
 * @param answers - What each endpoint should return.
 * @param answers.pr - The pull-request payload for `pr view` / `api graphql`.
 * @param answers.rules - The rules payload for `rules/branches/<ref>`.
 * @param answers.rulesExitCode - Exit status for the rules call only.
 * @returns The bin directory and the path of its call log.
 */
export const routingGh = (answers: {
  readonly pr?: unknown;
  readonly rules?: unknown;
  readonly rulesExitCode?: number;
}): { bin: string; callLog: string } => {
  const bin = mkdtempSync(path.join(tmpdir(), "lisa-automerge-gh-"));
  const callLog = path.join(bin, CALL_LOG);
  const script = [
    "#!/usr/bin/env bash",
    `printf '%s\\n' "$*" >> ${JSON.stringify(callLog)}`,
    'case "$*" in',
    "  *rules/branches/*)",
    `    printf '%s' ${JSON.stringify(JSON.stringify(answers.rules ?? UNCOVERED_RULES))}`,
    `    exit ${answers.rulesExitCode ?? 0}`,
    "    ;;",
    "esac",
    `printf '%s' ${JSON.stringify(JSON.stringify(answers.pr ?? STACK_BASED_PR))}`,
    "exit 0",
    "",
  ].join("\n");
  const ghPath = path.join(bin, "gh");
  writeFileSync(ghPath, script, "utf-8");
  chmodSync(ghPath, 0o755);
  return { bin, callLog };
};

/**
 * Parity tests for the cross-repository arm of the ready-role filing guard.
 *
 * The guard exists twice — the canonical bash hook and an independent OpenCode
 * port — so a fix in one is a parity break in the other. These tests run both
 * implementations against the same command and the same `.lisa.config.json`
 * and assert they reach the same verdict, which is the only thing that keeps
 * an upstream filing from being permitted on one agent and refused on another.
 *
 * Every OpenCode case is evaluated in ONE Bun process. Spawning a runtime per
 * case cost ~10s each and put the file over the pre-push 60s per-test budget,
 * which fails the push as a test-correctness error rather than a slow test.
 * The plugin snapshots config at init from the process cwd, so each case
 * chdirs and re-imports the template with a cache-busting query.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

// The bounded children below are handed a base that only fits under a case
// budget scaling with the same machine they do. Without this call the case
// budget is the flat one from `vitest.config.local.ts`, and the child's bound
// overtakes it from a slowdown of 4.0x up — a range measured on this box, in
// this tree, in the run that fixed CodySwannGT/lisa#3202.
useIoLatencyBudget();

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

const UPSTREAM_REPO = "up-org/up-repo";
const CUSTOM_ROLE = "state:queued";

/** A GitHub-tracked caller that renamed its ready lane. */
const GITHUB_CALLER = {
  tracker: "github",
  github: {
    org: "own-org",
    repo: "own-repo",
    labels: { build: { ready: CUSTOM_ROLE } },
  },
  hardening: { upstreamRepo: UPSTREAM_REPO },
};

/** A JIRA-tracked caller, whose ready role is a workflow state. */
const JIRA_CALLER = {
  tracker: "jira",
  jira: { workflow: { ready: "Ready for Development" } },
  hardening: { upstreamRepo: UPSTREAM_REPO },
};

/** One command, its project config, and the verdict both guards must reach. */
const CASES: readonly {
  readonly label: string;
  readonly config: Record<string, unknown>;
  readonly command: string;
  readonly expected: string;
}[] = [
  {
    label: "an upstream filing carrying the upstream role",
    config: GITHUB_CALLER,
    command: `gh issue create --repo ${UPSTREAM_REPO} --title "x" --label "status:ready"`,
    expected: "allow",
  },
  {
    label: "an upstream filing carrying only the caller's role",
    config: GITHUB_CALLER,
    command: `gh issue create --repo ${UPSTREAM_REPO} --title "x" --label "${CUSTOM_ROLE}"`,
    expected: "deny",
  },
  {
    label: "an undeclared upstream filing",
    config: GITHUB_CALLER,
    command: `gh issue create --repo ${UPSTREAM_REPO} --title "x"`,
    expected: "deny",
  },
  {
    label: "a same-repo filing carrying the caller's role",
    config: GITHUB_CALLER,
    command: `gh issue create --repo own-org/own-repo --title "x" --label "${CUSTOM_ROLE}"`,
    expected: "allow",
  },
  {
    label: "an undeclared same-repo filing",
    config: GITHUB_CALLER,
    command: 'gh issue create --title "x"',
    expected: "deny",
  },
  {
    label: "a JIRA caller filing upstream with the upstream role",
    config: JIRA_CALLER,
    command: `gh issue create --repo ${UPSTREAM_REPO} --title "x" --label "status:ready"`,
    expected: "allow",
  },
];

/**
 * A throwaway project directory carrying a Lisa config.
 * @param config - The config to write.
 * @returns The directory path.
 */
const project = (config: Record<string, unknown>): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-issue-parity-"));
  writeFileSync(
    path.join(dir, ".lisa.config.json"),
    JSON.stringify(config),
    "utf-8"
  );
  return dir;
};

/**
 * The bash guard's verdict.
 * @param command - The intercepted shell command.
 * @param cwd - The project directory.
 * @returns "allow" or "deny".
 */
const bashVerdict = (command: string, cwd: string): string => {
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
const opencodeVerdicts = (
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

describe("cross-repo filing parity: bash guard vs OpenCode port", () => {
  const directories = CASES.map(entry => project(entry.config));
  let opencode: readonly string[] = [];

  beforeAll(() => {
    opencode = opencodeVerdicts(
      CASES.map((entry, index) => ({
        dir: directories[index] ?? "",
        command: entry.command,
      }))
    );
  });

  it.each(CASES.map((entry, index) => [entry.label, index] as const))(
    "agrees on %s",
    (_label, index) => {
      const entry = CASES[index];
      expect(entry).toBeDefined();
      expect(bashVerdict(entry?.command ?? "", directories[index] ?? "")).toBe(
        entry?.expected
      );
      expect(opencode[index]).toBe(entry?.expected);
    }
  );
});

/**
 * A gate whose tool is missing must block, not wave the change through.
 *
 * Measured defect (CodySwannGT/lisa#3660): the managed hooks probed for a
 * command-line tool, and when it was absent printed a warning and continued
 * with exit 0.
 *
 *   pre-push, jq absent:        "Continuing without security audit..."
 *   pre-commit, gitleaks absent: "Continuing without secret scanning..."
 *
 * Absence of the tool and absence of findings produced the IDENTICAL
 * observable — a green push, a green commit — so nothing downstream could tell
 * an audited change from an unaudited one. The dependency-vulnerability audit
 * is not decoration: it blocks real pushes on real HIGH advisories. A missing
 * `jq` turned that hard blocker into a no-op, invisibly.
 *
 * `jq` cost four more gates on top of the audit. `lint:slow`, `knip:check`,
 * `knip` and `test:mutation` are all detected with `jq -e '.scripts[...]'`, so
 * a jq-less machine took the "not configured" branch of every one of them and
 * printed a reason that was false — it named the project's configuration for a
 * skip the missing tool caused.
 *
 * The correct rule was already written in these hooks, one screen above the
 * defect, for the lint-staged preflight: "A preflight that cannot RUN is not a
 * skip and not a pass — it blocks." And `node` has always been treated that
 * way at the top of `pre-push`. The dependency probes never were.
 *
 * Proved by EXECUTION rather than by grep, and against every tracked copy: the
 * block is sliced out of each hook verbatim and run with the tool shadowed off
 * PATH, because a refusal nobody has watched happen is a claim. The slice is
 * located on text that exists in the fail-open version too, so these tests can
 * show the bug rather than only confirming the fix.
 * @module tests/unit/hooks/hook-tooling-fail-closed
 */

import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { trackedHookCopies } from "../../helpers/hook-roster.js";

const ROOT = process.cwd();

const PRE_PUSH = [...trackedHookCopies("pre-push")];
const PRE_COMMIT = [...trackedHookCopies("pre-commit")];

/** The sentence the fail-open printed. No copy may print it again. */
const CONTINUING = /Continuing without/u;

const temporary: string[] = [];

afterAll(() => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
});

/**
 * Read one hook's source.
 * @param relative - Repo-relative path to the hook
 * @returns The hook's full text
 */
const hook = (relative: string) =>
  readFileSync(path.join(ROOT, relative), "utf8");

/**
 * A hook's executable lines, with comments dropped.
 * @param source - The hook's full text
 * @returns Only the lines the shell will run
 */
const live = (source: string) =>
  source
    .split("\n")
    .filter(line => !line.trim().startsWith("#"))
    .join("\n");

/**
 * Cut the lines between two markers out of a hook, verbatim.
 *
 * Sliced rather than reimplemented: a copy of the logic would prove only that
 * the copy is right.
 * @param relative - Repo-relative path to the hook
 * @param from - Text on the first line to keep
 * @param until - Text on the first line to drop
 * @returns The block as a runnable script body
 */
function slice(relative: string, from: string, until: string): string {
  const lines = hook(relative).split("\n");
  const start = lines.findIndex(line => line.includes(from));
  const end = lines.findIndex(
    (line, index) => index > start && line.includes(until)
  );
  expect(start, `${relative}: no line containing ${from}`).toBeGreaterThan(-1);
  expect(end, `${relative}: no line containing ${until}`).toBeGreaterThan(
    start
  );
  return lines.slice(start, end).join("\n");
}

/**
 * A temporary directory this file cleans up when it is done.
 * @param prefix - Name prefix for the directory
 * @returns The directory path
 */
function scratchDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  temporary.push(dir);
  return dir;
}

/**
 * A PATH holding stubs for the named tools and nothing else.
 *
 * Replacing PATH entirely rather than prepending is what makes the absence
 * real: a shadow directory in front of the system PATH still leaves the real
 * tool reachable by any lookup that walks past it.
 * @param tools - Names of the tools that should exist and succeed
 * @returns The PATH value to run with
 */
function pathWithOnly(tools: readonly string[]): string {
  const dir = scratchDir("lisa-hook-tooling-");
  for (const tool of tools) {
    const file = path.join(dir, tool);
    writeFileSync(file, "#!/bin/sh\nexit 0\n");
    chmodSync(file, 0o755);
  }
  return dir;
}

/**
 * Run a sliced block under a controlled PATH, in an empty directory.
 *
 * The empty cwd matters for the secret scan: its optional branches key off
 * files in the working directory, and running it at the repository root would
 * make the assertion depend on which ignore files this checkout happens to
 * carry.
 * @param body - The script body to run
 * @param available - Tools that should be on PATH
 * @returns Exit status and the combined output
 */
function run(
  body: string,
  available: readonly string[]
): { status: number; output: string } {
  const cwd = scratchDir("lisa-hook-cwd-");
  const result = boundedSpawnSync({
    label: "hook tooling requirement",
    command: "/bin/sh",
    args: ["-c", body],
    cwd,
    env: { ...process.env, PATH: pathWithOnly(available) },
  });
  return {
    status: result.status ?? -1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

describe.each(PRE_PUSH)("%s tooling requirements", relative => {
  /**
   * Everything the hook asserts about its tooling before it does any work.
   *
   * Located on the `node` probe, which is present in the fail-open version as
   * well, and ended at the push destination guard — the first thing after the
   * preamble in every copy.
   * @returns The preamble as a runnable script body
   */
  const preamble = () =>
    slice(relative, "if ! command -v node", "BEGIN: push destination guard");

  it("blocks the push when jq is missing, and names jq", () => {
    const { status, output } = run(preamble(), ["node"]);

    expect(status).not.toBe(0);
    expect(output).toContain("jq");
    expect(output).not.toMatch(CONTINUING);
  });

  it("tells the developer how to install jq", () => {
    const { output } = run(preamble(), ["node"]);

    expect(output).toContain("brew install jq");
  });

  it("allows the push to proceed when jq is present", () => {
    const { status } = run(preamble(), ["node", "jq"]);

    expect(status).toBe(0);
  });

  it("still blocks when node is missing", () => {
    // The precedent this fix follows. Asserted so a later edit cannot relax
    // node's treatment while claiming to have tightened jq's.
    const { status, output } = run(preamble(), ["jq"]);

    expect(status).not.toBe(0);
    expect(output).toContain("Node.js");
  });

  it("never claims a skipped gate was not configured when jq decided it", () => {
    // The four `jq -e '.scripts[...]'` probes print "(X not configured)" on a
    // false result, which a missing jq also produces. They are only honest
    // because the hook now refuses to reach them without jq.
    const source = hook(relative);

    expect(source).toContain("jq -e '.scripts");
    // Comment lines excluded: the disabled Lighthouse block at the bottom is
    // commented out in full, and a commented fail-open runs nothing.
    expect(live(source)).not.toMatch(CONTINUING);
  });
});

describe.each(PRE_COMMIT)("%s secret scan", relative => {
  /**
   * The built-in Gitleaks scan, sliced verbatim.
   *
   * `lisa_gate_covers` is stubbed to false so the slice takes the built-in
   * path: the question here is what the built-in does without its tool, not
   * whether a declared gate can replace it.
   * @returns The scan block as a runnable script body
   */
  const scan = () =>
    `lisa_gate_covers() { return 1; }\n${slice(
      relative,
      "Checking for secrets with Gitleaks",
      "Check if native changes require runtime version bump"
    )}\n`;

  it("blocks the commit when gitleaks is missing, and names gitleaks", () => {
    const { status, output } = run(scan(), []);

    expect(status).not.toBe(0);
    expect(output).toContain("Gitleaks");
    expect(output).not.toMatch(CONTINUING);
  });

  it("tells the developer how to install gitleaks", () => {
    const { output } = run(scan(), []);

    expect(output).toContain("brew install gitleaks");
  });

  it("runs the scan when gitleaks is present", () => {
    // The stub exits 0, which is a clean scan.
    const { status, output } = run(scan(), ["gitleaks"]);

    expect(status).toBe(0);
    expect(output).toContain("No secrets detected");
  });
});

/**
 * Unit tests for `plugins/src/base/hooks/block-managed-file-edits.agy.sh`
 * (CodySwannGT/lisa#3750).
 *
 * Antigravity had no managed-file protection at all: the guard had no `.agy.sh`
 * adapter and no fallback-dispatcher installer, so both delivery channels
 * missed it while the same project was protected on Claude, Cursor, Copilot and
 * Codex. This adapter translates agy's `{toolCall:{name:"run_command",
 * args:{CommandLine}}}` envelope into Lisa's canonical Claude Bash-hook
 * envelope, runs the canonical guard, and maps its exit status onto agy's
 * `{"decision":"allow"|"deny"}` protocol. It classifies nothing itself.
 *
 * EVERY CASE RUNS AGAINST A SYNTHETIC HOST PROJECT, and that is load-bearing
 * rather than tidy. The canonical guard stands down inside Lisa's own
 * repository, where these files ARE the originals — so an adapter test run with
 * the repo as the project root reports `allow` for everything and would pass
 * just as happily against an adapter that does nothing at all.
 *
 * Scope: agy plugin hooks match `run_command`, so only the Bash arm reaches
 * agy. An agy file-edit tool call writing a copy-overwrite template cannot be
 * intercepted; that gap is recorded in the adapter header and in the pull
 * request rather than papered over.
 * @module tests/unit/agy/block-managed-file-edits-agy
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const SCRIPT = path.join(
  process.cwd(),
  "plugins",
  "src",
  "base",
  "hooks",
  "block-managed-file-edits.agy.sh"
);

const BASH_PATH = "/bin/bash";

/** A copy-overwrite template, host-relative. */
const MANAGED = "scripts/lisa-hooks/block-no-verify.sh";
/** A path the host owns outright. */
const UNMANAGED = "src/app.ts";

let host = "";

beforeAll(() => {
  // A host project is a `package.json` that is NOT @codyswann/lisa plus an
  // installed package carrying the copy-overwrite tree the guard resolves
  // against. Both are required; without either the guard stands down.
  host = mkdtempSync(path.join(tmpdir(), "lisa-agy-managed-"));
  writeFileSync(
    path.join(host, "package.json"),
    JSON.stringify({ name: "a-host-project", version: "1.0.0" }),
    "utf-8"
  );
  const shipped = path.join(
    host,
    "node_modules/@codyswann/lisa/all/copy-overwrite/scripts/lisa-hooks"
  );
  mkdirSync(shipped, { recursive: true });
  writeFileSync(path.join(shipped, "block-no-verify.sh"), "shipped\n", "utf-8");
  mkdirSync(path.join(host, "scripts/lisa-hooks"), { recursive: true });
  writeFileSync(path.join(host, MANAGED), "local\n", "utf-8");
  mkdirSync(path.join(host, "src"), { recursive: true });
  writeFileSync(path.join(host, UNMANAGED), "app\n", "utf-8");
});

/**
 * Run the adapter as the host project.
 * @param stdin - The agy PreToolUse payload.
 * @param extraEnv - Environment overrides for the child.
 * @returns The parsed agy decision object.
 */
const run = (
  stdin: string,
  extraEnv: NodeJS.ProcessEnv = {}
): { readonly decision: string; readonly reason?: string } => {
  const result = boundedSpawnSync({
    label: "the agy block-managed-file-edits hook",
    command: BASH_PATH,
    args: [SCRIPT],
    input: stdin,
    cwd: host,
    env: { ...process.env, CLAUDE_PROJECT_DIR: host, ...extraEnv },
  });
  return JSON.parse(result.stdout) as { decision: string; reason?: string };
};

/**
 * Run the adapter and return only agy's decision.
 * @param stdin - The agy PreToolUse payload.
 * @returns The `decision` field agy would act on.
 */
const decide = (stdin: string): string => run(stdin).decision;

/**
 * Build an agy `run_command` payload.
 * @param commandLine - The shell command agy is about to run.
 * @returns The stdin payload.
 */
const payload = (commandLine: string): string =>
  JSON.stringify({
    toolCall: { name: "run_command", args: { CommandLine: commandLine } },
  });

describe("block-managed-file-edits.agy.sh", () => {
  it.each([
    ["a redirect", `echo tampered > ${MANAGED}`],
    ["an append", `echo more >> ${MANAGED}`],
    ["a tee", `echo tampered | tee ${MANAGED}`],
  ])("denies %s into a managed template", (_label, command) => {
    expect(decide(payload(command))).toBe("deny");
  });

  it("carries the canonical guard's reason through to agy", () => {
    // The adapter translates protocols and nothing else, so the operator must
    // see the canonical refusal rather than a generic adapter message.
    const { reason } = run(payload(`echo tampered > ${MANAGED}`));
    expect(reason).toContain(MANAGED);
    expect(reason).toContain("LISA_ALLOW_MANAGED_FILE_WRITE=1");
  });

  // ── Rejection controls ────────────────────────────────────────────────────
  // An adapter that answers `deny` unconditionally satisfies every case above.
  // These separate a working translation from a broken one.
  describe("rejection controls", () => {
    it.each([
      ["cat", `cat ${MANAGED}`],
      ["grep", `grep -n shipped ${MANAGED}`],
      ["wc", `wc -l ${MANAGED}`],
    ])("allows %s, which only reads a managed template", (_label, command) => {
      expect(decide(payload(command))).toBe("allow");
    });

    it("allows a write to a file the host owns", () => {
      expect(decide(payload(`echo edited > ${UNMANAGED}`))).toBe("allow");
    });

    it("allows a tool call that is not run_command", () => {
      const other = JSON.stringify({
        toolCall: { name: "read_file", args: { CommandLine: "irrelevant" } },
      });
      expect(decide(other)).toBe("allow");
    });

    it("allows an empty payload rather than failing closed", () => {
      // Every sibling adapter fails open on a malformed envelope: a missed
      // refusal costs a silently forked template, where failing closed would
      // block every command on a machine whose runtimes are missing.
      expect(decide("")).toBe("allow");
    });

    it("honours the operator escape hatch", () => {
      expect(
        run(payload(`echo tampered > ${MANAGED}`), {
          LISA_ALLOW_MANAGED_FILE_WRITE: "1",
        }).decision
      ).toBe("allow");
    });
  });

  it("delegates rather than reimplementing classification", () => {
    // The property the ticket asks for. A second implementation would be a
    // second thing to harden, and the two would diverge at the first vector
    // closed in only one of them.
    const source = readFileSync(SCRIPT, "utf-8");
    expect(source).toContain("block-managed-file-edits.sh");
    expect(source).not.toContain("copy-overwrite/");
    expect(source).not.toContain("node_modules/@codyswann/lisa");
  });
});

/**
 * The inventory has to name the moment the on-edit scripts actually fire at.
 *
 * It named `pre-tool`. They are registered `PostToolUse` — the entry's own
 * sibling field `hookEvent` says so, derived from the shipped manifests — and
 * the shipped CLI therefore printed three statements about them, two false:
 * the wrong moment, `[NOT DECLARABLE AT THIS MOMENT]` about a moment that IS
 * declarable since #2920, and silence at the moment the enforcement actually
 * happens.
 *
 * The `pre-tool` value was a placeholder that named its own expiry — "blocked
 * on the registry gaining `post-tool`" — and #2920 satisfied that condition
 * and falsified the "nothing depends on the distinction" premise in the same
 * commit. The defect fell exactly between two pull requests and was owned by
 * neither.
 *
 * @module tests/unit/scripts/lisa-gates-on-edit-moment
 */

import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  HARDCODED_INVOCATIONS,
  isDeclarableAt,
  unconfiguredAt,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const GATES = path.join(
  REPO_ROOT,
  "all",
  "copy-overwrite",
  "scripts",
  "lisa-gates.mjs"
);

/** Wall-clock ceiling for one CLI invocation. */
const CLI_TIMEOUT_MS = 30_000;

/** The surface the on-edit scripts are recorded on. */
const ON_EDIT_SURFACE = "on-edit-hook";

/** The moment those scripts actually fire at. */
const POST_TOOL = "post-tool";

/** The moment the inventory used to claim they fire at. */
const PRE_TOOL = "pre-tool";

/** The line the CLI prints about a moment no declaration is legal at. */
const UNDECLARABLE = "[NOT DECLARABLE AT THIS MOMENT]";

/** Every on-edit inventory entry. */
const onEdit = (): typeof HARDCODED_INVOCATIONS =>
  HARDCODED_INVOCATIONS.filter(entry => entry.surface === ON_EDIT_SURFACE);

/**
 * Runs the shipped CLI against this repository.
 * @param args Arguments after the script path.
 * @returns Exit status and combined output.
 */
const cli = (args: string[]): { status: number; output: string } => {
  const result = spawnSync(process.execPath, [GATES, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: CLI_TIMEOUT_MS,
  });
  if (result.signal !== null) {
    throw new Error(
      `lisa-gates.mjs ${args.join(" ")} was KILLED (${result.signal}) rather ` +
        `than completing, so its empty output is a timeout and not a CLI ` +
        `that printed nothing.`
    );
  }
  return {
    status: result.status ?? -1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
};

describe("the on-edit entries name the moment their script fires at", () => {
  it("records post-tool, the registry's name for PostToolUse", () => {
    const entries = onEdit();

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.moment, entry.artifact).toBe(POST_TOOL);
    }
  });

  it("agrees with the hookEvent derived from the shipped manifest", () => {
    // The pair is the whole guard: `moment` is the registry's vocabulary and
    // `hookEvent` is the harness's, and they must never be able to disagree.
    for (const entry of onEdit()) {
      expect((entry as { hookEvent?: string }).hookEvent, entry.artifact).toBe(
        "PostToolUse"
      );
    }
  });
});

describe("the report speaks at the moment the enforcement happens", () => {
  it("reports the scripts at post-tool", () => {
    const findings = unconfiguredAt({
      gates: {},
      moment: POST_TOOL,
      surface: ON_EDIT_SURFACE,
    });

    expect(findings.length).toBe(onEdit().length);
  });

  it("does not report them at a moment they do not fire at", () => {
    // The mirror half, and the one that was silently false: the old table
    // spoke at `pre-tool`, where none of these scripts runs.
    expect(
      unconfiguredAt({ gates: {}, moment: PRE_TOOL, surface: ON_EDIT_SURFACE })
    ).toEqual([]);
  });
});

describe("a declarable moment is not described as undeclarable", () => {
  it("finds every on-edit entry's gate legal at the moment it records", () => {
    // This is the inversion of what the inventory control used to assert, and
    // the inversion is the point. It read `false` because no gate listed
    // either tool moment; keeping that expectation after #2920 would have
    // pinned the entries at a moment they do not fire at purely to keep a
    // control green.
    for (const entry of onEdit()) {
      expect(isDeclarableAt(entry.gate, entry.moment), entry.gate).toBe(true);
    }
  });

  it("prints no undeclarable notice for them", () => {
    const { status, output } = cli([
      "inventory",
      `--surface=${ON_EDIT_SURFACE}`,
    ]);

    expect(status).toBe(0);
    expect(output).toContain(POST_TOOL);
    expect(output).not.toContain(UNDECLARABLE);
  });

  it("still prints it for an entry whose gate really is illegal there", () => {
    // The other direction, so the notice is not simply deleted. Mutation
    // testing runs at push and `test-meaningfulness` may not be declared
    // there, so that line must survive.
    const { output } = cli(["inventory", "--moment=push"]);

    expect(output).toContain(UNDECLARABLE);
  });
});

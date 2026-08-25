/**
 * Keeps the orphaned-fixture-process detector a control that runs.
 *
 * CodySwannGT/lisa#3032 carries this acceptance clause verbatim:
 *
 * ```gherkin
 *   Scenario: a fixture cleans up after itself
 *     ...
 *     And no process it spawned outlives it
 * ```
 *
 * The detector that answers it was built by #2902 and landed as #3049:
 * `scripts/check-orphan-test-processes.mjs`, with a genuine bite test that
 * plants a real orphan — outer shell exits, inner reparents to PID 1 — and
 * asserts exit 1.
 *
 * **It was invoked by nothing.** Measured on `origin/main` at 4.10.10, the only
 * occurrence of `check:orphan-processes` anywhere in the repository outside the
 * script and its own test was the line in `package.json` that DEFINES it. No
 * gate declared it, no workflow ran it, no hook called it. A clause enforced by
 * a script nobody runs is not enforced — it is a control that reports success
 * by never being asked, which is the failure mode
 * `mutation-sigterm-control-wired` exists to prevent for its own control.
 *
 * ## Why `optional`, and why that is not a weaker version of `required`
 *
 * `selectOrphans` matches any process whose command line contains one of the
 * fixture prefixes, read off a whole-box `ps -e`. The prefixes carry no
 * worktree and no run identity, and every worktree on this machine shares one
 * `$TMPDIR` — so under an agent fleet one agent's leaked orphan is reported to
 * every other agent's push.
 *
 * Declaring it `required` would therefore refuse a run for a SIBLING's residue,
 * which is precisely the defect #3053 had just finished removing from the
 * scratch-namespace ceiling: a start-time count summed across every concurrent
 * run, compared against a budget as though it described one of them. Importing
 * that shape into a new gate to close a clause about it would be a poor trade.
 *
 * `optional` is what the runner offers for exactly this: it RUNS and its
 * failure prints, and it does not set `blockedBy`. That moves the clause from
 * unenforced to reported on every push, without making one agent's leak
 * another agent's outage. Tightening it later is a real decision — it needs
 * run-scoped attribution first — so the level is pinned here rather than left
 * to drift.
 * @module tests/unit/config/orphan-process-gate-wired
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

/**
 * The gate id.
 *
 * `x-` prefixed deliberately. `validateGates` refuses an id it does not know —
 * "is not a gate Lisa knows. Prefix a gate of your own with `x-`" — and this
 * detector is Lisa's own, living in `scripts/` rather than in a shipped tree,
 * so no downstream project has it. Registering it in the shipped registry would
 * announce a gate to every consumer that cannot run it.
 */
const GATE_ID = "x-orphan-fixture-processes";

/** The moment it is declared at. */
const MOMENT = "push";

/** The package script the gate's `run:` names. */
const TASK = "check:orphan-processes";

/** The detector itself. */
const DETECTOR = "scripts/check-orphan-test-processes.mjs";

/** The bite test that proves the detector fires on a real planted orphan. */
const BITE_SUITE = "tests/unit/scripts/check-orphan-test-processes.test.ts";

/** One gate's declaration at one moment. */
type Declaration = { level?: string; run?: string };

/**
 * Read a repository file.
 * @param relative - Repository-relative path
 * @returns Its contents
 */
const read = (relative: string): string =>
  readFileSync(path.join(REPO_ROOT, relative), "utf8");

/**
 * The gates block of this repository's own Lisa configuration.
 * @returns Every declared gate, keyed by id
 */
const gates = (): Record<string, Record<string, unknown>> =>
  (
    JSON.parse(read(".lisa.config.json")) as {
      gates: Record<string, Record<string, unknown>>;
    }
  ).gates;

/**
 * The scripts block of this repository's `package.json`.
 * @returns Every script, keyed by name
 */
const scripts = (): Record<string, string> =>
  (JSON.parse(read("package.json")) as { scripts: Record<string, string> })
    .scripts;

describe("the orphaned-fixture-process control is wired to something", () => {
  it("is declared as a gate, so a run actually invokes it", () => {
    // The defect, stated as an assertion. Before this wiring the detector's
    // only mention outside its own files was the package.json line defining
    // the script, so nothing ever ran it.
    expect(
      gates()[GATE_ID],
      `${DETECTOR} bites in its own test and was invoked by nothing. #3032's clause "no process it spawned outlives it" cannot be met by a control that never runs`
    ).toBeDefined();
    expect(gates()[GATE_ID]?.[MOMENT]).toBeDefined();
  });

  it("names a task that exists and resolves to the detector with the bite test", () => {
    const declaration = gates()[GATE_ID]?.[MOMENT] as Declaration | undefined;

    expect(declaration?.run).toBe(TASK);
    // A gate naming a task that does not exist is the same nothing as a gate
    // that is not declared, and it reads as wired.
    expect(scripts()[TASK]).toContain(DETECTOR);
    // And the file the task names must be the one the bite test imports, or
    // the gate runs a second copy that nothing proves anything about.
    expect(read(DETECTOR)).toContain("export function selectOrphans");
    expect(read(BITE_SUITE)).toContain("check-orphan-test-processes.mjs");
  });

  it("is optional, because its match is $TMPDIR-global rather than run-scoped", () => {
    const declaration = gates()[GATE_ID]?.[MOMENT] as Declaration | undefined;

    expect(
      declaration?.level,
      "required would refuse a push for a SIBLING agent's orphan — the shared-state refusal #3053 removed from the scratch ceiling. Tighten this only after the detector can attribute an orphan to the run that leaked it"
    ).toBe("optional");
  });

  it("still has nothing that scopes an orphan to the run that leaked it", () => {
    // Pins the reason the level above is what it is. When this stops being
    // true — a run id, a worktree, an owning-pid check — the trade changes and
    // the level is worth revisiting. Until then it is not.
    const detector = read(DETECTOR);

    expect(detector).toContain("const FIXTURE_PREFIXES");
    expect(
      detector,
      "the detector gained run-scoped attribution; re-examine whether the gate can now be required"
    ).not.toContain("LISA_SCRATCH_ROOT");
  });
});

/**
 * A built-in hook step stands down only for its OWN property.
 *
 * The registry handover was all-or-nothing: the runner exited 0 and both hooks
 * skipped their entire built-in block. Exit 0 says the gates that were declared
 * passed — it says nothing about whether the block covers the properties those
 * steps prove, so a `gates` block declaring `code-style` and silent about
 * `credential-leakage` deleted the secret scan by omission. A control returning
 * success for an input it never examined is the exact defect the gate registry
 * exists to prevent.
 *
 * The handover is now per property. The runner writes the covered gate ids to
 * the file named by `--coverage`, and each step consults only its own. This
 * file asserts both halves of that contract, because they live in two languages
 * in four files and nothing else holds them together:
 *
 * - the runner writes the right ids, and still withholds the moment from a
 *   caller that did NOT pass `--coverage` (an older hook, whose only lever is
 *   all-or-nothing);
 * - the shell reader is exact and fail-safe, and every id the hooks name is one
 *   the runner can actually emit — an id outside that vocabulary would be a
 *   step that can never stand down, or worse, a typo nobody notices.
 * @module tests/unit/hooks/gate-coverage-handover
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { trackedHookCopies } from "../../helpers/hook-roster.js";

import {
  BUILTIN_FLOOR,
  CONDITIONAL_FLOOR,
  EXIT,
  provenFloor,
  STATE,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";

const ROOT = process.cwd();
const RUNNER = path.join(ROOT, "all/copy-overwrite/scripts/lisa-run-gates.mjs");
const LEAKAGE = "credential-leakage";
const STYLE = "code-style";
const SLOW = "code-style-slow";
const TYPES = "type-correctness";
const PUSH = "push";

/**
 * Every hook that hands its steps over, and the moment each runs at.
 *
 * The roster is derived from what git tracks, not typed. Four entries were
 * written here while a third tracked copy of the pre-push hook contained no
 * handover at all, and this file reported the handover contract intact
 * (CodySwannGT/lisa#2847). The moment comes from the hook's own name, so a copy
 * added anywhere in the tree arrives with its moment already known.
 */
const HOOKS = [
  ...trackedHookCopies("pre-commit").map(file => ({
    file,
    moment: "commit" as const,
  })),
  ...trackedHookCopies("pre-push").map(file => ({
    file,
    moment: "push" as const,
  })),
];

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * Run the real runner in a throwaway project.
 * @param gates - The `gates` block, or null to write no config at all
 * @param moment - The moment to ask for
 * @param withCoverage - Whether to pass `--coverage`
 * @param scripts - Package scripts to stage, for a gate that must really run
 * @returns The exit status and the coverage file's lines
 */
function runRunner(
  gates: object | null,
  moment: string,
  withCoverage = true,
  scripts?: Record<string, string>
): { status: number; covered: string[]; stdout: string } {
  const { root, file } = stageProject(gates, scripts);
  const args = [
    RUNNER,
    `--moment=${moment}`,
    ...(withCoverage ? [`--coverage=${file}`] : []),
  ];
  const child = boundedSpawnSync({
    label: "lisa-run-gates.mjs",
    command: process.execPath,
    args,
    cwd: root,
  });
  return {
    status: child.status ?? -1,
    covered: readCovered(file),
    stdout: child.stdout ?? "",
  };
}

/**
 * A throwaway project holding just a `gates` block.
 * @param gates - The block, or null to write no config at all
 * @param scripts - Package scripts to stage, for a gate that must really run
 * @returns The project root and the path to hand `--coverage`
 */
function stageProject(
  gates: object | null,
  scripts?: Record<string, string>
): { root: string; file: string } {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-coverage-"));
  const file = path.join(root, "coverage.txt");
  dirs.push(root);
  if (gates) {
    writeFileSync(
      path.join(root, ".lisa.config.json"),
      JSON.stringify({ gates })
    );
  }
  if (scripts) {
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "coverage-fixture", version: "0.0.0", scripts })
    );
  }
  return { root, file };
}

/** A package script that exits zero, and one that does not. */
const SCRIPTS = {
  passes: 'node -e "process.exit(0)"',
  errors: 'node -e "process.exit(1)"',
};

/**
 * One gate outcome, shaped as `runGates` reports it.
 * @param id - The gate id
 * @param state - A `STATE` value
 * @returns The outcome entry
 */
function outcome(id: string, state: string): { id: string; state: string } {
  return { id, state };
}

/**
 * The ids a coverage file names.
 * @param file - Path the runner was given
 * @returns One id per line, or none when the file was never written
 */
function readCovered(file: string): string[] {
  try {
    return readFileSync(file, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * The hook's own `lisa_gate_covers`, sliced out and made callable.
 * @param file - Repo-relative path to the hook
 * @param coverage - Lines to put in the coverage file, or null for no file
 * @param names - Gate ids to ask about
 * @returns Whether the hook would stand the step down
 */
function covers(
  file: string,
  coverage: string[] | null,
  ...names: string[]
): boolean {
  const script = [
    stageCoverage(coverage),
    coverageReader(file),
    `lisa_gate_covers ${names.join(" ")}`,
  ].join("\n");
  return (
    boundedSpawnSync({
      label: "lisa_gate_covers",
      command: "/bin/sh",
      args: ["-c", script],
    }).status === 0
  );
}

/**
 * The hook's `lisa_gate_covers` definition, verbatim.
 * @param file - Repo-relative path to the hook
 * @returns The shell function's source
 */
function coverageReader(file: string): string {
  const source = readFileSync(path.join(ROOT, file), "utf8");
  const start = source.indexOf("lisa_gate_covers() {");
  const end = source.indexOf("\n}\n", start);
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, end + 3);
}

/**
 * A coverage file, and the assignment that points the reader at it.
 * @param coverage - Lines to write, or null to leave the variable empty
 * @returns The shell assignment
 */
function stageCoverage(coverage: string[] | null): string {
  if (!coverage) return 'LISA_GATE_COVERAGE=""';
  const root = mkdtempSync(path.join(tmpdir(), "lisa-covers-"));
  const target = path.join(root, "coverage.txt");
  dirs.push(root);
  writeFileSync(target, coverage.length ? `${coverage.join("\n")}\n` : "");
  return `LISA_GATE_COVERAGE="${target}"`;
}

describe("the runner reports what it covers", () => {
  it("writes one declared floor id per line", () => {
    const { status, covered } = runRunner(
      { [STYLE]: { commit: "off" }, [LEAKAGE]: { commit: "off" } },
      "commit"
    );
    expect(status).toBe(EXIT.PROVED);
    expect(covered).toEqual([STYLE, LEAKAGE]);
  });

  it("takes the moment even when the block is half-declared", () => {
    // The whole point: the registry runs what it declares, the built-ins run
    // the rest. Withholding the moment from a per-step caller would keep an
    // incrementally migrating project stuck on the pre-registry path.
    const { status, covered, stdout } = runRunner(
      { [STYLE]: { commit: "off" } },
      "commit"
    );
    expect(status).toBe(EXIT.PROVED);
    expect(covered).toEqual([STYLE]);
    expect(covered).not.toContain(LEAKAGE);
    expect(stdout).toContain(LEAKAGE);
  });

  it("still withholds it from a caller that cannot skip per step", () => {
    // An older hook paired with a newer runner has only the all-or-nothing
    // lever, so for it the floor veto must survive exactly as it was.
    const { status } = runRunner(
      { [STYLE]: { commit: "off" } },
      "commit",
      false
    );
    expect(status).toBe(EXIT.NO_GATES);
  });

  it("covers nothing, in a written file, when there is no gates block", () => {
    const { status, covered } = runRunner(null, "commit");
    expect(status).toBe(EXIT.NO_GATES);
    expect(covered).toEqual([]);
  });
});

/**
 * Coverage reports what the run PROVED, not what the project DECLARED.
 *
 * The file was written before a single gate executed, so it named every
 * declared floor property regardless of what happened to it. `blocked` is set
 * only by a REQUIRED gate going unproved, so an OPTIONAL gate that ran and
 * errored left the runner exiting 0 with that gate already listed as covered —
 * and the hook, which reads exit 0 plus a matching line as "done", stood its
 * built-in step down. The property was proved at neither layer and the push
 * succeeded.
 */
describe("a leg that errored cannot stand a built-in step down", () => {
  it("drops a gate whose leg ran and did not prove it", () => {
    expect(
      provenFloor({
        gates: { [TYPES]: { [PUSH]: "optional" } },
        moment: PUSH,
        result: { results: [outcome(TYPES, STATE.UNPROVABLE)] },
      })
    ).toEqual([]);
  });

  it.each([STATE.FAILED, STATE.UNPROVABLE, STATE.KILLED, STATE.NOT_RUN])(
    "drops it for state %s, because none of those measured the property",
    state => {
      expect(
        provenFloor({
          gates: { [TYPES]: { [PUSH]: "optional" } },
          moment: PUSH,
          result: { results: [outcome(TYPES, state)] },
        })
      ).toEqual([]);
    }
  );

  it("keeps a gate whose leg ran and passed", () => {
    // The other half of the contract. A fix that dropped this row would retire
    // the handover itself rather than the defect.
    expect(
      provenFloor({
        gates: { [TYPES]: { [PUSH]: "required" } },
        moment: PUSH,
        result: { results: [outcome(TYPES, STATE.PASSED)] },
      })
    ).toEqual([TYPES]);
  });

  it("keeps a gate declared off, which never ran by decision", () => {
    // `off` is a decision on the record, and the built-in standing down IS that
    // decision taking effect. An off gate never reaches `resolveMoment`, so it
    // is absent from the results and must not be mistaken for an unproved one.
    expect(
      provenFloor({
        gates: { [TYPES]: { [PUSH]: "off" } },
        moment: PUSH,
        result: { results: [] },
      })
    ).toEqual([TYPES]);
  });

  it("covers nothing when there is no run to report", () => {
    expect(
      provenFloor({ gates: { [TYPES]: { [PUSH]: "off" } }, moment: PUSH })
    ).toEqual([]);
  });
});

describe("the runner and the hook agree about an errored leg", () => {
  const hook = HOOKS.find(entry => entry.moment === "push")?.file ?? "";

  it("finds a pre-push hook to read the coverage with", () => {
    expect(hook).not.toBe("");
  });

  it("leaves an errored optional gate out of the file it writes", () => {
    // End to end, and the whole defect in one assertion: the run is NOT
    // blocked (the gate is optional), so the hook is about to decide off the
    // coverage file alone.
    const { status, covered } = runRunner(
      { [TYPES]: { [PUSH]: { level: "optional", run: "errors" } } },
      PUSH,
      true,
      { errors: SCRIPTS.errors }
    );

    expect(status).toBe(EXIT.PROVED);
    expect(covered).not.toContain(TYPES);
    expect(covers(hook, covered, TYPES)).toBe(false);
  });

  it("still stands the step down when that same gate passes", () => {
    const { status, covered } = runRunner(
      { [TYPES]: { [PUSH]: { level: "optional", run: "passes" } } },
      PUSH,
      true,
      { passes: SCRIPTS.passes }
    );

    expect(status).toBe(EXIT.PROVED);
    expect(covered).toContain(TYPES);
    expect(covers(hook, covered, TYPES)).toBe(true);
  });
});

describe.each(HOOKS)("$file reads coverage exactly", ({ file }) => {
  it("stands a step down only on a whole-line match", () => {
    expect(covers(file, [LEAKAGE], LEAKAGE)).toBe(true);
    expect(covers(file, [LEAKAGE], STYLE)).toBe(false);
  });

  it("does not let one id satisfy another it is a prefix of", () => {
    // `code-style` and `code-style-slow` are a real shipped pair. A substring
    // match would let the fast lint gate stand the slow lint step down.
    expect(covers(file, [STYLE], SLOW)).toBe(false);
    expect(covers(file, [SLOW], STYLE)).toBe(false);
  });

  it("requires every id when a step proves more than one property", () => {
    expect(covers(file, [STYLE, LEAKAGE], STYLE, LEAKAGE)).toBe(true);
    expect(covers(file, [STYLE], STYLE, LEAKAGE)).toBe(false);
  });

  it("answers no for an empty file and for no file at all", () => {
    // Fail-safe: every route to "I do not know" runs the built-in step.
    expect(covers(file, [], LEAKAGE)).toBe(false);
    expect(covers(file, null, LEAKAGE)).toBe(false);
  });
});

describe.each(HOOKS)("$file names only real properties", ({ file, moment }) => {
  it("guards every step with ids the runner can emit", () => {
    const vocabulary = new Set([
      ...(BUILTIN_FLOOR[moment] ?? []),
      ...(CONDITIONAL_FLOOR[moment] ?? []).map(
        (entry: { id: string }) => entry.id
      ),
    ]);
    const used = [
      ...readFileSync(path.join(ROOT, file), "utf8").matchAll(
        /^if lisa_gate_covers ([\w -]+); then$/gmu
      ),
    ].flatMap(match => (match[1] ?? "").trim().split(/\s+/u));

    // An id outside the vocabulary is a step that can never stand down — a
    // silent no-op rather than a loud failure, so nothing else would catch it.
    expect(used.length).toBeGreaterThan(2);
    expect(used.filter(id => !vocabulary.has(id))).toEqual([]);
  });
});

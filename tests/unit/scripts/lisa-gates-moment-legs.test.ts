/**
 * The pull-request moment resolves its gates from the registry, like the others.
 *
 * `lisa-run-gates.mjs` has resolved whatever a moment declares and run
 * `$runner $task` since the git hooks stopped hardcoding their step lists. The
 * pull-request moment never made that move: `quality.yml` carried one
 * hand-written block per gate, each with a hardcoded `GATE_ID`, and a gate
 * outside that set was unreachable from a declaration no matter what a project
 * wrote in `.lisa.config.json` (CodySwannGT/lisa#2881).
 *
 * `momentLegs` is that moment's answer, and this suite is what makes it bite.
 * Every case here fails under the code as it stood before the runner existed —
 * either because the function was absent, or because the specific clause the
 * case names was.
 *
 * ## What each case would let through if it were deleted
 *
 * - `off` legs: drop `includeOff` and a gate a project turned off stops
 *   reporting. That is not a skip — a required context that never reports
 *   holds the pull request at "Expected — Waiting for status to be reported"
 *   forever.
 * - `jobBackedGates` exclusion: drop it and two jobs post one context, so
 *   branch protection matches whichever reported last.
 * - `unproved`: turn it into a pass and a declared gate with no prover reports
 *   green having measured nothing, which is the defect the whole gate façade
 *   exists to stop.
 * - `install`: drop the "Lisa's own prover" clause and a project's own `run:`
 *   inherits Lisa's no-install claim, so the leg fails as `Cannot find module`
 *   — a wrong declaration wearing a broken-gate costume.
 * @module tests/unit/scripts/lisa-gates-moment-legs
 */

import { describe, expect, it } from "vitest";

import {
  COSTLY_LEG_TIMEOUT_MINUTES,
  LEG_ACTIONS,
  LEG_TIMEOUT_MINUTES,
  QUALITY_JOB_GATES,
  REGISTRY,
  contextsFor,
  jobBackedGates,
  momentLegs,
  validateGates,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

/** The moment this whole subsystem is about. */
const PULL_REQUEST = "pull-request";

/** One leg, as this suite reads it. */
interface Leg {
  gate: string;
  label: string;
  level: string;
  action: string;
  runner: string;
  task: string;
  install: boolean;
  timeout: number;
  summary: string;
}

/** The shipped resolver, typed for this suite. */
const legsAt = momentLegs as (options: {
  gates: object;
  moment: string;
  runner?: string;
  scripts?: object | null;
}) => Leg[];

/** The shipped registry, as this suite reads it. */
const GATES = REGISTRY as Record<
  string,
  { label: string; task?: string; needs?: { deps?: boolean }; costly?: boolean }
>;

/**
 * A gate that is legal at pull-request and that NO hand-written job proves.
 *
 * Chosen by derivation rather than named, so the suite keeps testing the thing
 * it means when a gate acquires or loses a job. `artifact-freshness` is the
 * answer today and the assertion below says why that matters.
 */
const UNJOBBED = "artifact-freshness";

/** A gate a hand-written job proves, so the runner must leave it alone. */
const JOBBED = "code-style";

describe("the gate a leg is emitted for", () => {
  it("picks a fixture that is genuinely unjobbed, so the suite is not vacuous", () => {
    // The absent-case rule. Every assertion below turns on `UNJOBBED` having
    // no job; if it quietly acquired one, they would all keep passing while
    // measuring a case that no longer exists.
    expect(Object.values(QUALITY_JOB_GATES)).not.toContain(UNJOBBED);
    expect(Object.values(QUALITY_JOB_GATES)).toContain(JOBBED);
    expect(GATES[UNJOBBED]?.task).toBe("check:artifacts");
  });

  it("emits one leg for a declared gate no built-in job proves", () => {
    const legs = legsAt({
      gates: { [UNJOBBED]: { [PULL_REQUEST]: "required" } },
      moment: PULL_REQUEST,
      runner: "bun run",
    });
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({
      gate: UNJOBBED,
      level: "required",
      action: "run",
      runner: "bun run",
      task: "check:artifacts",
    });
  });

  it("emits NO leg for a gate a built-in job already posts a context for", () => {
    // Two jobs named one label is two jobs posting one branch-protection
    // context, and GitHub matches whichever reported last. This is the clause
    // that keeps the migration one-at-a-time rather than all-at-once.
    const legs = legsAt({
      gates: { [JOBBED]: { [PULL_REQUEST]: "required" } },
      moment: PULL_REQUEST,
    });
    expect(legs).toEqual([]);
  });

  it("emits no leg for an awaited gate, which a vendor posts itself", () => {
    const legs = legsAt({
      gates: {
        "code-review": {
          [PULL_REQUEST]: { level: "required", await: "CodeRabbit" },
        },
      },
      moment: PULL_REQUEST,
    });
    expect(legs).toEqual([]);
  });
});

describe("a gate declared off still reports", () => {
  it("emits a leg that runs nothing and passes", () => {
    const legs = legsAt({
      gates: { [UNJOBBED]: { [PULL_REQUEST]: "off" } },
      moment: PULL_REQUEST,
    });
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({
      gate: UNJOBBED,
      level: "off",
      action: "report",
      runner: "",
      task: "",
      install: false,
    });
  });

  it("carries the same label the required declaration would post", () => {
    // The context string may not depend on the level. A ruleset that still
    // names a gate the project has since turned off must see that exact
    // context report, or the pull request waits on it forever.
    const off = legsAt({
      gates: { [UNJOBBED]: { [PULL_REQUEST]: "off" } },
      moment: PULL_REQUEST,
    });
    const required = legsAt({
      gates: { [UNJOBBED]: { [PULL_REQUEST]: "required" } },
      moment: PULL_REQUEST,
    });
    expect(off[0]?.label).toBe(required[0]?.label);
    expect(off[0]?.label).toBe(GATES[UNJOBBED]?.label);
  });

  it("emits nothing for a gate the project never mentions", () => {
    // The other half of the same rule. "Off" and "never mentioned" are
    // different claims: one is a decision on the record, the other is silence,
    // and only the first buys a context that reports.
    expect(legsAt({ gates: {}, moment: PULL_REQUEST })).toEqual([]);
  });
});

describe("a leg with nothing to run says so and fails", () => {
  it("marks a declared gate with no resolvable task as unproved", () => {
    const legs = legsAt({
      gates: { "x-house-style": { [PULL_REQUEST]: "required" } },
      moment: PULL_REQUEST,
    });
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({
      gate: "x-house-style",
      action: "unproved",
      runner: "",
      task: "",
    });
  });

  it("keeps unproved distinct from both of the other two answers", () => {
    // `unproved` blocks and `report` passes, so collapsing them is the exact
    // trade this subsystem refuses: a gate that measured nothing reporting the
    // same colour as a gate the project deliberately turned off.
    expect(LEG_ACTIONS).toEqual(["run", "report", "unproved"]);
  });
});

describe("the install step is decided by the registry", () => {
  it("skips the install for a gate whose shipped prover needs none", () => {
    const legs = legsAt({
      gates: { "version-duplication": { [PULL_REQUEST]: "required" } },
      moment: PULL_REQUEST,
    });
    expect(GATES["version-duplication"]?.needs?.deps).toBe(false);
    expect(legs[0]?.install).toBe(false);
  });

  it("installs for a gate whose shipped prover makes no such claim", () => {
    const legs = legsAt({
      gates: { [UNJOBBED]: { [PULL_REQUEST]: "required" } },
      moment: PULL_REQUEST,
    });
    expect(GATES[UNJOBBED]?.needs).toBeUndefined();
    expect(legs[0]?.install).toBe(true);
  });

  it("installs the moment the project names a prover of its own", () => {
    // THE CLAUSE THAT MATTERS. `deps: false` is a claim about the command Lisa
    // wrote. A project pointing the same gate at its own task gets a command
    // Lisa has never seen, and inheriting the claim would skip an install that
    // task may need — failing as `Cannot find module`, which reads as a broken
    // gate rather than as a declaration that outran its evidence.
    const legs = legsAt({
      gates: {
        "version-duplication": {
          run: "check:versions:mine",
          [PULL_REQUEST]: "required",
        },
      },
      moment: PULL_REQUEST,
    });
    expect(legs[0]?.task).toBe("check:versions:mine");
    expect(legs[0]?.install).toBe(true);
  });

  it("never asks for an install on a leg that runs nothing", () => {
    const legs = legsAt({
      gates: { [UNJOBBED]: { [PULL_REQUEST]: "off" } },
      moment: PULL_REQUEST,
    });
    expect(legs[0]?.install).toBe(false);
  });
});

describe("a leg's timeout comes from the gate, not the workflow", () => {
  it("gives a costly gate the long budget and everything else the short one", () => {
    const costly = legsAt({
      gates: { "generative-testing": { [PULL_REQUEST]: "required" } },
      moment: PULL_REQUEST,
    });
    const quick = legsAt({
      gates: { [UNJOBBED]: { [PULL_REQUEST]: "required" } },
      moment: PULL_REQUEST,
    });
    expect(GATES["generative-testing"]?.costly).toBe(true);
    expect(costly[0]?.timeout).toBe(COSTLY_LEG_TIMEOUT_MINUTES);
    expect(quick[0]?.timeout).toBe(LEG_TIMEOUT_MINUTES);
    expect(COSTLY_LEG_TIMEOUT_MINUTES).toBeGreaterThan(LEG_TIMEOUT_MINUTES);
  });
});

describe("a leg's task can never reach a shell as anything but a word", () => {
  it.each([
    ["$(id)", "command substitution"],
    ["lint; rm -rf /", "a statement separator"],
    ["lint && curl evil", "a conjunction"],
    ['lint "quoted"', "a quote"],
    ["lint`id`", "a backtick"],
  ])("refuses %s (%s)", task => {
    // The leg receives an ALREADY-RESOLVED task through the matrix, so the
    // workflow has no second chance to refuse it — the check has to bite here.
    expect(() =>
      legsAt({
        gates: { [UNJOBBED]: { run: task, [PULL_REQUEST]: "required" } },
        moment: PULL_REQUEST,
      })
    ).toThrow(/not a plain word/u);
  });

  it("still admits the colon a real task name carries", () => {
    const legs = legsAt({
      gates: {
        [UNJOBBED]: { run: "test:cov:unit", [PULL_REQUEST]: "required" },
      },
      moment: PULL_REQUEST,
    });
    expect(legs[0]?.task).toBe("test:cov:unit");
  });

  it("refuses a runner that is a shell no-op before any leg is built", () => {
    expect(() =>
      legsAt({
        gates: { [UNJOBBED]: { [PULL_REQUEST]: "required" } },
        moment: PULL_REQUEST,
        runner: ":",
      })
    ).toThrow(/cannot run a task/u);
  });
});

describe("the leg's context is the one the ruleset already asks for", () => {
  it("posts exactly what contextsFor derives, with no rename anywhere", () => {
    // AC 1, and it is satisfied by construction rather than by coincidence:
    // both sides read the registry's `label`. A matrix job named by a matrix
    // expression posts `<workflow> / <name>` verbatim — measured on run
    // 32719734434 — so this equality is the whole of the naming argument.
    const gates = { [UNJOBBED]: { [PULL_REQUEST]: "required" } };
    const [leg] = legsAt({ gates, moment: PULL_REQUEST });
    expect(contextsFor(gates, { moment: PULL_REQUEST })).toEqual([
      `🔍 Quality Checks / ${leg?.label}`,
    ]);
  });
});

describe("which gates the runner leaves alone", () => {
  it("is the job table's own values, deduplicated and sorted", () => {
    // Deliberately NOT a second list to keep in step. That table is derived
    // from the jobs the shipped workflows define and asserted equal by
    // `quality-gate-skip-jobs-mapping`, so deleting a job must drop its row —
    // and dropping the row is precisely what hands the gate to the runner. A
    // separate "these ones migrated" ledger would record an intent nothing
    // depended on, which is a comment wearing code's clothes.
    expect(jobBackedGates()).toEqual(
      [...new Set(Object.values(QUALITY_JOB_GATES))].sort((left, right) =>
        left.localeCompare(right)
      )
    );
  });

  it("counts a gate once even when two jobs prove it", () => {
    // `dependency-vulnerability` is carried by two jobs at different depths.
    // The runner's question is "does ANY job own this label", so a duplicate
    // must not become two entries and must not become zero.
    const backed = jobBackedGates() as readonly string[];
    expect(
      backed.filter(gate => gate === "dependency-vulnerability")
    ).toHaveLength(1);
  });
});

describe("needs.deps is registry-owned", () => {
  it("refuses a project that declares it, rather than ignoring it", () => {
    // Silently dropping the key is the worse failure: the operator writes
    // something that looks obeyed and is not.
    const problems = (validateGates as (gates: object) => string[])({
      "version-duplication": {
        needs: { deps: false },
        [PULL_REQUEST]: "required",
      },
    });
    expect(problems.join("\n")).toMatch(/needs\.deps is registry-owned/u);
  });

  it("still accepts the two fields a project does own", () => {
    const problems = (validateGates as (gates: object) => string[])({
      "version-duplication": {
        needs: { tools: ["gh"], secrets: ["GH_TOKEN"] },
        [PULL_REQUEST]: "required",
      },
    });
    expect(problems).toEqual([]);
  });
});

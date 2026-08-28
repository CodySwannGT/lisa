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
  resolveMoment,
  validateGates,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

/** The moment this whole subsystem is about. */
const PULL_REQUEST = "pull-request";

/** A hook moment whose façade can own a built-in prover. */
const COMMIT = "commit";

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

/** One resolved gate, as far as the provenance cases read it. */
interface Resolved {
  id: string;
  declared: string | null;
  task: string | null;
}

/** The resolver a leg is built from, typed for this suite. */
const resolveAt = resolveMoment as (options: {
  gates: object;
  moment: string;
  includeOff?: boolean;
}) => Resolved[];

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

/** A gate whose shipped prover declares `needs.deps: false`. */
const NO_INSTALL_GATE = "version-duplication";

/** That gate's registry default task — the spelling a project may also pick. */
const NO_INSTALL_TASK = "check:duplicate-versions";

/** A task no registry entry names, for the different-spelling control. */
const PROJECT_TASK = "check:versions:mine";

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

  it("emits no leg for a prover built in to the governing facade", () => {
    const gates = { "artifact-freshness": { [COMMIT]: "required" } };
    const [resolved] = resolveMoment({
      gates,
      moment: COMMIT,
      scripts: {},
    });

    expect(resolved?.mode).toBe("builtin");
    expect(legsAt({ gates, moment: COMMIT, scripts: {} })).toEqual([]);
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
      gates: { [NO_INSTALL_GATE]: { [PULL_REQUEST]: "required" } },
      moment: PULL_REQUEST,
    });
    expect(GATES[NO_INSTALL_GATE]?.needs?.deps).toBe(false);
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
        [NO_INSTALL_GATE]: {
          run: PROJECT_TASK,
          [PULL_REQUEST]: "required",
        },
      },
      moment: PULL_REQUEST,
    });
    expect(legs[0]?.task).toBe(PROJECT_TASK);
    expect(legs[0]?.install).toBe(true);
  });

  it("never asks for an install on a leg that runs nothing", () => {
    const legs = legsAt({
      gates: { [UNJOBBED]: { [PULL_REQUEST]: "off" } },
      moment: PULL_REQUEST,
    });
    expect(legs[0]?.install).toBe(false);
  });

  // CodySwannGT/lisa#3078. The case above proves the clause with a task Lisa's
  // registry does not name, which is the easy half. The provenance test used to
  // read only the RESOLVED SPELLING — `alias === null && task === registryTask`
  // — so a project whose `run:` happened to name the same script as the registry
  // default satisfied it, and Lisa's `deps: false` was honoured for a command
  // Lisa did not write. Nothing about `check:duplicate-versions` in a project's
  // package.json makes it the script Lisa ships under that name; the install was
  // skipped for it anyway and a prover needing the project's dependencies died
  // with `Cannot find module`, reading as a broken gate rather than as a claim
  // that outran its evidence. Same spelling, different provenance.
  it("installs when the project's own run: spells the registry default", () => {
    const legs = legsAt({
      gates: {
        [NO_INSTALL_GATE]: {
          run: NO_INSTALL_TASK,
          [PULL_REQUEST]: "required",
        },
      },
      moment: PULL_REQUEST,
    });
    expect(GATES[NO_INSTALL_GATE]?.task).toBe(NO_INSTALL_TASK);
    expect(legs[0]?.task).toBe(NO_INSTALL_TASK);
    expect(legs[0]?.install).toBe(true);
  });

  it("installs when a moment-level run: spells the registry default", () => {
    // The same claim declared at the narrower of the two sites `run:` is legal
    // at. Both are the project speaking, so both must defeat the claim.
    const legs = legsAt({
      gates: {
        [NO_INSTALL_GATE]: {
          [PULL_REQUEST]: {
            level: "required",
            run: NO_INSTALL_TASK,
          },
        },
      },
      moment: PULL_REQUEST,
    });
    expect(legs[0]?.install).toBe(true);
  });
});

describe("a resolved gate reports who declared its command", () => {
  // The field the two cases above are decided on. `task` cannot carry it: a
  // project `run:` and a registry default may resolve to the same string, and
  // once they have, nothing downstream can tell which one it is looking at.
  it("reports null for a gate resolved from the registry default", () => {
    const [resolved] = resolveAt({
      gates: { [NO_INSTALL_GATE]: { [PULL_REQUEST]: "required" } },
      moment: PULL_REQUEST,
    });
    expect(resolved?.task).toBe(NO_INSTALL_TASK);
    expect(resolved?.declared).toBeNull();
  });

  it("reports the project's own run: even when it spells the default", () => {
    const [resolved] = resolveAt({
      gates: {
        [NO_INSTALL_GATE]: {
          run: NO_INSTALL_TASK,
          [PULL_REQUEST]: "required",
        },
      },
      moment: PULL_REQUEST,
    });
    expect(resolved?.task).toBe(NO_INSTALL_TASK);
    expect(resolved?.declared).toBe(NO_INSTALL_TASK);
  });

  it("reports a declaration on a gate the project turned off", () => {
    // `off` runs nothing, so `task` is null — but the project still said what
    // would prove this gate, and that is a fact about the declaration rather
    // than about the resolved command. Read before the `off` branch so the
    // answer survives every mode.
    const [resolved] = resolveAt({
      gates: {
        [NO_INSTALL_GATE]: {
          run: PROJECT_TASK,
          [PULL_REQUEST]: "off",
        },
      },
      moment: PULL_REQUEST,
      includeOff: true,
    });
    expect(resolved?.task).toBeNull();
    expect(resolved?.declared).toBe(PROJECT_TASK);
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

/** The one gate two jobs prove, so the deduplication has something to bite on. */
const TWICE_PROVED = "dependency-vulnerability";

/**
 * Every gate a hand-written job posts a context for, written out.
 *
 * HARDCODED, not derived. Deriving it from `QUALITY_JOB_GATES` — which is what
 * `jobBackedGates()` reads — makes the assertion a tautology that passes for
 * any table at all, and it is the coupling this project's test rules name
 * directly. Written out, the list is the thing that notices: adding a job, or
 * deleting one during the block-by-block migration, changes which gates the
 * runner takes over, and that change has to be typed here where a reviewer
 * sees it rather than absorbed silently.
 *
 * `dependency-vulnerability` appears ONCE though two jobs prove it, which is
 * the deduplication this list also pins.
 */
const JOB_BACKED = [
  "behavior-contract",
  "build-integrity",
  "code-style",
  "code-style-slow",
  "conflict-residue",
  "coverage-adequacy",
  "credential-leakage",
  "dead-code",
  TWICE_PROVED,
  "e2e-browser",
  "e2e-native",
  "environment-reseed",
  "environment-reset",
  "format-conformance",
  "journey-coverage",
  "learnings-budget",
  "license-compliance",
  "performance-budget",
  "security-floor-integrity",
  "state-classification",
  "static-security",
  "structural-rules",
  "test-correctness",
  "test-integration",
  "test-meaningfulness",
  "test-node-suites",
  "threshold-monotonicity",
  "traceability",
  "type-correctness",
];

describe("which gates the runner leaves alone", () => {
  it("is exactly the gates a hand-written job already proves", () => {
    expect(jobBackedGates()).toEqual(JOB_BACKED);
  });

  it("counts a gate once even though two jobs prove it", () => {
    // `dependency-vulnerability` is carried by `npm_security_scan` and by
    // `snyk`, at different depths. The runner's question is "does ANY job own
    // this label", so a duplicate must not become two entries or zero.
    expect(JOB_BACKED.filter(gate => gate === TWICE_PROVED)).toHaveLength(1);
    expect(
      Object.values(QUALITY_JOB_GATES).filter(gate => gate === TWICE_PROVED)
    ).toHaveLength(2);
  });
});

describe("needs.deps is registry-owned", () => {
  it("refuses a project that declares it, rather than ignoring it", () => {
    // Silently dropping the key is the worse failure: the operator writes
    // something that looks obeyed and is not.
    const problems = (validateGates as (gates: object) => string[])({
      [NO_INSTALL_GATE]: {
        needs: { deps: false },
        [PULL_REQUEST]: "required",
      },
    });
    expect(problems.join("\n")).toMatch(/needs\.deps is registry-owned/u);
  });

  it("still accepts the two fields a project does own", () => {
    const problems = (validateGates as (gates: object) => string[])({
      [NO_INSTALL_GATE]: {
        needs: { tools: ["gh"], secrets: ["GH_TOKEN"] },
        [PULL_REQUEST]: "required",
      },
    });
    expect(problems).toEqual([]);
  });
});

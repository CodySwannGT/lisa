/**
 * A gate may say how its OWN prover's failure reads, instead of the shipped
 * classifier enumerating everybody else's output.
 *
 * CodySwannGT/lisa#3974. `gate-failure-diagnosis.mjs` recognises a fixed set of
 * transcript shapes, and every shape it knows is a vitest or `tsc` form.
 * Anything else exits into the residual bucket wearing `UNPROVABLE` — the word
 * this fleet reads as *"the box, re-run it somewhere quieter"* — so a run that
 * genuinely measured a property and found it wanting is routed into the re-run
 * path, and a push-gate cycle here costs 10-12 minutes.
 *
 * **Four shapes, measured on this repository, all classifying `undiagnosed`
 * before this change:**
 *
 * | prover | gate | evidence |
 * | --- | --- | --- |
 * | `check:artifacts` | `artifact-freshness` | `scripts/run-artifact-checks.mjs` emits it |
 * | `check:plugins` | `x-plugin-artifact-sync` | `scripts/check-plugins-sync.sh` emits it |
 * | `lint:staged` | `code-style` | measured 2026-09-05 landing #3981 |
 * | `tsc` | `type-correctness` | #3946, closed by #3957 — the one that IS recognised |
 *
 * The fix cannot be a fifth entry in the shipped table. **A classifier that
 * enumerates other people's output shapes cannot converge**: each new prover a
 * project points a `run:` at re-introduces the defect once, and the cost is
 * paid by whoever hits it first. So a project declares its own prover's
 * measured-failure shape in its own config, and the shipped module carries the
 * MECHANISM and no project's vocabulary.
 *
 * ## What has teeth here
 *
 * Three properties, and the last two are the ones that stop this becoming a
 * declaration mechanism wired to nothing:
 *
 * 1. A declared shape turns `UNPROVABLE` into `FAILED` and carries the
 *    transcript lines it matched as evidence.
 * 2. **Every non-measurement guard still outranks it.** A killed, refused,
 *    interfered-with or zero-test run carrying the identical transcript still
 *    reports `UNPROVABLE`. Trading a false unknown for a false "measured and
 *    wanting" is the direction that gets a correct diff blamed for a saturated
 *    machine, and it is the constraint #3946 carried in.
 * 3. **A declaration that matches nothing changes no verdict AND is reported.**
 *    A mechanism wired to a field nothing reads passes exactly the way the
 *    current absence passes — silently.
 *
 * Fixtures are the real emitted strings, read off the scripts that print them
 * and off a transcript measured on this machine, rather than invented shapes. A
 * classifier tested against text nobody emits proves nothing about the text
 * everybody sees.
 * @module tests/unit/scripts/gate-declared-failure-shapes
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  declaredFailure,
  DIAGNOSIS,
  diagnoseFailure,
} from "../../../all/copy-overwrite/scripts/lib/gate-failure-diagnosis.mjs";
import {
  FAILURE_SHAPE_FIELD,
  resolveMoment,
  validateGates,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import {
  runGates,
  STATE,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import { COMMIT, RUNNER, sink } from "./lisa-run-gates-fixtures.js";

/** One classified failure, typed at the boundary of the untyped `.mjs`. */
type Diagnosis = {
  kind: string;
  summary: string;
  evidence: string[];
  proves: string | null;
};

/** One gate's row in a completed run, typed at the same boundary. */
type GateResults = {
  results: { id: string; state: string; detail: string }[];
};

/** One resolved gate entry, narrowed to what these cases read. */
type ResolvedGate = { id: string; failureShape: string[] | null };

/** `.lisa.config.json`, narrowed to the block these cases read. */
type LisaConfig = {
  gates: Record<string, Record<string, unknown>>;
};

/**
 * The shape this repository declares for one gate at one moment.
 * @param config - The parsed config
 * @param gate - Gate id
 * @param moment - Moment key
 * @returns The declared shapes, or undefined when the moment declares none
 */
function shapeAt(
  config: LisaConfig,
  gate: string,
  moment: string
): string[] | undefined {
  const entry = config.gates[gate]?.[moment];
  if (typeof entry !== "object" || entry === null) return undefined;
  return (entry as Record<string, string[] | undefined>)[FAILURE_SHAPE_FIELD];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

const ARTIFACTS_GATE = "artifact-freshness";
const ARTIFACTS_TASK = "check:artifacts";
const PLUGINS_GATE = "x-plugin-artifact-sync";
const PLUGINS_TASK = "check:plugins";

/**
 * `scripts/run-artifact-checks.mjs` prints this on any failing sub-check.
 *
 * The shape a project would declare is the leading clause, without the names
 * that follow, because which sub-check failed is what varies run to run.
 */
const ARTIFACTS_SHAPE =
  "check:artifacts FAILED, and these are the checks that failed:";

/** `scripts/check-plugins-sync.sh` line 118, verbatim. */
const PLUGINS_SHAPE =
  "✗ Generated plugin artifacts are out of sync with plugins/src.";

/** A transcript from a real `check:artifacts` refusal. */
const ARTIFACTS_OUTPUT = [
  "$ node scripts/check-generated-artifact-merge-coverage.mjs",
  "generated-artifact merge coverage: 4 artifact(s) declared, 2 merge-driver covered.",
  `${ARTIFACTS_SHAPE} upstream-evidence-manifest`,
].join("\n");

/**
 * The `check:plugins` transcript quoted verbatim in #3974, from #3891.
 *
 * The four file lines are the point: the transcript named every offending file
 * and the one-line remedy, and the verdict said nothing was established.
 */
const PLUGINS_OUTPUT = [
  PLUGINS_SHAPE,
  "",
  "  Files that changed after rebuilding from source:",
  "     M plugins/lisa-agy/hooks/block-managed-file-edits.sh",
  "     M plugins/lisa/hooks/block-managed-file-edits.sh",
].join("\n");

/** One declaration, as the runner assembles it from config. */
const ARTIFACTS_DECLARATION = [
  { gate: ARTIFACTS_GATE, shape: [ARTIFACTS_SHAPE] },
];

/**
 * Diagnose one transcript with the machine readings suppressed.
 *
 * `null` for load and temp-root keeps the output deterministic, and the `read`
 * stub keeps the doc-comment scan off the real filesystem.
 * @param output - What the prover printed
 * @param code - The exit code it left
 * @returns The classification
 */
function diagnose(output: string, code = 1): Diagnosis {
  return diagnoseFailure(output, code, null, () => null, null) as Diagnosis;
}

/**
 * Run one gate against a recorded transcript and read the operator's view.
 * @param options - The gate id, its declared shape, and what the prover did
 * @returns The printed transcript and this gate's row
 */
function runWith(options: {
  gate: string;
  task: string;
  shape?: string[];
  output: string;
  code?: number;
}): {
  transcript: string;
  entry: { state: string; detail: string } | undefined;
} {
  const { lines, out } = sink();
  const declaration =
    options.shape === undefined ? {} : { [FAILURE_SHAPE_FIELD]: options.shape };
  const result = runGates({
    gates: {
      [options.gate]: {
        [COMMIT]: { level: "required", run: options.task, ...declaration },
      },
    },
    moment: COMMIT,
    runner: RUNNER,
    exec: () => ({ code: options.code ?? 1, output: options.output }),
    out,
  });
  return {
    transcript: lines.join("\n"),
    entry: (result as GateResults).results.find(row => row.id === options.gate),
  };
}

describe("the defect: four provers, one residual bucket", () => {
  it("classifies a check:artifacts refusal as undiagnosed without a declaration", () => {
    // The control. Every case below is a departure from THIS.
    expect(diagnose(ARTIFACTS_OUTPUT).kind).toBe(DIAGNOSIS.UNDIAGNOSED);
  });

  it("classifies a check:plugins refusal as undiagnosed without a declaration", () => {
    expect(diagnose(PLUGINS_OUTPUT).kind).toBe(DIAGNOSIS.UNDIAGNOSED);
  });
});

describe("a declared shape is a measurement", () => {
  it("classifies as declared-failure and attributes to the gate that declared it", () => {
    const verdict = declaredFailure(
      ARTIFACTS_OUTPUT,
      ARTIFACTS_DECLARATION
    ) as Diagnosis | null;

    expect(verdict?.kind).toBe(DIAGNOSIS.DECLARED_FAILURE);
    expect(verdict?.proves).toBe(ARTIFACTS_GATE);
  });

  it("carries the matching transcript lines as evidence, exactly", () => {
    // Exact rather than toContain: the evidence line is what the operator
    // reads instead of scrolling, so a line carrying trailing garbage is a
    // defect toContain cannot see.
    const verdict = declaredFailure(
      ARTIFACTS_OUTPUT,
      ARTIFACTS_DECLARATION
    ) as Diagnosis | null;

    expect(verdict?.evidence).toEqual([
      `${ARTIFACTS_SHAPE} upstream-evidence-manifest`,
    ]);
  });

  it("returns null when no declared shape appears in the transcript", () => {
    expect(declaredFailure(PLUGINS_OUTPUT, ARTIFACTS_DECLARATION)).toBeNull();
  });

  it("returns null when nothing was declared at all", () => {
    expect(declaredFailure(ARTIFACTS_OUTPUT, [])).toBeNull();
  });
});

describe("end to end: the verdict word the operator acts on", () => {
  it("reads FAILED for a declared artifact-freshness shape", () => {
    const { entry } = runWith({
      gate: ARTIFACTS_GATE,
      task: ARTIFACTS_TASK,
      shape: [ARTIFACTS_SHAPE],
      output: ARTIFACTS_OUTPUT,
    });

    expect(entry?.state).toBe(STATE.FAILED);
  });

  it("never prints the word this fleet reads as 're-run it'", () => {
    const { transcript } = runWith({
      gate: ARTIFACTS_GATE,
      task: ARTIFACTS_TASK,
      shape: [ARTIFACTS_SHAPE],
      output: ARTIFACTS_OUTPUT,
    });

    expect(transcript).not.toContain("NOT PROVED");
    expect(transcript).not.toContain("no recognised failure signature");
  });

  it("puts the offending sub-check in the operator's transcript", () => {
    const { transcript } = runWith({
      gate: ARTIFACTS_GATE,
      task: ARTIFACTS_TASK,
      shape: [ARTIFACTS_SHAPE],
      output: ARTIFACTS_OUTPUT,
    });

    expect(transcript).toContain("upstream-evidence-manifest");
  });

  it("reads FAILED for a declared x-plugin-artifact-sync shape", () => {
    // The ticket's own provenance case, and a CUSTOM gate — the mechanism must
    // work for the `x-` gates a project invents, since those are exactly the
    // ones the shipped classifier can never know about.
    const { entry } = runWith({
      gate: PLUGINS_GATE,
      task: PLUGINS_TASK,
      shape: [PLUGINS_SHAPE],
      output: PLUGINS_OUTPUT,
    });

    expect(entry?.state).toBe(STATE.FAILED);
  });

  it("still reads NOT PROVED for the same transcript undeclared", () => {
    // The bite. Same gate, same output, declaration removed.
    const { entry } = runWith({
      gate: ARTIFACTS_GATE,
      task: ARTIFACTS_TASK,
      output: ARTIFACTS_OUTPUT,
    });

    expect(entry?.state).toBe(STATE.UNPROVABLE);
  });
});

describe("the constraint carried in from #3946: non-measurement keeps its word", () => {
  it("a killed run carrying the declared shape is still not a failure", () => {
    // A kill is legible only in the exit code, and the transcript below it
    // describes the interruption rather than the code. 143 is 128 + SIGTERM.
    const { entry } = runWith({
      gate: ARTIFACTS_GATE,
      task: ARTIFACTS_TASK,
      shape: [ARTIFACTS_SHAPE],
      output: ARTIFACTS_OUTPUT,
      code: 143,
    });

    expect(entry?.state).toBe(STATE.KILLED);
    expect(entry?.state).not.toBe(STATE.FAILED);
  });

  it("a resource refusal carrying the declared shape is still not a failure", () => {
    const { entry } = runWith({
      gate: ARTIFACTS_GATE,
      task: ARTIFACTS_TASK,
      shape: [ARTIFACTS_SHAPE],
      output: `Error: spawn EAGAIN\n  at setpgid\n${ARTIFACTS_OUTPUT}`,
    });

    expect(entry?.state).toBe(STATE.UNPROVABLE);
    expect(entry?.state).not.toBe(STATE.FAILED);
  });

  it("an interfered-with run carrying the declared shape is still not a failure", () => {
    const { entry } = runWith({
      gate: ARTIFACTS_GATE,
      task: ARTIFACTS_TASK,
      shape: [ARTIFACTS_SHAPE],
      output: [
        `ENOENT: no such file or directory, open '/tmp/coverage/.tmp/coverage-0.json'`,
        ARTIFACTS_OUTPUT,
      ].join("\n"),
    });

    expect(entry?.state).toBe(STATE.UNPROVABLE);
    expect(entry?.state).not.toBe(STATE.FAILED);
  });

  it("a passing command is never turned into a failure by a declaration", () => {
    // The declaration is consulted on a NON-ZERO exit only. A prover that
    // exits 0 while its output happens to carry the declared words has proved
    // the property, and inventing a failure there would be this change's own
    // version of the defect it fixes.
    const { entry } = runWith({
      gate: ARTIFACTS_GATE,
      task: ARTIFACTS_TASK,
      shape: [ARTIFACTS_SHAPE],
      output: ARTIFACTS_OUTPUT,
      code: 0,
    });

    expect(entry?.state).toBe(STATE.PASSED);
  });
});

describe("rejection control: a declaration that matches nothing", () => {
  it("changes no verdict", () => {
    const { entry } = runWith({
      gate: ARTIFACTS_GATE,
      task: ARTIFACTS_TASK,
      shape: ["a sentence this prover has never printed"],
      output: ARTIFACTS_OUTPUT,
    });

    expect(entry?.state).toBe(STATE.UNPROVABLE);
  });

  it("is reported rather than silently inert", () => {
    // A mechanism wired to a field nothing reads passes exactly the way the
    // current absence passes. The operator must be told their declaration was
    // consulted and did not match, or a typo'd shape is indistinguishable from
    // no shape at all.
    const { transcript } = runWith({
      gate: ARTIFACTS_GATE,
      task: ARTIFACTS_TASK,
      shape: ["a sentence this prover has never printed"],
      output: ARTIFACTS_OUTPUT,
    });

    expect(transcript).toContain("declared failure shape");
    expect(transcript).toContain("matched");
  });

  it("says nothing about declarations when a gate declared none", () => {
    // The report is about a declaration that did not work. A gate with no
    // declaration has nothing to report, and printing a line about the absent
    // mechanism on every unrecognised failure is noise.
    const { transcript } = runWith({
      gate: ARTIFACTS_GATE,
      task: ARTIFACTS_TASK,
      output: ARTIFACTS_OUTPUT,
    });

    expect(transcript).not.toContain("declared failure shape");
  });
});

describe("the unrecognised verdict says what it is, and what to do", () => {
  it("still leads with the phrase two other suites pin", () => {
    expect(diagnose(ARTIFACTS_OUTPUT).summary).toContain(
      "no recognised failure signature"
    );
  });

  it("says the output was not read rather than that nothing happened", () => {
    // The lead clause is a statement about LISA, not about the code. A skim
    // that reads it as "fine" is the failure mode of a closed-world classifier.
    expect(diagnose(ARTIFACTS_OUTPUT).summary).toContain("could not read");
  });

  it("points the operator at the one action that worked, twice, tonight", () => {
    // Measured 2026-09-05: both refusals named their defect the moment the
    // check was run directly rather than through the gate's classifier.
    expect(diagnose(ARTIFACTS_OUTPUT).summary).toContain("on its own");
  });
});

describe("the shipped module gains no project's vocabulary", () => {
  /** The classifier every consumer installs. */
  const MODULE = "all/copy-overwrite/scripts/lib/gate-failure-diagnosis.mjs";

  it("names no Lisa-only prover or artifact", () => {
    // The objection this ticket opens with. A Lisa-repo-specific pattern in a
    // module every consumer installs is the same defect as a Lisa-repo-specific
    // gate in the shipped registry.
    const source = readFileSync(path.join(REPO_ROOT, MODULE), "utf8");

    for (const token of [
      ARTIFACTS_SHAPE,
      PLUGINS_SHAPE,
      "check:plugins",
      "plugins/src",
    ]) {
      expect(source, `${MODULE} must not carry "${token}"`).not.toContain(
        token
      );
    }
  });
});

describe("the declaration is config, and config is validated", () => {
  it("resolves onto the gate entry the runner reads", () => {
    const [entry] = resolveMoment({
      gates: {
        [ARTIFACTS_GATE]: {
          [COMMIT]: {
            level: "required",
            run: ARTIFACTS_TASK,
            [FAILURE_SHAPE_FIELD]: [ARTIFACTS_SHAPE],
          },
        },
      },
      moment: COMMIT,
      runner: RUNNER,
    }) as ResolvedGate[];

    expect(entry?.failureShape).toEqual([ARTIFACTS_SHAPE]);
  });

  it("reports null for a gate that declared nothing", () => {
    const [entry] = resolveMoment({
      gates: {
        [ARTIFACTS_GATE]: {
          [COMMIT]: { level: "required", run: ARTIFACTS_TASK },
        },
      },
      moment: COMMIT,
      runner: RUNNER,
    }) as ResolvedGate[];

    expect(entry?.failureShape).toBeNull();
  });

  it("accepts a well-formed declaration", () => {
    expect(
      validateGates({
        [ARTIFACTS_GATE]: {
          [COMMIT]: {
            level: "required",
            [FAILURE_SHAPE_FIELD]: [ARTIFACTS_SHAPE],
          },
        },
      })
    ).toEqual([]);
  });

  it("refuses an empty string, which would match every line", () => {
    // The declaration that cannot fail. An empty needle matches every
    // transcript, so every unrecognised failure would report FAILED against
    // whichever gate declared it — the inverse defect, shipped by accident.
    const problems = validateGates({
      [ARTIFACTS_GATE]: {
        [COMMIT]: { level: "required", [FAILURE_SHAPE_FIELD]: [""] },
      },
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(FAILURE_SHAPE_FIELD);
  });

  it("refuses a non-array declaration", () => {
    const problems = validateGates({
      [ARTIFACTS_GATE]: {
        [COMMIT]: { level: "required", [FAILURE_SHAPE_FIELD]: ARTIFACTS_SHAPE },
      },
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(FAILURE_SHAPE_FIELD);
  });

  it("refuses an empty array, which declares nothing while looking configured", () => {
    const problems = validateGates({
      [ARTIFACTS_GATE]: {
        [COMMIT]: { level: "required", [FAILURE_SHAPE_FIELD]: [] },
      },
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(FAILURE_SHAPE_FIELD);
  });

  it("refuses the field at the gate level, pointing one moment down", () => {
    // The first draft of this change put it on the gate, reasoning that output
    // shape is a property of the prover. Two facts overruled it: a gate's
    // prover already varies by moment (`lint:staged` at commit, `lint` at
    // pull-request), and `GATE_FIELDS` is a CLOSED allowlist, so an older Lisa
    // refuses an unknown gate-level key AND THE WHOLE GATES BLOCK WITH IT.
    const problems = validateGates({
      [ARTIFACTS_GATE]: {
        [FAILURE_SHAPE_FIELD]: [ARTIFACTS_SHAPE],
        [COMMIT]: "required",
      },
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(FAILURE_SHAPE_FIELD);
    expect(problems[0]).toContain(COMMIT);
  });

  it("says WHY the gate level is refused, since the cost is not local", () => {
    // The refusal has to carry the older-Lisa consequence, because nothing an
    // author can see from their own tree reveals it: the declaration validates
    // here and un-configures every job in CI, where the quality facade
    // resolves the PACKAGED resolver first. Measured against
    // node_modules/@codyswann/lisa: `Invalid gates configuration` and every
    // facade reading configured=false.
    const [problem] = validateGates({
      [ARTIFACTS_GATE]: {
        [FAILURE_SHAPE_FIELD]: [ARTIFACTS_SHAPE],
        [COMMIT]: "required",
      },
    });

    expect(problem).toContain("older Lisa");
  });
});

describe("this repository declares the shapes it measured", () => {
  it("declares one for every prover whose refusal was seen as UNPROVABLE", () => {
    const config = JSON.parse(
      readFileSync(path.join(REPO_ROOT, ".lisa.config.json"), "utf8")
    ) as LisaConfig;

    // Hardcoded per the Test Isolation house rule. These are the three shapes
    // measured on this repository; `type-correctness` is absent because #3957
    // recognises `tsc` in the shipped classifier already.
    expect(shapeAt(config, ARTIFACTS_GATE, COMMIT)).toEqual([ARTIFACTS_SHAPE]);
    expect(shapeAt(config, PLUGINS_GATE, "push")).toEqual([PLUGINS_SHAPE]);
    // At COMMIT and not at pull-request: `lint:staged` prints lint-staged's own
    // `✖ <task>` banner and `lint` does not, which is the concrete reason this
    // field is per-moment rather than per-gate.
    expect(shapeAt(config, "code-style", COMMIT)).toEqual(["✖ eslint"]);
    expect(shapeAt(config, "code-style", "pull-request")).toBeUndefined();
  });
});

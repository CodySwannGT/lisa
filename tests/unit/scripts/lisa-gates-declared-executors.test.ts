/**
 * A declaration with nothing able to run it must be refused, for everyone.
 *
 * #2843 fixed the two measured instances and said plainly what it had not
 * fixed: "nothing validates that a declaration has something able to execute
 * it. Any project — this one included, tomorrow — can add a gate at
 * `pull-request` that no job resolves, get a clean `validate`, and receive
 * silence."
 *
 * The check did exist. It was `tests/unit/config/declared-gate-executors`,
 * moment-aware and correct, reading THIS repository's own `.lisa.config.json`
 * — a vitest suite, not a validator. So the check existed for Lisa and did not
 * exist for anyone Lisa ships to. This suite is about the shipped classifier
 * that closes that gap.
 *
 * @module tests/unit/scripts/lisa-gates-declared-executors
 */

import * as fs from "fs-extra";
import { spawnSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ADVISORY_PROVERS,
  classifyDeclaredExecutors,
  contextsFor,
  EXECUTOR_VERDICTS,
  PROVED_OUTSIDE_FACADE,
  QUALITY_JOB_GATES,
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

/** The settings file `validate` reads. */
const CONFIG_FILE = ".lisa.config.json";

/** The moment whose executor is a hand-written CI job. */
const PULL_REQUEST = "pull-request";

/** A moment whose executor is the generic hook runner. */
const PUSH = "push";

/** A hook moment whose façade can own a built-in prover. */
const COMMIT = "commit";

/** The gate #2843 withdrew because its only prover cannot fail. */
const ADVISORY_GATE = "version-duplication";

/** A gate a real job resolves at pull-request. */
const EXECUTABLE_GATE = "conflict-residue";

/** A gate legal at pull-request that no job resolves. */
const ORPHAN_GATE = "generative-testing";

/** The verdict for a declaration nothing at that moment can execute. */
const ORPHANED = "orphaned";

/** The advisory workflow that cannot fail, named in the refusal. */
const ADVISORY_WORKFLOW = "duplicate-versions.yml";

/**
 * The verdicts one gates block produces, keyed `gate@moment`.
 * @param gates The gates block.
 * @param scripts The project's package scripts, or null when unknown.
 * @returns Verdict per finding.
 */
const verdicts = (
  gates: object,
  scripts: Record<string, string> | null = {}
): Record<string, string> =>
  Object.fromEntries(
    classifyDeclaredExecutors({ gates, scripts }).map(finding => [
      `${finding.gate}@${finding.moment}`,
      finding.verdict,
    ])
  );

describe("classifyDeclaredExecutors", () => {
  it("names only verdicts the module publishes", () => {
    const found = classifyDeclaredExecutors({
      gates: {
        [ORPHAN_GATE]: { [PULL_REQUEST]: "required" },
        [ADVISORY_GATE]: { [PULL_REQUEST]: "required" },
      },
      scripts: {},
    });

    expect(found.length).toBeGreaterThan(0);
    for (const finding of found) {
      expect(EXECUTOR_VERDICTS).toContain(finding.verdict);
    }
  });

  it("calls a pull-request declaration no job resolves an orphan", () => {
    expect(verdicts({ [ORPHAN_GATE]: { [PULL_REQUEST]: "required" } })).toEqual(
      {
        [`${ORPHAN_GATE}@${PULL_REQUEST}`]: ORPHANED,
      }
    );
  });

  it("says nothing about a pull-request declaration a job does resolve", () => {
    // The other direction, without which the check could satisfy the case
    // above by calling everything an orphan.
    expect(Object.values(QUALITY_JOB_GATES)).toContain(EXECUTABLE_GATE);
    expect(
      verdicts({ [EXECUTABLE_GATE]: { [PULL_REQUEST]: "required" } })
    ).toEqual({});
  });

  it("names the moment and the gate id in the message", () => {
    const [finding] = classifyDeclaredExecutors({
      gates: { [ORPHAN_GATE]: { [PULL_REQUEST]: "required" } },
      scripts: {},
    });

    expect(finding?.gate).toBe(ORPHAN_GATE);
    expect(finding?.moment).toBe(PULL_REQUEST);
    expect(finding?.detail).toContain(ORPHAN_GATE);
    expect(finding?.detail).toContain(PULL_REQUEST);
  });

  it("refuses a required level in front of an advisory prover", () => {
    // "Wired to a job that reports findings and always exits 0." A required
    // declaration there is a guarantee of nothing.
    expect(Object.keys(ADVISORY_PROVERS)).toContain(ADVISORY_GATE);
    expect(
      verdicts({ [ADVISORY_GATE]: { [PULL_REQUEST]: "required" } })
    ).toEqual({ [`${ADVISORY_GATE}@${PULL_REQUEST}`]: "vacuous-prover" });
  });

  it("names the advisory prover as the reason", () => {
    const [finding] = classifyDeclaredExecutors({
      gates: { [ADVISORY_GATE]: { [PULL_REQUEST]: "required" } },
      scripts: {},
    });

    expect(finding?.detail).toContain(ADVISORY_WORKFLOW);
    expect(finding?.detail).toContain("advisory");
  });

  it("separates a moment family with no runner from a declaration with no executor", () => {
    // A moment-unaware version rediscovers "nothing runs gates at deploy time"
    // and files it as an orphan, which is a different issue with its own
    // ticket. The verdict is distinct so it can be reported as itself.
    expect(
      verdicts({ [EXECUTABLE_GATE]: { "pre-deploy:production": "required" } })
    ).toEqual({
      [`${EXECUTABLE_GATE}@pre-deploy:production`]: "no-runner-for-moment",
    });
  });

  it("distinguishes an executor outside the façade from no executor", () => {
    // `conflict-residue` WAS this case: proved by a step inside a
    // multi-purpose workflow, and a classifier without this verdict would have
    // called it an orphan and implied the property was unenforced. It was not.
    //
    // The shipped table is EMPTY today — its one member was retired by being
    // given a real job — so the branch is exercised through the seam rather
    // than left unreached. A branch nothing can reach is a branch nothing
    // tests.
    const found = classifyDeclaredExecutors({
      gates: { [ORPHAN_GATE]: { [PULL_REQUEST]: "required" } },
      scripts: {},
      outsideFacade: { [ORPHAN_GATE]: "a step inside another workflow's job" },
    });

    expect(Object.keys(PROVED_OUTSIDE_FACADE)).toEqual([]);
    expect(found[0]?.verdict).toBe("outside-facade");
    expect(found[0]?.detail).toContain("IS enforced");
  });

  it("falls back to orphaned when nothing claims the property elsewhere", () => {
    // The seam must not turn every orphan into "proved elsewhere". Same gate,
    // empty table, opposite verdict.
    expect(
      classifyDeclaredExecutors({
        gates: { [ORPHAN_GATE]: { [PULL_REQUEST]: "required" } },
        scripts: {},
        outsideFacade: {},
      })[0]?.verdict
    ).toBe(ORPHANED);
  });

  it("calls a hook-moment declaration with no such script an orphan", () => {
    expect(
      verdicts({ "type-correctness": { [PUSH]: "required" } }, {})
    ).toEqual({ [`type-correctness@${PUSH}`]: "orphaned" });
  });

  it("accepts a hook declaration proved by the facade built-in", () => {
    expect(
      verdicts({ "credential-leakage": { [COMMIT]: "required" } }, {})
    ).toEqual({});
  });

  it("says nothing when the project ships the task", () => {
    expect(
      verdicts(
        { "type-correctness": { [PUSH]: "required" } },
        { typecheck: "tsc --noEmit" }
      )
    ).toEqual({});
  });

  it("reports nothing from a manifest it could not read", () => {
    // `null` is a THIRD answer, distinct from `{}`. A manifest this process
    // cannot read must never make every hook-moment declaration look like an
    // orphan.
    expect(
      verdicts({ "type-correctness": { [PUSH]: "required" } }, null)
    ).toEqual({});
  });

  it("does not demand an executor for a gate declared off", () => {
    // `off` is the one route that removes the required context along with the
    // job, which is what makes it the safe alternative to `skip_jobs`. A check
    // insisting on an executor for it would push operators back onto the
    // unsafe one.
    expect(verdicts({ [ORPHAN_GATE]: { [PULL_REQUEST]: "off" } })).toEqual({});
  });

  it("does not demand an executor for an awaited declaration", () => {
    // An awaited gate's prover is an external app, which is the entire meaning
    // of awaiting. There must be no Lisa job posting that context — that would
    // be Lisa marking its own homework.
    expect(
      verdicts({
        "code-review": {
          [PULL_REQUEST]: { level: "required", await: "CodeRabbit" },
        },
      })
    ).toEqual({});
  });
});

describe("a required level can never derive a context nobody posts", () => {
  it("derives a context for the orphan, which is why validation must refuse it", () => {
    // The pairing, stated as one assertion so the argument is not split across
    // two suites: `contextsFor` DOES derive a context for a gate no job
    // resolves — the #2476 shape, where a one-word edit from optional to
    // required holds every pull request at "Expected — Waiting for status to
    // be reported" indefinitely — and the classifier is what stops the
    // declaration ever reaching a ruleset.
    const derived = contextsFor(
      { [ORPHAN_GATE]: { [PULL_REQUEST]: "required" } },
      { moment: PULL_REQUEST }
    );

    expect(derived.length).toBeGreaterThan(0);
    expect(verdicts({ [ORPHAN_GATE]: { [PULL_REQUEST]: "required" } })).toEqual(
      {
        [`${ORPHAN_GATE}@${PULL_REQUEST}`]: ORPHANED,
      }
    );
  });
});

describe("lisa-gates.mjs validate refuses an unrunnable declaration", () => {
  let workdir = "";

  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), "declared-executors-"));
    await fs.writeJson(path.join(workdir, "package.json"), {
      name: "fixture",
      version: "1.0.0",
      scripts: {},
    });
  });

  afterEach(async () => {
    await fs.remove(workdir);
  });

  /**
   * Runs `validate` in the fixture project.
   * @param gates The gates block to write.
   * @returns Exit status and combined output.
   */
  const validate = async (
    gates: object
  ): Promise<{ status: number; output: string }> => {
    await fs.writeJson(path.join(workdir, CONFIG_FILE), { gates });
    const result = spawnSync(process.execPath, [GATES, "validate"], {
      cwd: workdir,
      encoding: "utf8",
      timeout: CLI_TIMEOUT_MS,
    });
    if (result.signal !== null) {
      throw new Error(
        `validate was KILLED (${result.signal}) rather than completing.`
      );
    }
    return {
      status: result.status ?? -1,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    };
  };

  it("exits non-zero on a pull-request gate no job resolves", async () => {
    const { status, output } = await validate({
      [ORPHAN_GATE]: { [PULL_REQUEST]: "required" },
    });

    expect(status).not.toBe(0);
    expect(output).toContain("UNRUNNABLE");
    expect(output).toContain(ORPHAN_GATE);
    expect(output).toContain(PULL_REQUEST);
  });

  it("exits non-zero on a required level in front of an advisory prover", async () => {
    const { status, output } = await validate({
      [ADVISORY_GATE]: { [PULL_REQUEST]: "required" },
    });

    expect(status).not.toBe(0);
    expect(output).toContain(ADVISORY_WORKFLOW);
  });

  it("names the advisory prover only for the level that claims a guarantee", async () => {
    // The refusal is LEVEL-SCOPED: "advisory, and we know" is a coherent
    // position, and refusing it too would leave no way to declare a property
    // whose prover reports. This gate is separately an orphan at
    // pull-request — no job resolves it — so the assertion is about WHICH
    // reason is given, not about the exit status.
    const { output } = await validate({
      [ADVISORY_GATE]: { [PULL_REQUEST]: "optional" },
    });

    expect(output).not.toContain(ADVISORY_WORKFLOW);
  });

  it("accepts a declaration a real job resolves", async () => {
    const { status } = await validate({
      [EXECUTABLE_GATE]: { [PULL_REQUEST]: "required" },
    });

    expect(status).toBe(0);
  });

  it("does not block on a moment family that has no runner yet", async () => {
    // A different defect with its own issue. Blocking here would turn a report
    // about the project's governance into a report about Lisa's roadmap.
    const { status, output } = await validate({
      [EXECUTABLE_GATE]: { "pre-deploy:production": "required" },
    });

    expect(status).toBe(0);
    expect(output).toContain("inert rather than wrong");
  });
});

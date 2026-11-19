/**
 * The verdict `lisa controls attest` writes, and `lisa controls attest
 * --check`, run as the built command inside a repository Lisa was never
 * applied to (CodySwannGT/lisa#4998).
 *
 * The unit suites run the writer and the check from source. This one runs
 * the built artifact with the fixture repository as its working directory,
 * which is how the attest step calls it. It covers what the verdict exists
 * for: an operator can show it to someone else, and an edit that turns it
 * into a pass is caught by a command anyone can run.
 *
 * A verdict is written only by a run that proved each check through a real
 * commit or push in the command's own copy. A run in a folder the operator
 * named with `--workspace` starts each check's command directly, so it
 * reports and writes nothing; the last case here holds it to that.
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EVIDENCE_PATH } from "../../src/controls/evidence.js";
import type { EvidenceDocument } from "../../src/controls/evidence-types.js";
import { CONTROL_REGISTER_PATH } from "../../src/controls/register-types.js";
import {
  VERDICT_PATH,
  type Verdict,
} from "../../src/controls/verdict-types.js";
import {
  buildProofFixture,
  checks,
  F_NONE_SOURCE,
  provedGates,
  workspaceCopy,
} from "../helpers/control-proofs.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { operatorEnv } from "../support/carrier-install.js";
import {
  ATTEST_RESULT_FILES,
  repositoryState,
} from "../support/repository-state.js";

useIoLatencyBudget();

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DIST_CLI = path.join(REPO_ROOT, "dist", "index.js");

const cleanups: (() => void)[] = [];

/** A repository with one working control, and somewhere for a run's copy. */
interface Setting {
  readonly repoPath: string;
  /** The temporary folder the command is given, empty to begin with. */
  readonly tmp: string;
}

/** What one run of a built command gave. */
interface Ran {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Build F-none with one control that has a working paired proof.
 * @returns The repository and the temporary folder
 */
function setting(): Setting {
  const built = buildProofFixture(
    provedGates([{ command: checks(F_NONE_SOURCE) }])
  );
  const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "lisa-verdict-")));
  cleanups.push(built.cleanup, () =>
    rmSync(tmp, { force: true, maxRetries: 10, recursive: true })
  );
  return { repoPath: built.repoPath, tmp };
}

/**
 * Run a built `lisa controls` subcommand from inside a repository.
 * @param where - The repository
 * @param args - The subcommand and its flags
 * @returns Exit status and both streams
 */
function controls(where: Setting, args: readonly string[]): Ran {
  const child = boundedSpawnSync({
    label: `lisa controls ${args.join(" ")} (built CLI in a fixture)`,
    command: process.execPath,
    args: [DIST_CLI, "controls", ...args],
    baseMs: 30_000,
    cwd: where.repoPath,
    env: { ...operatorEnv(), LISA_SKIP_UPDATE_CHECK: "1", TMPDIR: where.tmp },
  });
  return { status: child.status, stdout: child.stdout, stderr: child.stderr };
}

/**
 * Run the built `lisa controls attest`, which makes its own copy and proves
 * the control through a real commit there.
 * @param where - The repository
 * @returns Exit status and both streams
 */
function attest(where: Setting): Ran {
  return controls(where, ["attest"]);
}

/**
 * Read one of the repository's JSON files.
 * @param where - The repository
 * @param file - The file, from the repository root
 * @returns The parsed file
 */
function jsonOf<Shape>(where: Setting, file: string): Shape {
  return JSON.parse(
    readFileSync(path.join(where.repoPath, file), "utf8")
  ) as Shape;
}

afterEach(() => {
  cleanups.splice(0).forEach(cleanup => {
    cleanup();
  });
});

describe("built lisa controls attest in a repository without Lisa", () => {
  it("writes evidence, the register and a verdict that its own check and the register's check accept", () => {
    const where = setting();

    const run = attest(where);
    const verdict = jsonOf<Verdict>(where, VERDICT_PATH);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("attest: Level 1 result: non-conforming.");
    expect(
      jsonOf<EvidenceDocument>(where, EVIDENCE_PATH).records.map(record => [
        record.id,
        record.rung,
        record.command?.slice(0, 2).join(" "),
      ])
    ).toEqual([
      ["code-style@./commit/clean/SI7", "exercised", "git commit"],
      ["code-style@./commit/violation/SI7", "exercised", "git commit"],
    ]);
    expect(
      verdict.criteria.find(each => each.criterion === "SI7")?.verdict
    ).toBe("conforming");
    expect(verdict.prevented_by).toHaveLength(76);
    expect(controls(where, ["register", "--check"]).status).toBe(0);
    expect(controls(where, ["attest", "--check"])).toMatchObject({
      status: 0,
      stderr: "",
    });
  });

  it("catches a verdict edited by hand to read conforming", () => {
    const where = setting();
    attest(where);
    const file = path.join(where.repoPath, VERDICT_PATH);
    writeFileSync(
      file,
      `${JSON.stringify(
        {
          ...jsonOf<Verdict>(where, VERDICT_PATH),
          result: "conforming",
          prevented_by: [],
        },
        null,
        2
      )}\n`
    );

    const run = controls(where, ["attest", "--check"]);

    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain(
      `${VERDICT_PATH} says the Level 1 result is "conforming"; the register and the evidence give non-conforming.`
    );
    expect(run.stderr).toContain("attest --check: FAIL. 2 differences");
  });

  it("writes the same register, evidence and verdict when the same commit is attested twice, apart from the times and what the hook printed", () => {
    const where = setting();
    const text = (file: string): string =>
      readFileSync(path.join(where.repoPath, file), "utf8");
    // A record keeps the end of what the hook printed, and the gate runner
    // prints things around a check that differ from run to run. Everything
    // else in a record must not move.
    const evidenceWithoutTimes = (): unknown =>
      jsonOf<EvidenceDocument>(where, EVIDENCE_PATH).records.map(record => ({
        ...record,
        started_at: "<time>",
        completed_at: "<time>",
        output_excerpt: "<output>",
      }));
    // The verdict's two times and its digest of the evidence follow from the
    // evidence; everything else in it must not move.
    const verdictWithoutTimes = (): unknown => {
      const verdict = jsonOf<Verdict>(where, VERDICT_PATH);
      return {
        ...verdict,
        evidence_as_of: null,
        current_until: null,
        digest: { ...verdict.digest, evidence: "", value: "" },
      };
    };

    attest(where);
    const first = [
      text(CONTROL_REGISTER_PATH),
      evidenceWithoutTimes(),
      verdictWithoutTimes(),
    ];
    attest(where);

    expect([
      text(CONTROL_REGISTER_PATH),
      evidenceWithoutTimes(),
      verdictWithoutTimes(),
    ]).toEqual(first);
  });
});

describe("built lisa controls attest --workspace", () => {
  /** What the command says, once, about a run that records nothing. */
  const REPORT_ONLY =
    /^attest: REPORT ONLY\. 1 passed, 0 failed, 0 unproved, 0 unknown\. With --workspace each check's own command is started in the folder you named and no commit or push is made, so this shows whether a check works and not whether anything runs it\. Nothing was written: no evidence, no register and no verdict, and no requirement counts as proved\. Run "lisa controls attest" without --workspace to prove the controls\.$/mu;

  /**
   * Run the built command in a copy of the repository the case made.
   * @param where - The repository
   * @param flags - Flags after the folder
   * @returns Exit status and both streams
   */
  function inNamedFolder(where: Setting, flags: readonly string[] = []): Ran {
    const copy = workspaceCopy(where.repoPath);
    cleanups.push(copy.cleanup);
    return controls(where, ["attest", "--workspace", copy.directory, ...flags]);
  }

  it("prints its results, says in one line that nothing was written, and writes no evidence, register or verdict", () => {
    const where = setting();
    const before = repositoryState(where.repoPath);

    const run = inNamedFolder(where);

    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/^passed +code-style@\. +commit /mu);
    expect(run.stdout).not.toContain("attest:");
    expect(run.stderr).toMatch(REPORT_ONLY);
    expect(run.stderr.trim().split("\n")).toHaveLength(1);
    expect(repositoryState(where.repoPath)).toEqual(before);
    expect(
      ATTEST_RESULT_FILES.filter(file =>
        existsSync(path.join(where.repoPath, file))
      )
    ).toEqual([]);
  });

  it("leaves a repository with no hook installed without a verdict, so nothing reads as proved", () => {
    const where = setting();

    inNamedFolder(where, ["--json"]);
    const check = controls(where, ["attest", "--check"]);

    expect(check.status).not.toBe(0);
    expect(check.stderr).toContain(`No verdict was found at ${VERDICT_PATH}.`);
  });

  it("does not add to, or refresh, what an earlier real run recorded", () => {
    const where = setting();
    attest(where);
    const recorded = ATTEST_RESULT_FILES.map(file =>
      readFileSync(path.join(where.repoPath, file), "utf8")
    );

    const run = inNamedFolder(where, ["--json"]);

    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ passed: true });
    expect(run.stderr).toMatch(REPORT_ONLY);
    expect(
      ATTEST_RESULT_FILES.map(file =>
        readFileSync(path.join(where.repoPath, file), "utf8")
      )
    ).toEqual(recorded);
  });
});

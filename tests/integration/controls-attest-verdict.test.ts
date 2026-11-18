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
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EVIDENCE_PATH } from "../../src/controls/evidence.js";
import type { EvidenceDocument } from "../../src/controls/evidence-types.js";
import { CONTROL_REGISTER_PATH } from "../../src/controls/register-types.js";
import {
  VERDICT_PATH,
  type Verdict,
} from "../../src/controls/verdict-types.js";
import { controlAuditGitEnv } from "../helpers/control-audit-fixtures.js";
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

useIoLatencyBudget();

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DIST_CLI = path.join(REPO_ROOT, "dist", "index.js");

const cleanups: (() => void)[] = [];

/** A repository with one working control, and a disposable copy of it. */
interface Setting {
  readonly repoPath: string;
  readonly workspace: string;
}

/**
 * Build F-none with one control that has a working paired proof.
 * @returns The repository and its copy
 */
function setting(): Setting {
  const built = buildProofFixture(
    provedGates([{ command: checks(F_NONE_SOURCE) }])
  );
  const copy = workspaceCopy(built.repoPath);
  cleanups.push(built.cleanup, copy.cleanup);
  return { repoPath: built.repoPath, workspace: copy.directory };
}

/**
 * Run a built `lisa controls` subcommand from inside a repository.
 * @param where - The repository
 * @param args - The subcommand and its flags
 * @returns Exit status and both streams
 */
function controls(
  where: Setting,
  args: readonly string[]
): {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
} {
  const child = boundedSpawnSync({
    label: `lisa controls ${args.join(" ")} (built CLI in a fixture)`,
    command: process.execPath,
    args: [DIST_CLI, "controls", ...args],
    cwd: where.repoPath,
    env: { ...controlAuditGitEnv(), LISA_SKIP_UPDATE_CHECK: "1" },
  });
  return { status: child.status, stdout: child.stdout, stderr: child.stderr };
}

/**
 * Run the built `lisa controls attest` with the repository's disposable copy.
 * @param where - The repository and its copy
 * @returns Exit status and both streams
 */
function attest(where: Setting): ReturnType<typeof controls> {
  return controls(where, ["attest", "--workspace", where.workspace]);
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
      jsonOf<EvidenceDocument>(where, EVIDENCE_PATH).records.map(
        record => record.id
      )
    ).toEqual([
      "code-style@./commit/clean/SI7",
      "code-style@./commit/violation/SI7",
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

  it("writes the same register, evidence and verdict when the same commit is attested twice, apart from the times", () => {
    const where = setting();
    const text = (file: string): string =>
      readFileSync(path.join(where.repoPath, file), "utf8");
    const evidenceWithoutTimes = (): string =>
      text(EVIDENCE_PATH).replaceAll(
        /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/gu,
        "<time>"
      );
    // The verdict's two times and its digest of the evidence follow from the
    // times in the evidence; everything else in it must not move.
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

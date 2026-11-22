/**
 * `lisa controls proof-check` and `lisa controls attest`, held to each other
 * (CodySwannGT/lisa#5011).
 *
 * `proof-check` exists so that whoever writes a pair of test changes finds
 * out, before anything is installed, whether the attest step will be able to
 * use it. That is only worth something if the two agree. So each case here
 * builds one repository, runs the two built commands on it, and compares
 * what they say about the same check:
 *
 * - a pair `proof-check` calls `ready` is one `attest` then passes, through
 *   a real commit or push with the carriers installed in its own copy;
 * - a pair `proof-check` refuses is one `attest` does not pass.
 *
 * `proof-check` starts the check's own command and installs nothing;
 * `attest` goes through git's hook, the carrier and the gate runner. They
 * share how a check is started and how its answer is read, and nothing
 * else, which is what makes the comparison a test.
 */
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ProofCheckRun } from "../../src/controls/proof-check-types.js";
import type { ProofRun } from "../../src/controls/proof-types.js";
import {
  VERDICT_PATH,
  type Verdict,
} from "../../src/controls/verdict-types.js";
import type { ControlAuditFixtureName } from "../helpers/control-audit-fixtures.js";
import {
  ACCEPTS_EVERYTHING,
  API_SOURCE,
  buildProofFixture,
  checks,
  F_NONE_SOURCE,
  FAILS_FOR_ANOTHER_REASON,
  proofFiles,
  proofPatches,
  type ProofFiles,
  provedGates,
  REJECTS_EVERYTHING,
  replaceFilePatch,
  WEB_SOURCE,
} from "../helpers/control-proofs.js";
import { configFile, type GatesBlock } from "../helpers/control-register.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { operatorEnv } from "../support/carrier-install.js";
import { repositoryState } from "../support/repository-state.js";

useIoLatencyBudget();

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DIST_CLI = path.join(REPO_ROOT, "dist", "index.js");
const NODE = process.execPath;
const LINTER = checks(F_NONE_SOURCE);
const API_LINTER = checks("src/api/greeting.py");
const WEB_LINTER = checks("src/index.ts");
const F_NONE_PATCHES = proofPatches("F-none", F_NONE_SOURCE);
const API_PATCHES = proofPatches("F-mixed", API_SOURCE);
const WEB_PATCHES = proofPatches("F-mixed", WEB_SOURCE);
const API_ENTRY = "code-style@api";
const WHOLE_ENTRY = "code-style@.";
const READY = "ready";
const NOT_READY = "not-ready";
const PASSED = "passed";

/** The requirement every check in these cases serves. */
const REQUIREMENT = "SI7";

/** Why a pair is turned away when one of its changes rewrites the check. */
const DECLARATION_CHANGED = "declaration-changed";

const cleanups: (() => void)[] = [];

/** What the two commands said about one repository. */
interface Compared {
  /** `proof-check`'s exit code. */
  readonly checkCode: number | null;
  /** `attest`'s exit code. */
  readonly attestCode: number | null;
  /** Per check: what `proof-check` called its pair, and why. */
  readonly checked: Readonly<Record<string, readonly [string, string]>>;
  /** Per check: what `attest` made of its proof. */
  readonly attested: Readonly<Record<string, string>>;
  /** Whether `proof-check` left the repository exactly as it found it. */
  readonly untouched: boolean;
  /** Per check: why `attest` gave its proof that result. */
  readonly attestedBecause: Readonly<Record<string, string>>;
  /** What the verdict `attest` wrote says of the requirement the checks serve. */
  readonly requirement: string | undefined;
}

/**
 * Run one built `lisa controls` command in a repository.
 * @param repoPath - The repository
 * @param args - The arguments after `lisa controls`
 * @param tmp - The temporary folder the command is given
 * @returns Its exit code and standard output
 */
function controls(
  repoPath: string,
  args: readonly string[],
  tmp: string
): { readonly status: number | null; readonly stdout: string } {
  const child = boundedSpawnSync({
    label: `lisa controls ${args.join(" ")} (built CLI)`,
    command: NODE,
    args: [DIST_CLI, "controls", ...args],
    baseMs: 30_000,
    cwd: repoPath,
    env: { ...operatorEnv(), LISA_SKIP_UPDATE_CHECK: "1", TMPDIR: tmp },
  });
  return { status: child.status, stdout: child.stdout };
}

/**
 * Build a repository with checks declared and their patch files committed,
 * and an empty temporary folder for the commands. Both are removed after the
 * case.
 * @param gates - The gates block
 * @param files - The patch files
 * @param name - Which fixture
 * @returns The repository and the temporary folder
 */
function setting(
  gates: GatesBlock,
  files: ProofFiles,
  name: ControlAuditFixtureName
): { readonly repoPath: string; readonly tmp: string } {
  const built = buildProofFixture(gates, files, name);
  const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "lisa-held-")));
  cleanups.push(built.cleanup, () =>
    rmSync(tmp, { force: true, maxRetries: 10, recursive: true })
  );
  return { repoPath: built.repoPath, tmp };
}

/**
 * Ask `proof-check` and then `attest` about one repository.
 * @param gates - The gates block
 * @param files - The patch files
 * @param name - Which fixture
 * @returns What each command said
 */
function compare(
  gates: GatesBlock,
  files: ProofFiles,
  name: ControlAuditFixtureName = "F-none"
): Compared {
  const { repoPath, tmp } = setting(gates, files, name);
  const before = repositoryState(repoPath);
  const check = controls(repoPath, ["proof-check"], tmp);
  const untouched =
    JSON.stringify(repositoryState(repoPath)) === JSON.stringify(before);
  const attest = controls(repoPath, ["attest", "--json"], tmp);
  const checked = JSON.parse(check.stdout) as ProofCheckRun;
  const attested = JSON.parse(attest.stdout) as ProofRun;
  return {
    checkCode: check.status,
    attestCode: attest.status,
    checked: Object.fromEntries(
      checked.parts.map(part => [part.entry_id, [part.result, part.reason]])
    ),
    attested: Object.fromEntries(
      attested.entries.map(entry => [entry.entry_id, entry.outcome])
    ),
    untouched,
    attestedBecause: Object.fromEntries(
      attested.entries.map(entry => [entry.entry_id, entry.reason])
    ),
    requirement: (
      JSON.parse(
        readFileSync(path.join(repoPath, VERDICT_PATH), "utf8")
      ) as Verdict
    ).criteria.find(each => each.criterion === REQUIREMENT)?.verdict,
  };
}

afterEach(() => {
  cleanups.splice(0).forEach(cleanup => {
    cleanup();
  });
});

describe("a pair proof-check calls ready", () => {
  it("is passed by attest, for a part of each folder at commit and a whole-repository check at push", () => {
    const held = compare(
      {
        ...provedGates([
          { scope: "api", command: API_LINTER, name: "api" },
          { scope: "web", command: WEB_LINTER, name: "web" },
        ]),
        ...provedGates(
          [{ command: checks(API_SOURCE), name: "tests" }],
          "test-correctness",
          ["push"]
        ),
      },
      {
        ...proofFiles(API_PATCHES, "api"),
        ...proofFiles(WEB_PATCHES, "web"),
        ...proofFiles(API_PATCHES, "tests"),
      },
      "F-mixed"
    );

    expect(held.checked).toEqual({
      [API_ENTRY]: [READY, READY],
      "code-style@web": [READY, READY],
      "test-correctness@.": [READY, READY],
    });
    expect(held.checkCode).toBe(0);
    expect(held.untouched).toBe(true);
    expect(held.attested).toEqual({
      [API_ENTRY]: PASSED,
      "code-style@web": PASSED,
      "test-correctness@.": PASSED,
    });
    expect(held.attestCode).toBe(0);
  });
});

describe("a pair whose violating change rewrites the check instead of breaking its rule", () => {
  it("is refused by proof-check and settles unknown in attest, for the same reason, and the requirement is not read as met", () => {
    // The check lets every change through, so it enforces nothing. Its
    // "violating change" edits the file that declares it, swapping the
    // command for one that fails with the declared failure text.
    const enforcesNothing = provedGates([{ command: ACCEPTS_EVERYTHING }]);
    const held = compare(
      enforcesNothing,
      proofFiles({
        violation: replaceFilePatch(
          ".lisa.config.json",
          configFile(enforcesNothing),
          configFile(provedGates([{ command: REJECTS_EVERYTHING }]))
        ),
        clean: F_NONE_PATCHES.clean,
      })
    );

    expect(held.checked).toEqual({
      [WHOLE_ENTRY]: [NOT_READY, DECLARATION_CHANGED],
    });
    expect(held.checkCode).toBe(1);
    expect(held.attested).toEqual({ [WHOLE_ENTRY]: "unknown" });
    expect(held.attestedBecause).toEqual({
      [WHOLE_ENTRY]: DECLARATION_CHANGED,
    });
    expect(held.attestCode).toBe(1);
    expect(held.requirement).toBe("unknown");
  });
});

describe("a pair proof-check refuses", () => {
  it("is not passed by attest when the violating change is outside the part's folder: the check never starts", () => {
    const held = compare(
      provedGates([{ scope: "api", command: API_LINTER }]),
      proofFiles({
        violation: WEB_PATCHES.violation,
        clean: API_PATCHES.clean,
      }),
      "F-mixed"
    );

    expect(held.checked).toEqual({
      [API_ENTRY]: [NOT_READY, "outside-folder"],
    });
    expect(held.checkCode).toBe(1);
    expect(held.attested).toEqual({ [API_ENTRY]: "unknown" });
    expect(held.attestCode).toBe(1);
  });

  it.each([
    {
      name: "the check passes the violating change",
      part: { command: ACCEPTS_EVERYTHING },
      files: proofFiles(F_NONE_PATCHES),
      reason: "violation-accepted",
      outcome: "failed",
    },
    {
      name: "the check fails the clean change",
      part: { command: REJECTS_EVERYTHING },
      files: proofFiles(F_NONE_PATCHES),
      reason: "clean-rejected",
      outcome: "failed",
    },
    {
      name: "the check fails without the declared text",
      part: { command: FAILS_FOR_ANOTHER_REASON },
      files: proofFiles(F_NONE_PATCHES),
      reason: "wrong-failure-text",
      outcome: "unknown",
    },
    {
      name: "no failure text is declared",
      part: { command: LINTER, failure_shape: null },
      files: proofFiles(F_NONE_PATCHES),
      reason: "no-failure-text",
      outcome: "unknown",
    },
    {
      name: "the clean change is missing",
      part: { command: LINTER },
      files: { ".lisa/controls/proofs/lint.violation.patch": "unused\n" },
      reason: "patch-missing",
      outcome: "unproved",
    },
  ])(
    "is not passed by attest when $name",
    ({ part, files, reason, outcome }) => {
      const held = compare(provedGates([part]), files);

      expect(held.checked).toEqual({ [WHOLE_ENTRY]: [NOT_READY, reason] });
      expect(held.checkCode).toBe(1);
      expect(held.attested).toEqual({ [WHOLE_ENTRY]: outcome });
      expect(held.attested[WHOLE_ENTRY]).not.toBe(PASSED);
      expect(held.attestCode).toBe(1);
    }
  );
});

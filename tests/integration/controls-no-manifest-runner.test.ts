/**
 * The shipped gate runner at the commit moment in a repository with no
 * `package.json` (CodySwannGT/lisa#4987).
 *
 * F-none is a small Python package: no manifest, no Node dependencies, no
 * hook. The real command line is started in it, the way a commit hook would
 * start it, and two things are held:
 *
 * - A declared command runs, in the repository, and its exit status decides
 *   the result: zero lets the commit through, non-zero stops it.
 * - A gate with no declared command has no way to run there, and is reported
 *   as not proved. It is never reported as passing, at any level.
 *
 * Each is checked for both kinds of caller: one with no checks of its own
 * (`--builtins=none`), and a stack template's hook (`--coverage`).
 * @module tests/integration/controls-no-manifest-runner
 */
import { type SpawnSyncReturns } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT } from "../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import { runControlAuditGit } from "../helpers/control-audit-fixtures.js";
import {
  declaredFNone,
  NO_BUILTINS,
  NODE,
  type NoManifestRepository,
  RUNNER_SCRIPT,
  runShipped,
  stackFrames,
  wholeRepositoryPart,
} from "../support/no-manifest-run.js";

const COMMIT = "commit";
const AT_COMMIT = `--moment=${COMMIT}`;
const STYLE = "code-style";

/** The three commit properties a stack template's hook checks on its own. */
const REST_OF_THE_COMMIT_FLOOR = {
  "credential-leakage": { [COMMIT]: "off" },
  "format-conformance": { [COMMIT]: "off" },
  "structural-rules": { [COMMIT]: "off" },
};

/** What the declared linter prints when it measured a failure. */
const LINT_SHAPE = "Found 1 error";

/** Writes the folder it was started in to the file named by its argument. */
const RECORD_AND_PASS =
  "require('node:fs').writeFileSync(process.argv[1], process.cwd())";

/** Records the same, then reports a failure the way a linter does. */
const RECORD_AND_FAIL = `${RECORD_AND_PASS}; console.log("${LINT_SHAPE}."); process.exit(1)`;

/** The carrier a repository on no supported project type gets. */
const STANDALONE = "a caller with no built-in checks";

/** The commit hook a stack template ships. */
const STACK_HOOK = "a stack hook";

/** The two ways a caller starts the runner at commit. */
const CALLERS = [STANDALONE, STACK_HOOK] as const;

/** One of those two callers. */
type Caller = (typeof CALLERS)[number];

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Build F-none with a gates declaration, removed when the case ends.
 * @param gates - The gates block
 * @returns The repository
 */
function declaring(gates: Record<string, unknown>): NoManifestRepository {
  const repository = declaredFNone(gates);
  cleanups.push(repository.cleanup);
  return repository;
}

/**
 * A folder outside every repository, removed when the case ends.
 * @returns The folder
 */
function outsideFolder(): string {
  const folder = mkdtempSync(path.join(tmpdir(), "lisa-no-manifest-ran-"));
  cleanups.push(() => rmSync(folder, { force: true, recursive: true }));
  return folder;
}

/**
 * F-none declaring one part at commit whose command records that it ran.
 * @param script - What the command runs
 * @param level - The gate's level at commit
 * @returns The repository, and the file the command writes
 */
function onePart(
  script: string,
  level = "required"
): { repository: NoManifestRepository; ran: string } {
  // Outside the repository, so the command's own trace is not a change to it.
  const ran = path.join(outsideFolder(), "ran.txt");
  const repository = declaring({
    [STYLE]: {
      [COMMIT]: level,
      parts: [wholeRepositoryPart([NODE, "-e", script, ran], [LINT_SHAPE])],
    },
  });
  return { ran, repository };
}

/**
 * Start the runner at commit the way one kind of caller does.
 * @param repository - The repository
 * @param caller - Which kind of caller
 * @param script - The runner to start
 * @returns The finished child, and the gates a stack hook was told were proved
 */
function atCommit(
  repository: NoManifestRepository,
  caller: Caller,
  script = RUNNER_SCRIPT
): { child: SpawnSyncReturns<string>; proved: string[] } {
  const coverage = path.join(repository.scratch, "coverage");
  const child = runShipped(repository, script, [
    AT_COMMIT,
    caller === STACK_HOOK ? `--coverage=${coverage}` : NO_BUILTINS,
  ]);
  const proved = existsSync(coverage)
    ? readFileSync(coverage, "utf8").split("\n").filter(Boolean)
    : [];
  return { child, proved };
}

describe.each(CALLERS)(
  "a declared command in a repository with no package.json, run for %s",
  caller => {
    it("runs in the repository, and a zero exit proves the gate", () => {
      const { ran, repository } = onePart(RECORD_AND_PASS);

      const { child, proved } = atCommit(repository, caller);

      expect(child.status).toBe(EXIT.PROVED);
      expect(readFileSync(ran, "utf8")).toBe(repository.fixture.repoPath);
      expect(child.stdout).toContain(`PASSED     required ${STYLE} in .`);
      expect(child.stdout).toContain("1 proved");
      expect(child.stderr).toBe("");
      expect(stackFrames(child.stdout)).toEqual([]);
      expect(proved).toEqual(caller === STACK_HOOK ? [STYLE] : []);
    });

    it("runs, and a non-zero exit fails the gate and stops the commit", () => {
      const { ran, repository } = onePart(RECORD_AND_FAIL);

      const { child, proved } = atCommit(repository, caller);

      expect(child.status).toBe(EXIT.BLOCKED);
      expect(readFileSync(ran, "utf8")).toBe(repository.fixture.repoPath);
      expect(child.stdout).toContain(`FAILED     required ${STYLE} in .`);
      expect(child.stdout).toContain("(exit 1)");
      expect(child.stdout).not.toContain("PASSED");
      expect(proved).toEqual([]);
    });

    it("leaves the repository exactly as it found it", () => {
      const { repository } = onePart(RECORD_AND_PASS);
      const root = repository.fixture.repoPath;

      atCommit(repository, caller);

      expect(runControlAuditGit(root, ["status", "--porcelain"])).toBe("");
      expect(existsSync(path.join(root, "package.json"))).toBe(false);
      expect(existsSync(path.join(root, "node_modules"))).toBe(false);
    });

    it.each([
      ["required", EXIT.BLOCKED],
      ["optional", EXIT.PROVED],
    ])(
      "reports a %s gate with no declared command as not proved, never as passing",
      (level, status) => {
        const repository = declaring({ [STYLE]: { [COMMIT]: level } });

        const { child, proved } = atCommit(repository, caller);

        expect(child.status).toBe(status);
        expect(child.stdout).toContain(`UNPROVABLE ${level} ${STYLE}`);
        expect(child.stdout).toContain(`${level} gate NOT PROVED: ${STYLE}`);
        expect(child.stdout).not.toContain("PASSED");
        expect(child.stdout).not.toContain("1 proved");
        expect(proved).toEqual([]);
      }
    );
  }
);

describe("a declaration that is wrong at another moment only", () => {
  const OWN = "x-style";
  const REFUSAL = `gates."${OWN}"."pull-request".await is declared on a gate that has parts`;

  /**
   * A gate with a part, and a second prover at pull-request that the
   * validator refuses there.
   * @returns The repository
   */
  const wrongAtPullRequest = (): NoManifestRepository =>
    declaring({
      [OWN]: {
        [COMMIT]: "required",
        "pull-request": { level: "required", await: "ci/style" },
        parts: [wholeRepositoryPart([NODE, "-e", "0"])],
      },
    });

  it("runs the commit moment, and says a problem waits at another one", () => {
    const repository = wrongAtPullRequest();

    const child = runShipped(repository, RUNNER_SCRIPT, [
      AT_COMMIT,
      NO_BUILTINS,
      `--evidence=${path.join(repository.scratch, "evidence.json")}`,
    ]);

    expect(child.stdout).toContain(
      "apply at other moments, so this run continued"
    );
    expect(child.stderr).toBe("");
    expect(child.status).toBe(EXIT.PROVED);
    expect(child.stdout).toContain(`PASSED     required ${OWN} in .`);
  });

  it("refuses the moment the problem belongs to", () => {
    const child = runShipped(wrongAtPullRequest(), RUNNER_SCRIPT, [
      "--moment=pull-request",
      NO_BUILTINS,
    ]);

    expect(child.status).toBe(EXIT.BLOCKED);
    expect(child.stderr).toContain(REFUSAL);
    expect(child.stdout).not.toContain("PASSED");
  });
});

describe("the same repository, reached other ways", () => {
  it("is not proved for an older hook either, once the rest of the commit floor is declared", () => {
    const repository = declaring({
      [STYLE]: { [COMMIT]: "required" },
      ...REST_OF_THE_COMMIT_FLOOR,
    });

    const child = runShipped(repository, RUNNER_SCRIPT, [AT_COMMIT]);

    expect(child.status).toBe(EXIT.BLOCKED);
    expect(child.stdout).toContain(`required gate NOT PROVED: ${STYLE}`);
  });

  it("runs a declared command where there is no git repository at all", () => {
    const { ran, repository } = onePart(RECORD_AND_PASS);
    rmSync(path.join(repository.fixture.repoPath, ".git"), {
      force: true,
      recursive: true,
    });

    const { child } = atCommit(repository, STANDALONE);

    expect(child.status).toBe(EXIT.PROVED);
    expect(readFileSync(ran, "utf8")).toBe(repository.fixture.repoPath);
  });

  it("runs from a copy inside the repository, with no installed package to lean on", () => {
    const { ran, repository } = onePart(RECORD_AND_FAIL);
    const copied = path.join(repository.fixture.repoPath, "scripts");
    cpSync(path.dirname(RUNNER_SCRIPT), copied, { recursive: true });

    const { child } = atCommit(
      repository,
      STANDALONE,
      path.join(copied, path.basename(RUNNER_SCRIPT))
    );

    expect(child.status).toBe(EXIT.BLOCKED);
    expect(readFileSync(ran, "utf8")).toBe(repository.fixture.repoPath);
    expect(child.stdout).toContain(`FAILED     required ${STYLE} in .`);
    expect(stackFrames(`${child.stdout}\n${child.stderr}`)).toEqual([]);
  });
});

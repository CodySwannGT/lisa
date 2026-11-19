/**
 * The gate runner's contract with a caller that has no built-in checks
 * (CodySwannGT/lisa#4987).
 *
 * A stack template's commit hook has its own checks behind the runner: a
 * secret scan, lint-staged. When the declaration is silent about one of
 * those, the runner exits 78 and the hook runs it. A repository on no
 * supported project type has no such hook and no such checks, so "run your
 * own checks instead" is an instruction nobody can follow there — a caller
 * that obeyed it would let the commit through having checked nothing.
 *
 * Such a caller passes `--builtins=none`. The runner then answers with a
 * verdict every time: 0 lets the commit or push through, anything else stops
 * it. It never answers 78.
 *
 * Every case starts the real command line, because the contract is an exit
 * code between two processes.
 * @module tests/unit/controls/lisa-run-gates-no-builtins
 */
import { type SpawnSyncReturns } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT } from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import {
  declaredFNone,
  fNoneWithConfig,
  NO_BUILTINS,
  NODE,
  type NoManifestRepository,
  RUNNER_SCRIPT,
  runShipped,
  stackFrames,
  wholeRepositoryPart,
} from "../../support/no-manifest-run.js";

const COMMIT = "commit";
const PUSH = "push";
const STYLE = "code-style";
const HISTORY = "introduced-history-credential-leakage";

/** A declared command that finds nothing wrong. */
const CLEAN = [NODE, "-e", "process.exit(0)"];

/** What the failing command prints when it has measured a failure. */
const LINT_SHAPE = "Found 1 error";

/** A declared command that finds something wrong and says so. */
const VIOLATION = [
  NODE,
  "-e",
  `console.log("${LINT_SHAPE}."); process.exit(1)`,
];

/**
 * One gate at commit, and silence about the other three properties a stack
 * template's commit hook checks on its own.
 */
const HALF_DECLARED = {
  [STYLE]: { [COMMIT]: "required", parts: [wholeRepositoryPart(CLEAN)] },
};

const FAILING = {
  [STYLE]: {
    [COMMIT]: "required",
    parts: [wholeRepositoryPart(VIOLATION, [LINT_SHAPE])],
  },
};

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Keep a repository for one case.
 * @param repository - The repository
 * @returns The same repository, removed when the case ends
 */
function kept(repository: NoManifestRepository): NoManifestRepository {
  cleanups.push(repository.cleanup);
  return repository;
}

/**
 * Run the gate runner in a repository.
 * @param repository - The repository
 * @param flags - Arguments after the script
 * @returns The finished child
 */
function runner(
  repository: NoManifestRepository,
  flags: readonly string[]
): SpawnSyncReturns<string> {
  return runShipped(repository, RUNNER_SCRIPT, flags);
}

/**
 * Run the gate runner the way a caller with no built-in checks does.
 * @param repository - The repository
 * @param moment - The moment to run
 * @param more - Further arguments
 * @returns The finished child
 */
function standalone(
  repository: NoManifestRepository,
  moment = COMMIT,
  more: readonly string[] = []
): SpawnSyncReturns<string> {
  return runner(repository, [`--moment=${moment}`, NO_BUILTINS, ...more]);
}

/**
 * The verdict the runner recorded for a run.
 * @param file - The file `--evidence` named
 * @returns The envelope's verdict
 */
function recordedVerdict(file: string): unknown {
  return (JSON.parse(readFileSync(file, "utf8")) as { verdict: unknown })
    .verdict;
}

describe("a caller with no built-in checks behind it", () => {
  it("runs what is declared even when the declaration is half-written", () => {
    const child = standalone(kept(declaredFNone(HALF_DECLARED)));

    expect(child.status).toBe(EXIT.PROVED);
    expect(child.stdout).toContain(`PASSED     required ${STYLE} in .`);
    expect(child.stdout).toContain("1 proved");
    expect(child.stderr).toBe("");
  });

  it("is told nothing about built-in checks or a task runner it does not have", () => {
    const child = standalone(kept(declaredFNone(HALF_DECLARED)));

    expect(child.stdout).not.toContain("built-in");
    expect(child.stdout).not.toContain("npm");
    expect(stackFrames(`${child.stdout}\n${child.stderr}`)).toEqual([]);
  });

  it("is stopped when a required declared command fails", () => {
    const child = standalone(kept(declaredFNone(FAILING)));

    expect(child.status).toBe(EXIT.BLOCKED);
    expect(child.stdout).toContain(`FAILED     required ${STYLE} in .`);
    expect(child.stdout).toContain("(exit 1)");
  });

  it("passes, and says nothing was checked, when no gates are declared at all", () => {
    for (const config of [null, "{}\n", '{ "gates": {} }\n']) {
      const child = standalone(kept(fNoneWithConfig(config)));

      expect(child.status).toBe(EXIT.PROVED);
      expect(child.stdout).toContain(
        `No gates are declared in .lisa.config.json, so nothing was checked at ${COMMIT}.`
      );
    }
  });

  it("passes when gates are declared, but none at this moment", () => {
    const child = standalone(kept(declaredFNone(HALF_DECLARED)), PUSH);

    expect(child.status).toBe(EXIT.PROVED);
    expect(child.stdout).toContain(
      `(the gates block declares nothing at ${PUSH})`
    );
  });

  it("is stopped when the declaration cannot be read", () => {
    const child = standalone(kept(fNoneWithConfig("{ not json")));

    expect(child.status).toBe(EXIT.RUNNER_FAILED);
    expect(child.stderr).toContain("could not read configuration");
    expect(stackFrames(child.stderr)).toEqual([]);
  });

  it("is stopped when the declaration is one the validator refuses", () => {
    const child = standalone(
      kept(declaredFNone({ "x-audit": { [COMMIT]: "required" } }))
    );

    expect(child.status).toBe(EXIT.BLOCKED);
    expect(child.stderr).toContain("the gate configuration is INVALID");
  });

  it.each([
    ["required", EXIT.BLOCKED],
    ["optional", EXIT.PROVED],
  ])(
    "is told that a gate left to a built-in check was not proved, at %s",
    (level, status) => {
      const child = standalone(
        kept(declaredFNone({ [HISTORY]: { [PUSH]: level } })),
        PUSH
      );

      expect(child.status).toBe(status);
      expect(child.stdout).toContain(`UNPROVABLE ${level} ${HISTORY}`);
      expect(child.stdout).toContain(`${level} gate NOT PROVED: ${HISTORY}`);
      expect(child.stdout).not.toContain("SKIPPED");
      expect(child.stdout).not.toContain("1 proved");
    }
  );

  it("records the verdict it reached, including the one that checked nothing", () => {
    const empty = kept(fNoneWithConfig(null));
    const declared = kept(declaredFNone(HALF_DECLARED));
    const nothing = path.join(empty.scratch, "evidence.json");
    const proved = path.join(declared.scratch, "evidence.json");

    expect(standalone(empty, COMMIT, [`--evidence=${nothing}`]).status).toBe(
      EXIT.PROVED
    );
    expect(standalone(declared, COMMIT, [`--evidence=${proved}`]).status).toBe(
      EXIT.PROVED
    );

    expect(recordedVerdict(nothing)).toBe("no-gates");
    expect(recordedVerdict(proved)).toBe("proved");
  });

  it("never answers 78, whatever is or is not declared", () => {
    const repositories = [
      fNoneWithConfig(null),
      declaredFNone(HALF_DECLARED),
      declaredFNone(FAILING),
      declaredFNone({ [STYLE]: { [COMMIT]: "required" } }),
    ].map(kept);

    for (const repository of repositories) {
      for (const moment of [COMMIT, PUSH]) {
        expect(standalone(repository, moment).status).not.toBe(EXIT.NO_GATES);
      }
    }
  });
});

describe("the flag itself", () => {
  it.each([
    ["--builtins=some", '--builtins="some"'],
    ["--builtins=", '--builtins=""'],
    ["--builtins", '--builtins=""'],
  ])("is refused when it is written %s", (flag, named) => {
    const child = runner(kept(declaredFNone(HALF_DECLARED)), [
      `--moment=${COMMIT}`,
      flag,
    ]);

    expect(child.status).toBe(EXIT.RUNNER_FAILED);
    expect(child.stderr).toContain(named);
    expect(child.stderr).toContain(NO_BUILTINS);
    expect(child.stderr).toContain("usage:");
    expect(child.stdout).not.toContain("PASSED");
  });

  it("is refused beside --coverage, which says the opposite", () => {
    const repository = kept(declaredFNone(HALF_DECLARED));
    const coverage = path.join(repository.scratch, "coverage");

    const child = standalone(repository, COMMIT, [`--coverage=${coverage}`]);

    expect(child.status).toBe(EXIT.RUNNER_FAILED);
    expect(child.stderr).toContain("--coverage");
    expect(child.stderr).toContain(NO_BUILTINS);
    expect(child.stdout).not.toContain("PASSED");
    expect(existsSync(coverage)).toBe(false);
  });
});

describe("a caller that does have built-in checks", () => {
  it("is still sent back to them by a half-written declaration", () => {
    const child = runner(kept(declaredFNone(HALF_DECLARED)), [
      `--moment=${COMMIT}`,
    ]);

    expect(child.status).toBe(EXIT.NO_GATES);
    expect(child.stdout).toContain("Running the built-in checks");
    expect(child.stdout).not.toContain("PASSED");
  });

  it("still exits 78 when there is no declaration at all", () => {
    const child = runner(kept(fNoneWithConfig(null)), [`--moment=${COMMIT}`]);

    expect(child.status).toBe(EXIT.NO_GATES);
    expect(child.stdout).not.toContain("No gates are declared");
  });

  it("still gets the declared gates run, and told which checks stay its own", () => {
    const repository = kept(declaredFNone(HALF_DECLARED));
    const coverage = path.join(repository.scratch, "coverage");

    const child = runner(repository, [
      `--moment=${COMMIT}`,
      `--coverage=${coverage}`,
    ]);

    expect(child.status).toBe(EXIT.PROVED);
    expect(child.stdout).toContain(
      "the built-in check for each of them still runs"
    );
    expect(readFileSync(coverage, "utf8")).toBe(`${STYLE}\n`);
  });

  it("still has a gate left to its built-in reported as not applicable here", () => {
    const repository = kept(
      declaredFNone({ [HISTORY]: { [PUSH]: "required" } })
    );
    const coverage = path.join(repository.scratch, "coverage");

    const child = runner(repository, [
      `--moment=${PUSH}`,
      `--coverage=${coverage}`,
    ]);

    expect(child.status).toBe(EXIT.PROVED);
    expect(child.stdout).toContain(`SKIPPED    required ${HISTORY}`);
    // The hook's own check is what proves it, so the hook is not stood down.
    expect(readFileSync(coverage, "utf8")).toBe("");
  });
});

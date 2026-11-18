/**
 * The shipped gate runner leaves out a part a change does not touch
 * (CodySwannGT/lisa#4988).
 *
 * F-mixed has two parts in separate folders, `api` and `web`. The real
 * command line is started in it after a real change, at commit and at push,
 * and what is held is what an operator sees and what the caller acts on:
 * the untouched part's command never starts, the part prints as NOT
 * APPLICABLE with its folder, and it is never counted as proved.
 * @module tests/integration/controls-part-scope-skip
 */
import { afterEach, describe, expect, it } from "vitest";

import { EXIT } from "../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import { runControlAuditGit } from "../helpers/control-audit-fixtures.js";
import { NO_BUILTINS, NODE } from "../support/no-manifest-run.js";
import {
  commitFiles,
  pushLine,
  pushRefsFile,
  stage,
} from "../support/part-scope-change.js";
import {
  coveredGates,
  declaredFMixed,
  evidenceRows,
  gitCommit,
  installCommitHook,
  partsAt,
  ran,
  runRunner,
  type ScopedRepository,
} from "../support/part-scope-run.js";

const API = "api";
const WEB = "web";
const UNUSUAL = "café menu";
const STYLE = "code-style";
const TESTS = "test-correctness";
const AT_COMMIT = "--moment=commit";
const AT_PUSH = "--moment=push";
const API_FILE = "api/src/fixture_mixed_api/new_module.py";
const WEB_FILE = "web/src/new.ts";
const NOT_APPLICABLE_WEB = /NOT APPLICABLE\s+required\s+\S+ in web /u;

const ALL_PARTS = "--parts=all";
const PUSH_REFS_ON_STDIN = "--push-refs=-";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Remove a repository when the case ends.
 * @param repository - The repository
 * @returns The same repository
 */
function tracked(repository: ScopedRepository): ScopedRepository {
  cleanups.push(repository.cleanup);
  return repository;
}

/**
 * The folders whose part was started, of the two F-mixed has.
 * @param repository - The repository
 * @returns `api`, `web`, both or neither
 */
function started(repository: ScopedRepository): string[] {
  return [API, WEB].filter(scope => ran(repository, scope));
}

/**
 * Build F-mixed declaring lint parts for `api` and `web` at commit.
 * @param scopes - The folders the gate has a part for
 * @param extraFiles - More files for the seed commit
 * @returns The repository
 */
function lintParts(
  scopes: readonly string[] = [API, WEB],
  extraFiles: Record<string, string> = {}
): ScopedRepository {
  return tracked(declaredFMixed(partsAt(STYLE, "commit", scopes), extraFiles));
}

describe.skipIf(process.platform === "win32")(
  "the gate runner on a change confined to one part",
  () => {
    it("runs no command of the other part and prints it as not applicable", () => {
      const repository = lintParts();
      stage(repository.fixture.repoPath, [API_FILE]);

      const child = runRunner(repository, [
        AT_COMMIT,
        NO_BUILTINS,
        `--evidence=${repository.evidence}`,
      ]);

      expect(child.status).toBe(EXIT.PROVED);
      expect(started(repository)).toEqual([API]);
      expect(child.stdout).toMatch(/PASSED\s+required\s+code-style in api /u);
      expect(child.stdout).toMatch(NOT_APPLICABLE_WEB);
      expect(child.stdout).not.toMatch(
        /PASSED\s+required\s+code-style in web/u
      );
      expect(child.stdout).toContain("This commit changes 1 path(s).");
      expect(child.stdout).toContain("1 proved");
      expect(child.stdout).toContain("1 not applicable here, of 2 gate(s)");
      expect(evidenceRows(repository)).toEqual([
        expect.objectContaining({ scope: API, status: "pass" }),
        expect.objectContaining({
          applicable: false,
          scope: WEB,
          status: "unknown",
        }),
      ]);
    });

    it("does the same from a real commit hook, for the files being committed", () => {
      const repository = lintParts();
      installCommitHook(repository);
      // Both are staged, and only the file named on the command line is
      // committed: git hands the hook an index holding that one change.
      stage(repository.fixture.repoPath, [API_FILE, WEB_FILE]);

      const child = gitCommit(repository, ["--message", "api only", API_FILE]);

      const output = `${child.stdout}${child.stderr}`;
      expect(child.status).toBe(0);
      expect(started(repository)).toEqual([API]);
      expect(output).toMatch(NOT_APPLICABLE_WEB);
      expect(
        runControlAuditGit(repository.fixture.repoPath, [
          "show",
          "--name-only",
          "--format=",
          "HEAD",
        ])
      ).toBe(API_FILE);
    });

    it("runs a part whose folder name holds a space and a non-ASCII letter", () => {
      const repository = lintParts([UNUSUAL, WEB], {
        [`${UNUSUAL}/menu.md`]: "soup\n",
      });
      stage(repository.fixture.repoPath, [`${UNUSUAL}/today's specials.md`]);

      const child = runRunner(repository, [AT_COMMIT, NO_BUILTINS]);

      expect(child.status).toBe(EXIT.PROVED);
      expect(ran(repository, UNUSUAL)).toBe(true);
      expect(ran(repository, WEB)).toBe(false);
      expect(child.stdout).toContain(`code-style in ${UNUSUAL} `);
      expect(child.stdout).toMatch(NOT_APPLICABLE_WEB);
    });

    it("runs every part when nothing is staged, and says why", () => {
      const repository = lintParts();

      const child = runRunner(repository, [AT_COMMIT, NO_BUILTINS]);

      expect(child.status).toBe(EXIT.PROVED);
      expect(started(repository)).toEqual([API, WEB]);
      expect(child.stdout).toContain(
        "Every part runs at commit: nothing is staged"
      );
      expect(child.stdout).toContain("2 proved");
    });

    it("runs every part when the caller asks for all of them", () => {
      const repository = lintParts();
      stage(repository.fixture.repoPath, [API_FILE]);

      const child = runRunner(repository, [AT_COMMIT, NO_BUILTINS, ALL_PARTS]);

      expect(child.status).toBe(EXIT.PROVED);
      expect(started(repository)).toEqual([API, WEB]);
      expect(child.stdout).toContain(ALL_PARTS);
    });

    it("refuses a --parts value it does not know, and runs nothing", () => {
      const repository = lintParts();
      stage(repository.fixture.repoPath, [API_FILE]);

      const child = runRunner(repository, [
        AT_COMMIT,
        NO_BUILTINS,
        "--parts=api",
      ]);

      expect(child.status).toBe(EXIT.RUNNER_FAILED);
      expect(child.stderr).toContain(ALL_PARTS);
      expect(started(repository)).toEqual([]);
    });
  }
);

describe.skipIf(process.platform === "win32")(
  "a stack hook's own check, when parts were left out",
  () => {
    const stackHook = (repository: ScopedRepository): string[] => [
      AT_COMMIT,
      `--coverage=${repository.coverage}`,
    ];

    it("stands down when a part ran and proved the gate for this change", () => {
      const repository = lintParts();
      stage(repository.fixture.repoPath, [API_FILE]);

      const child = runRunner(repository, stackHook(repository));

      expect(child.status).toBe(EXIT.PROVED);
      expect(coveredGates(repository)).toEqual([STYLE]);
    });

    it("still runs when the change touched none of the gate's parts", () => {
      const repository = lintParts();
      stage(repository.fixture.repoPath, ["shared-lint-config.json"]);

      const child = runRunner(repository, stackHook(repository));

      expect(child.status).toBe(EXIT.PROVED);
      expect(started(repository)).toEqual([]);
      expect(coveredGates(repository)).toEqual([]);
      expect(child.stdout).toContain(
        `No part of ${STYLE} applies to this change, so the built-in check for it still runs.`
      );
    });
  }
);

describe.skipIf(process.platform === "win32")(
  "the gate runner on a push confined to one part",
  () => {
    /** A gate that runs first, and reads standard input to its end. */
    const DRAINS_STANDARD_INPUT = {
      "coverage-adequacy": {
        push: "required",
        parts: [
          {
            scope: ".",
            command: [NODE, "-e", "require('node:fs').readFileSync(0)"],
          },
        ],
      },
    };

    /**
     * Build F-mixed with test parts at push and one commit touching `api`.
     * @param before - Gates that run ahead of the test parts
     * @returns The repository and the line git would hand a push hook
     */
    function pushedApiChange(before: Record<string, unknown> = {}): {
      repository: ScopedRepository;
      line: string;
    } {
      const repository = tracked(
        declaredFMixed({ ...before, ...partsAt(TESTS, "push", [API, WEB]) })
      );
      const { repoPath } = repository.fixture;
      const remote = runControlAuditGit(repoPath, ["rev-parse", "HEAD"]);
      const local = commitFiles(repoPath, [API_FILE]);
      return { line: pushLine({ local, remote }), repository };
    }

    it("leaves out the other part when handed the pushed refs in a file", () => {
      const { line, repository } = pushedApiChange();
      const refs = pushRefsFile(repository.fixture.repoPath, [line]);

      const child = runRunner(repository, [
        AT_PUSH,
        NO_BUILTINS,
        `--push-refs=${refs}`,
      ]);

      expect(child.status).toBe(EXIT.PROVED);
      expect(started(repository)).toEqual([API]);
      expect(child.stdout).toMatch(NOT_APPLICABLE_WEB);
      expect(child.stdout).toContain("This push changes 1 path(s).");
    });

    it("leaves out the other part when handed the pushed refs on standard input", () => {
      const { line, repository } = pushedApiChange();

      const child = runRunner(
        repository,
        [AT_PUSH, NO_BUILTINS, PUSH_REFS_ON_STDIN],
        line
      );

      expect(child.status).toBe(EXIT.PROVED);
      expect(started(repository)).toEqual([API]);
    });

    it("reads standard input before a gate's command can use it up", () => {
      const { line, repository } = pushedApiChange(DRAINS_STANDARD_INPUT);

      const child = runRunner(
        repository,
        [AT_PUSH, NO_BUILTINS, PUSH_REFS_ON_STDIN],
        line
      );

      expect(child.status).toBe(EXIT.PROVED);
      expect(child.stdout).toMatch(
        /PASSED\s+required\s+coverage-adequacy in \. /u
      );
      expect(started(repository)).toEqual([API]);
    });

    it("runs every part when it is not told what is being pushed", () => {
      const { repository } = pushedApiChange();

      const child = runRunner(repository, [AT_PUSH, NO_BUILTINS]);

      expect(child.status).toBe(EXIT.PROVED);
      expect(started(repository)).toEqual([API, WEB]);
      expect(child.stdout).toContain("Every part runs at push");
      expect(child.stdout).toContain("--push-refs");
    });
  }
);

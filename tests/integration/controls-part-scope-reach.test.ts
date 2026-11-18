/**
 * The shipped gate runner, on a change that reaches outside the parts that
 * ran.
 *
 * F-mixed has two parts in separate folders, `api` and `web`. A caller with
 * checks of its own stands one down on the runner's word, and it stands it
 * down for the whole commit. So what is held here is what that caller is
 * told when a part ran and passed and the change also touched a path no part
 * covers: its own check is kept. The real command line is started after a
 * real change, for each kind of caller.
 * @module tests/integration/controls-part-scope-reach
 */
import { type SpawnSyncReturns } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT } from "../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import { runControlAuditGit } from "../helpers/control-audit-fixtures.js";
import { NO_BUILTINS, NODE } from "../support/no-manifest-run.js";
import { stage } from "../support/part-scope-change.js";
import {
  coveredGates,
  declaredFMixed,
  evidenceRows,
  partsAt,
  ran,
  runRunner,
  type ScopedRepository,
} from "../support/part-scope-run.js";

const API = "api";
const WEB = "web";
const WHOLE = ".";
const STYLE = "code-style";
const AT_COMMIT = "--moment=commit";
const API_FILE = "api/src/fixture_mixed_api/new_module.py";
const OUTSIDE_FILE = "tools/b.js";
const NESTED_REPOSITORY = "vendor/engine";
const INSIDE_NESTED = "vendor/engine/src";
const NOT_APPLICABLE_WEB = /NOT APPLICABLE\s+required\s+\S+ in web /u;
const STILL_RUNS = "so the built-in check for it still runs.";
const NO_PART_APPLIES = `No part of ${STYLE} applies to this change, ${STILL_RUNS}`;
const NO_PART_FOR_OUTSIDE_FILE = `${STYLE} has no part for 1 path(s) this change touches ("${OUTSIDE_FILE}"), ${STILL_RUNS}`;

/** The three commit properties a stack hook checks besides style. */
const REST_OF_THE_COMMIT_FLOOR = {
  "credential-leakage": { commit: "off" },
  "format-conformance": { commit: "off" },
  "structural-rules": { commit: "off" },
};

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
 * Build F-mixed declaring lint parts at commit.
 * @param scopes - The folders the gate has a part for
 * @returns The repository
 */
function lintParts(scopes: readonly string[] = [API, WEB]): ScopedRepository {
  return tracked(declaredFMixed(partsAt(STYLE, "commit", scopes)));
}

describe.skipIf(process.platform === "win32")(
  "a stack hook's own check, when the change reaches outside the parts",
  () => {
    const stackHook = (repository: ScopedRepository): string[] => [
      AT_COMMIT,
      `--coverage=${repository.coverage}`,
    ];

    it("still runs when the change also touches a path outside every part", () => {
      const repository = lintParts();
      stage(repository.fixture.repoPath, [API_FILE, OUTSIDE_FILE]);

      const child = runRunner(repository, stackHook(repository));

      // The part for `api` ran and passed, and nothing looked at the other
      // file. The hook's own check is the only thing left that can.
      expect(child.status).toBe(EXIT.PROVED);
      expect(started(repository)).toEqual([API]);
      expect(coveredGates(repository)).toEqual([]);
      expect(child.stdout).toContain(NO_PART_FOR_OUTSIDE_FILE);
    });

    it("still runs when the change is not known and no part covers the whole repository", () => {
      const repository = lintParts();

      const child = runRunner(repository, stackHook(repository));

      expect(child.status).toBe(EXIT.PROVED);
      expect(started(repository)).toEqual([API, WEB]);
      expect(coveredGates(repository)).toEqual([]);
      expect(child.stdout).toContain(
        `What this change touches is not known and ${STYLE} has no part for the whole repository, ${STILL_RUNS}`
      );
    });

    it("stands down for any change when a part covers the whole repository", () => {
      const repository = lintParts([API, WHOLE]);
      stage(repository.fixture.repoPath, [API_FILE, OUTSIDE_FILE]);

      const child = runRunner(repository, stackHook(repository));

      expect(child.status).toBe(EXIT.PROVED);
      expect(coveredGates(repository)).toEqual([STYLE]);
      expect(child.stdout).not.toContain(STILL_RUNS);
    });
  }
);

describe.skipIf(process.platform === "win32")(
  "a hook that can only skip all of its own checks or none",
  () => {
    /**
     * F-mixed with the whole commit floor declared, so an older hook is
     * handed the moment and skips every check of its own on exit 0.
     * @param style - The declaration of the style gate
     * @returns The repository
     */
    const handedOver = (
      style: Record<string, unknown> = partsAt(STYLE, "commit", [API, WEB])
    ): ScopedRepository =>
      tracked(declaredFMixed({ ...style, ...REST_OF_THE_COMMIT_FLOOR }));

    /**
     * Start the runner the way a hook older than `--coverage` does.
     * @param repository - The repository
     * @returns The finished child
     */
    const olderHook = (
      repository: ScopedRepository
    ): SpawnSyncReturns<string> =>
      runRunner(repository, [AT_COMMIT, `--evidence=${repository.evidence}`]);

    it("is sent to its own checks when every part was left out", () => {
      const repository = handedOver();
      stage(repository.fixture.repoPath, [OUTSIDE_FILE]);

      const child = olderHook(repository);

      expect(started(repository)).toEqual([]);
      expect(child.stdout).toContain(NO_PART_APPLIES);
      expect(child.stdout).toContain("every built-in check runs");
      expect(child.status).toBe(EXIT.NO_GATES);
    });

    it("is sent to its own checks when a changed path is outside every part", () => {
      const repository = handedOver();
      stage(repository.fixture.repoPath, [API_FILE, OUTSIDE_FILE]);

      const child = olderHook(repository);

      expect(started(repository)).toEqual([API]);
      expect(child.stdout).toContain(NO_PART_FOR_OUTSIDE_FILE);
      expect(child.status).toBe(EXIT.NO_GATES);
      // The part that ran is still on record as having passed.
      expect(evidenceRows(repository)).toEqual([
        expect.objectContaining({ scope: API, status: "pass" }),
        expect.objectContaining({ applicable: false, scope: WEB }),
      ]);
    });

    it("is told the gates passed when every changed path is inside a part that ran", () => {
      const repository = handedOver();
      stage(repository.fixture.repoPath, [API_FILE]);

      const child = olderHook(repository);

      expect(child.status).toBe(EXIT.PROVED);
      expect(child.stdout).not.toContain(STILL_RUNS);
    });

    it("is still stopped by a part that failed, whatever else the change touches", () => {
      const repository = handedOver({
        [STYLE]: {
          commit: "required",
          parts: [{ scope: API, command: [NODE, "-e", "process.exit(1)"] }],
        },
      });
      stage(repository.fixture.repoPath, [API_FILE, OUTSIDE_FILE]);

      const child = olderHook(repository);

      expect(child.status).toBe(EXIT.BLOCKED);
      expect(child.stdout).not.toContain(STILL_RUNS);
    });
  }
);

describe.skipIf(process.platform === "win32")(
  "a caller with no checks of its own, on a change outside the parts",
  () => {
    it("lets a change outside every part through having run nothing, and says so", () => {
      const repository = lintParts();
      stage(repository.fixture.repoPath, [OUTSIDE_FILE]);

      const child = runRunner(repository, [AT_COMMIT, NO_BUILTINS]);

      expect(child.status).toBe(EXIT.PROVED);
      expect(started(repository)).toEqual([]);
      expect(child.stdout).toContain("0 proved");
      expect(child.stdout).toContain("2 not applicable here, of 2 gate(s)");
      expect(child.stdout).toContain(
        "2 part(s) this change does not touch were not run, and are counted as not applicable, never as proved."
      );
      // It has no built-in check to keep, so it is told nothing about one.
      expect(child.stdout).not.toContain(STILL_RUNS);
    });

    it("runs a part for a folder inside a nested repository that moved", () => {
      const repository = lintParts([INSIDE_NESTED, WEB]);
      const { repoPath } = repository.fixture;
      mkdirSync(path.join(repoPath, INSIDE_NESTED), { recursive: true });
      // A nested repository is one entry in the index, at its own folder.
      // Git names that entry and nothing beneath it.
      const commit = runControlAuditGit(repoPath, ["rev-parse", "HEAD"]);
      runControlAuditGit(repoPath, [
        "update-index",
        "--add",
        "--cacheinfo",
        `160000,${commit},${NESTED_REPOSITORY}`,
      ]);

      const child = runRunner(repository, [AT_COMMIT, NO_BUILTINS]);

      expect(child.stdout).toContain("This commit changes 1 path(s).");
      expect(ran(repository, INSIDE_NESTED)).toBe(true);
      expect(child.stdout).toMatch(
        /PASSED\s+required\s+code-style in vendor\/engine\/src /u
      );
      expect(child.stdout).toMatch(NOT_APPLICABLE_WEB);
      expect(child.status).toBe(EXIT.PROVED);
    });
  }
);

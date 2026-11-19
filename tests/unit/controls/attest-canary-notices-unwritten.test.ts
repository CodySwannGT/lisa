/**
 * What a canary run left on the hosting platform is said on every way out
 * of the run, not only on the one that prints results.
 *
 * A canary is a real branch and a real pull request. A run that could not
 * write its results down exits 2 and says so; before this was held here, it
 * said nothing else. So a branch the platform would not let go of, or a
 * canary the platform merged, went unmentioned on exactly the run whose
 * results were lost. The same was true of a run whose own copy could not
 * be removed afterwards. Every case runs against the platform that lives in
 * memory.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ATTEST_EXIT,
  type AttestOptions,
} from "../../../src/controls/commands/attest.js";
import { EVIDENCE_PATH } from "../../../src/controls/evidence.js";
import type { OpenProofWorkspace } from "../../../src/controls/proof-workspace.js";
import { VERDICT_PATH } from "../../../src/controls/verdict-types.js";
import {
  attestIn,
  FIRST_RUN,
  pullRequestSetting,
} from "./support/attest-pull-request-run.js";
import { standInCopy } from "./support/attest-run.js";
import { canaryPlatform } from "./support/canary-run.js";
import type { FakeCanaryPlatform } from "./support/fake-canary-platform.js";
import { removeCopies, type ProofSetting } from "./support/proof-run.js";
import { PULL_ONLY_GATES } from "./support/pull-request-run.js";
import { removeFixtures, type Run } from "./support/report-check-run.js";

const CANARIES = { pullRequestCanaries: true } as const;
const NOT_WRITTEN =
  "attest: FAIL. The proofs ran, but what they found could not be written down, so there is no verdict";
const NOT_CLEANED_UP =
  "attest: FAIL. The proofs ran, but the run could not finish cleaning up, so nothing was written down and there is no verdict";
/** How a line about a canary that was left behind begins. */
const LEFT_BEHIND = "attest: A canary of ";

/** How the line begins that says a merged canary fails the run. */
const MERGED_FAILS =
  "attest: FAIL. A canary pull request was merged into main ";

const MODES: readonly (readonly [string, AttestOptions])[] = [
  ["the table", {}],
  ["the JSON document", { json: true }],
];

afterEach(() => {
  removeCopies();
  removeFixtures();
});

/**
 * A platform that refuses to remove any branch.
 * @returns The platform
 */
function keepsBranches(): FakeCanaryPlatform {
  return canaryPlatform({
    refuse: request =>
      request.method === "DELETE" ? "Server Error" : undefined,
  });
}

/**
 * Build a repository in which one of the three result files cannot be
 * written: a folder is where the file should be.
 * @param file - The file that cannot be written, from the repository root
 * @returns The repository and its copy
 */
function unwritable(file: string): ProofSetting {
  const where = pullRequestSetting(PULL_ONLY_GATES);
  mkdirSync(path.join(where.repoPath, file), { recursive: true });
  return where;
}

/**
 * Run the command with canaries in a repository whose results cannot be
 * written down.
 * @param platform - The platform
 * @param options - The command's options beyond the canary option
 * @param file - The result file that cannot be written
 * @returns Exit code and printed lines
 */
function attestUnwritten(
  platform: FakeCanaryPlatform,
  options: AttestOptions = {},
  file: string = VERDICT_PATH
): Promise<Run> {
  return attestIn(
    unwritable(file),
    { ...CANARIES, ...options },
    { gh: platform.gh }
  );
}

/**
 * An opener whose workspace cannot be closed afterwards.
 * @param where - The repository and its copy
 * @returns The opener
 */
function cannotBeClosed(where: ProofSetting): OpenProofWorkspace {
  return async request => {
    const opened = await standInCopy(where)(request);
    return opened.problem === null
      ? {
          ...opened,
          close: () => {
            throw new Error(
              "The temporary copy the proofs ran in could not be removed (busy)."
            );
          },
        }
      : opened;
  };
}

describe("a canary the platform would not let go of, on a run that could not write its results down", () => {
  it.each(MODES)(
    "is still named on standard error beside %s, one line each, and the run exits 2",
    async (_mode, options) => {
      const platform = keepsBranches();

      const run = await attestUnwritten(platform, options);

      const left = platform.branches().filter(branch => branch !== "main");
      expect(left).toHaveLength(2);
      left.forEach(branch => {
        expect(
          run.stderr.filter(line =>
            line.includes(`the branch ${branch} still exists`)
          )
        ).toHaveLength(1);
      });
      expect(run.stderr.at(-1)).toBe(NOT_WRITTEN);
      expect(run.code).toBe(ATTEST_EXIT.NOT_RUN);
      expect(run.stdout).toEqual([]);
    }
  );

  it.each([EVIDENCE_PATH, VERDICT_PATH])(
    "is named whichever of the files could not be written: %s",
    async file => {
      const platform = keepsBranches();

      const run = await attestUnwritten(platform, {}, file);

      expect(
        run.stderr.filter(line => line.startsWith(LEFT_BEHIND))
      ).toHaveLength(2);
      expect(run.code).toBe(ATTEST_EXIT.NOT_RUN);
    }
  );

  it("is not mentioned when nothing was left behind: the run says only that nothing was written", async () => {
    const run = await attestUnwritten(canaryPlatform());

    expect(run.stderr.filter(line => line.includes("canary"))).toEqual([]);
    expect(run.stderr.at(-1)).toBe(NOT_WRITTEN);
    expect(run.code).toBe(ATTEST_EXIT.NOT_RUN);
  });
});

describe("a canary that was merged, on a run that could not write its results down", () => {
  it.each(MODES)(
    "is still named beside %s, with the line that says it fails the run",
    async (_mode, options) => {
      const platform = canaryPlatform({ mergedByTheHost: true });

      const run = await attestUnwritten(platform, options);

      expect(run.stderr[0]).toMatch(
        /^attest: Canary pull request #1 \(branch lisa-attest\/[^)]+\) was merged into main\./u
      );
      expect(
        run.stderr.filter(line => line.startsWith(MERGED_FAILS))
      ).toHaveLength(1);
      expect(run.stderr.at(-1)).toBe(NOT_WRITTEN);
      expect(run.code).toBe(ATTEST_EXIT.NOT_RUN);
    }
  );
});

describe("a canary left behind, on a run whose own copy could not be removed", () => {
  it("is still named, and the run says the proofs ran and nothing was written", async () => {
    const platform = keepsBranches();
    const where = pullRequestSetting(PULL_ONLY_GATES);

    const run = await attestIn(
      where,
      CANARIES,
      { gh: platform.gh },
      FIRST_RUN,
      cannotBeClosed(where)
    );

    expect(
      run.stderr.filter(line => line.startsWith(LEFT_BEHIND))
    ).toHaveLength(2);
    expect(run.stderr).toContain(
      "The temporary copy the proofs ran in could not be removed (busy)."
    );
    expect(run.stderr.at(-1)).toBe(NOT_CLEANED_UP);
    expect(run.code).toBe(ATTEST_EXIT.NOT_RUN);
    expect(run.stdout).toEqual([]);
  });
});

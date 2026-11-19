/**
 * What `lisa controls attest` writes down about the pull-request moment, and
 * what the verdict then says (CodySwannGT/lisa#4997, CodySwannGT/lisa#4998).
 *
 * The command asks the hosting platform about each entry enforced on pull
 * requests, and writes evidence, the register and the verdict. These cases
 * run the command the way an operator does, against a platform that lives
 * in memory, and read the three files it leaves: what the platform said has
 * to reach the evidence file exactly once, and the verdict has to follow
 * from it.
 */
import { afterEach, describe, expect, it } from "vitest";

import { ATTEST_CHECK_EXIT } from "../../../src/controls/attest-check.js";
import { ATTEST_EXIT } from "../../../src/controls/commands/attest.js";
import {
  hasBothProofHalves,
  parseProofHalfRecords,
} from "../../../src/controls/proof-halves.js";
import {
  CONTROL_REGISTER_PATH,
  type ControlRegister,
} from "../../../src/controls/register-types.js";
import type { GatesBlock } from "../../helpers/control-register.js";
import {
  AFTER_BOTH,
  attestIn,
  NEXT_DAY,
  pullRequestSetting,
} from "./support/attest-pull-request-run.js";
import {
  checkVerdict,
  evidenceIn,
  jsonOf,
  verdictIn,
} from "./support/attest-record-run.js";
import { canaryPlatform, expectNothingLeft } from "./support/canary-run.js";
import { withExecutor } from "./support/executor-fixtures.js";
import { removeCopies, type ProofSetting } from "./support/proof-run.js";
import {
  PULL_ONLY_ENTRY,
  PULL_ONLY_GATE,
  PULL_ONLY_GATES,
} from "./support/pull-request-run.js";
import { removeFixtures } from "./support/report-check-run.js";
import { of } from "./support/verdict-run.js";

/** A requirement a check answers, that a setting read where it is can meet. */
const OBSERVED_IS_ENOUGH = "AC1.3";

/** A requirement a check answers, that only a planted change can meet. */
const NEEDS_EXERCISED = "SI7";

const PULL_REQUEST = "pull-request";
const NON_CONFORMING = "non-conforming";
const CANARIES = { json: true, pullRequestCanaries: true } as const;

/** One control, enforced on pull requests only, that serves both. */
const SERVES_BOTH: GatesBlock = {
  [PULL_ONLY_GATE]: {
    ...(PULL_ONLY_GATES[PULL_ONLY_GATE] as Readonly<Record<string, unknown>>),
    criteria: [OBSERVED_IS_ENOUGH, NEEDS_EXERCISED],
  },
};

afterEach(() => {
  removeCopies();
  removeFixtures();
});

/**
 * The identifiers of the evidence records a repository holds.
 * @param where - The repository
 * @returns The identifiers, in file order
 */
function recordIds(where: ProofSetting): readonly string[] {
  return evidenceIn(where.repoPath).records.map(record => record.id);
}

/**
 * What the committed verdict says about one requirement.
 * @param where - The repository
 * @param criterion - The requirement
 * @returns The word, the reason and the rung
 */
function verdictFor(
  where: ProofSetting,
  criterion: string
): {
  readonly verdict: string;
  readonly reason: string;
  readonly rung: unknown;
} {
  const { verdict, reason, rung } = of(verdictIn(where.repoPath), criterion);
  return { verdict, reason, rung };
}

describe("lisa controls attest, after reading the platform's settings", () => {
  it("records one observed result per requirement, and the verdict reads each at that rung", async () => {
    const where = pullRequestSetting(SERVES_BOTH);
    const platform = canaryPlatform();

    await attestIn(where, { json: true }, { gh: platform.gh });

    expect(recordIds(where)).toEqual([
      `${PULL_ONLY_ENTRY}/pull-request/observed/${OBSERVED_IS_ENOUGH}`,
      `${PULL_ONLY_ENTRY}/pull-request/observed/${NEEDS_EXERCISED}`,
    ]);
    expect(evidenceIn(where.repoPath).records[0]).toMatchObject({
      rung: "observed",
      moment: PULL_REQUEST,
      result: "held",
      reason: "observed-required",
    });
    expect(verdictFor(where, OBSERVED_IS_ENOUGH)).toEqual({
      verdict: "conforming",
      reason: "control-proved",
      rung: "observed",
    });
    expect(verdictFor(where, NEEDS_EXERCISED)).toEqual({
      verdict: "unknown",
      reason: "rung-too-low",
      rung: null,
    });
  });

  it("reads non-conforming when the platform does not require the check", async () => {
    const where = pullRequestSetting(SERVES_BOTH);
    const platform = canaryPlatform({ required: [] });

    await attestIn(where, { json: true }, { gh: platform.gh });

    expect(evidenceIn(where.repoPath).records).toEqual([
      expect.objectContaining({
        result: "failed",
        reason: "observed-not-required",
      }),
      expect.objectContaining({ result: "failed" }),
    ]);
    expect(
      [OBSERVED_IS_ENOUGH, NEEDS_EXERCISED].map(
        criterion => verdictFor(where, criterion).verdict
      )
    ).toEqual([NON_CONFORMING, NON_CONFORMING]);
    expect(verdictFor(where, OBSERVED_IS_ENOUGH).reason).toBe("control-failed");
  });

  it("leaves a verdict that --check finds authentic and current", async () => {
    const where = pullRequestSetting(SERVES_BOTH);
    const platform = canaryPlatform();
    await attestIn(where, { json: true }, { gh: platform.gh });

    const check = await checkVerdict(where.repoPath, AFTER_BOTH);

    expect(check.stderr).toEqual([]);
    expect(check.code).toBe(ATTEST_CHECK_EXIT.MATCHES);
  });
});

describe("lisa controls attest --pull-request-canaries, after a passing pair", () => {
  it("records each half exactly once per requirement, beside the observed result", async () => {
    const where = pullRequestSetting(SERVES_BOTH);
    const platform = canaryPlatform();

    const run = await attestIn(where, CANARIES, { gh: platform.gh });

    expect(run.stderr).toEqual([]);
    expect(run.code).toBe(ATTEST_EXIT.PASSED);
    expect(recordIds(where)).toEqual([
      `${PULL_ONLY_ENTRY}/pull-request/clean/${OBSERVED_IS_ENOUGH}`,
      `${PULL_ONLY_ENTRY}/pull-request/clean/${NEEDS_EXERCISED}`,
      `${PULL_ONLY_ENTRY}/pull-request/observed/${OBSERVED_IS_ENOUGH}`,
      `${PULL_ONLY_ENTRY}/pull-request/observed/${NEEDS_EXERCISED}`,
      `${PULL_ONLY_ENTRY}/pull-request/violation/${OBSERVED_IS_ENOUGH}`,
      `${PULL_ONLY_ENTRY}/pull-request/violation/${NEEDS_EXERCISED}`,
    ]);
    expect(
      evidenceIn(where.repoPath).records.map(record => record.result)
    ).toEqual(Array.from({ length: 6 }, () => "held"));
    expectNothingLeft(platform);
  });

  it("makes the requirement that needs a planted change conforming, and --check agrees", async () => {
    const where = pullRequestSetting(SERVES_BOTH);
    const platform = canaryPlatform();

    await attestIn(where, CANARIES, { gh: platform.gh });

    expect(verdictFor(where, NEEDS_EXERCISED)).toEqual({
      verdict: "conforming",
      reason: "control-proved",
      rung: "exercised",
    });
    expect((await checkVerdict(where.repoPath, AFTER_BOTH)).code).toBe(
      ATTEST_CHECK_EXIT.MATCHES
    );
  });

  it("puts both halves on record the way the register's unproved mark reads them", async () => {
    const where = pullRequestSetting(SERVES_BOTH);
    const platform = canaryPlatform();

    await attestIn(where, CANARIES, { gh: platform.gh });

    expect(
      hasBothProofHalves(
        parseProofHalfRecords(evidenceIn(where.repoPath)),
        PULL_ONLY_ENTRY,
        PULL_REQUEST
      )
    ).toBe(true);
  });
});

describe("a later run that only reads the settings", () => {
  it("leaves a canary proof that is still current on record", async () => {
    const where = pullRequestSetting(SERVES_BOTH);
    const platform = canaryPlatform();
    await attestIn(where, CANARIES, { gh: platform.gh });
    const proved = evidenceIn(where.repoPath);

    await attestIn(where, { json: true }, { gh: platform.gh }, NEXT_DAY);

    expect(evidenceIn(where.repoPath)).toEqual(proved);
    expect(verdictFor(where, NEEDS_EXERCISED).rung).toBe("exercised");
    expect((await checkVerdict(where.repoPath, AFTER_BOTH)).code).toBe(
      ATTEST_CHECK_EXIT.MATCHES
    );
  });

  it("replaces it when the platform no longer requires the check", async () => {
    const where = pullRequestSetting(SERVES_BOTH);
    await attestIn(where, CANARIES, { gh: canaryPlatform().gh });

    await attestIn(
      where,
      { json: true },
      { gh: canaryPlatform({ required: [] }).gh },
      NEXT_DAY
    );

    expect(recordIds(where)).toEqual([
      `${PULL_ONLY_ENTRY}/pull-request/observed/${OBSERVED_IS_ENOUGH}`,
      `${PULL_ONLY_ENTRY}/pull-request/observed/${NEEDS_EXERCISED}`,
    ]);
    expect(verdictFor(where, NEEDS_EXERCISED).verdict).toBe(NON_CONFORMING);
  });
});

describe("an entry whose pull-request check runs from a file Lisa did not write", () => {
  it("stays unproved after a run that asked for canaries, because none can be opened for it", async () => {
    const where = pullRequestSetting(withExecutor(SERVES_BOTH));
    const platform = canaryPlatform();

    await attestIn(where, CANARIES, { gh: platform.gh });

    // Canaries are opened on github.com only, and the mark exists only where
    // the executor is on another platform: nothing is sent, so all that is
    // recorded is that the platform was not reached, and never a half.
    expect(platform.log).toEqual([]);
    expect(
      evidenceIn(where.repoPath).records.map(record => [
        record.rung,
        record.result,
        record.reason,
      ])
    ).toEqual([
      ["observed", "unknown", "platform-not-reached"],
      ["observed", "unknown", "platform-not-reached"],
    ]);
    expect(
      jsonOf<ControlRegister>(where.repoPath, CONTROL_REGISTER_PATH).entries
    ).toEqual([
      expect.objectContaining({ id: PULL_ONLY_ENTRY, status: "unproved" }),
    ]);
  });
});

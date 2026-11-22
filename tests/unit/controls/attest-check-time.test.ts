/**
 * `lisa controls attest --check` as time passes, and when there is nothing
 * to compare (CodySwannGT/lisa#4998).
 *
 * A verdict rests on evidence, and evidence has a lifetime. Once a record
 * the verdict rests on is past it, the requirement is unknown, the committed
 * verdict no longer says what its inputs give, and the check says so.
 */
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ATTEST_CHECK_EXIT,
  runAttestCheck,
} from "../../../src/controls/attest-check.js";
import { DEFAULT_FRESHNESS_SECONDS } from "../../../src/controls/evidence-types.js";
import { VERDICT_PATH } from "../../../src/controls/verdict-types.js";
import {
  checks,
  F_NONE_SOURCE,
  provedGates,
} from "../../helpers/control-proofs.js";
import {
  attested,
  checkVerdict,
  RECORDED_NOW,
} from "./support/attest-record-run.js";
import { removeCopies, setting } from "./support/proof-run.js";
import { removeFixtures } from "./support/report-check-run.js";

const WORKING = provedGates([{ command: checks(F_NONE_SOURCE) }]);

afterEach(() => {
  removeCopies();
  removeFixtures();
});

describe("lisa controls attest --check as time passes", () => {
  const EXPIRY = new Date(
    Date.parse("2026-01-01T00:00:01.000Z") + DEFAULT_FRESHNESS_SECONDS * 1000
  );

  it("passes until the evidence's lifetime is over", async () => {
    const where = await attested(WORKING);

    expect(
      (await checkVerdict(where.repoPath, new Date(EXPIRY.getTime() - 1))).code
    ).toBe(ATTEST_CHECK_EXIT.MATCHES);
  });

  it("exits non-zero once it is over, and says the requirement is now unknown", async () => {
    const where = await attested(WORKING);

    const run = await checkVerdict(where.repoPath, EXPIRY);

    expect(run.code).toBe(ATTEST_CHECK_EXIT.DIFFERS);
    expect(run.stderr).toContain(
      `SI7: ${VERDICT_PATH} says "conforming"; the register and the evidence give unknown. Evidence record "code-style@./commit/violation/SI7" is too old to rely on: it stopped being current at ${EXPIRY.toISOString()}. Run the attest step again.`
    );
    expect(run.stderr).toContain(
      `${VERDICT_PATH} leaves SI7 out of "prevented_by"; the register and the evidence give it as a requirement that prevents a conforming result.`
    );
  });
});

describe("lisa controls attest --check with nothing to compare", () => {
  it("exits 2 when the path is not a folder", async () => {
    const where = await attested(WORKING);
    const stderr: string[] = [];

    const code = await runAttestCheck(path.join(where.repoPath, "absent"), {
      clock: () => RECORDED_NOW,
      stdout: () => undefined,
      stderr: line => {
        stderr.push(line);
      },
    });

    expect(code).toBe(ATTEST_CHECK_EXIT.NOT_CHECKED);
    expect(stderr.join("\n")).toContain("is not a folder");
  });

  it("exits 2 when the gates declaration is refused", async () => {
    const where = setting({ "code-style": { commit: "sometimes" } });

    const run = await checkVerdict(where.repoPath);

    expect(run.code).toBe(ATTEST_CHECK_EXIT.NOT_CHECKED);
    expect(run.stderr.at(-1)).toContain("was refused");
  });

  it("exits 2, and says why, when the check cannot finish", async () => {
    const where = await attested(WORKING);
    const stderr: string[] = [];

    const code = await runAttestCheck(where.repoPath, {
      clock: () => RECORDED_NOW,
      stdout: () => undefined,
      stderr: line => {
        stderr.push(line);
      },
      loadCatalogue: () => {
        throw new Error("the requirements catalogue is missing");
      },
    });

    expect(code).toBe(ATTEST_CHECK_EXIT.NOT_CHECKED);
    expect(stderr).toEqual([
      "the requirements catalogue is missing",
      "attest --check: FAIL. The check could not finish, so nothing was compared",
    ]);
  });

  it("exits non-zero in a repository that was never attested", async () => {
    const where = setting(WORKING);

    const run = await checkVerdict(where.repoPath);

    expect(run.code).toBe(ATTEST_CHECK_EXIT.DIFFERS);
    expect(run.stderr).toContain(
      "No verdict was found at .lisa/controls/verdict.json."
    );
  });
});

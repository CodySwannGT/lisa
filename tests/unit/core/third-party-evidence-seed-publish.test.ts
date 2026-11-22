/**
 * The readings that say whether an evidence workflow publishes its verdict on
 * the head it judged (CodySwannGT/lisa#4630).
 *
 * A `status` or `check_run` run belongs to the default branch's latest commit,
 * so a verdict that is only the job's own conclusion never reaches the pull
 * request. A copy is current only when its token may write check runs and its
 * job saves the prover's verdict and hands it to a publish step; these shapes
 * pin both readings in both directions.
 * @module tests/unit/core/third-party-evidence-seed-publish
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  isCurrentEvidenceSeed,
  readEvidenceSeed,
} from "../../../src/core/third-party-evidence-seed.js";

const ROOT = path.resolve(import.meta.dirname, "../../..");

/** The seed Lisa ships now. */
const CURRENT_SEED = fs.readFileSync(
  path.join(
    ROOT,
    "typescript/create-only/.github/workflows/third-party-review-evidence.yml"
  ),
  "utf8"
);

const STATUS_ONLY = "on:\n  status:";
const CHECKS_READ = "permissions:\n  contents: read\n  checks: read";

/** A step that saves the prover's verdict, and its exit code, under the id `prove`. */
const CAPTURE = `      - id: prove
        run: |
          node scripts/check-third-party-review-evidence.mjs --json >"$V" || status=$?
          echo "exit_code=$status" >>"$GITHUB_OUTPUT"
`;

/** The same step half converted: it saves the verdict and drops the exit code. */
const CAPTURE_WITHOUT_EXIT = `      - id: prove
        run: node scripts/check-third-party-review-evidence.mjs --json >"$V"
`;

/** The env a publish step reads the saved exit code from. */
const READS_EXIT =
  "      - env:\n          PROVER_EXIT: ${{ steps.prove.outputs.exit_code }}\n";

/** A step that publishes a saved verdict. */
const PUBLISH = `        run: node "$PROVER" --publish="$VERDICT"
`;

/**
 * A workflow whose one job runs these steps.
 * @param permissions - The `permissions:` block, or empty for none
 * @param steps - The job's steps, indented under `steps:`
 * @returns Workflow source
 */
function workflow(permissions: string, steps = CAPTURE): string {
  return `name: evidence\n${STATUS_ONLY}\n${permissions}\njobs:\n  evidence:\n    steps:\n${steps}`;
}

describe("readEvidenceSeed — the published verdict", () => {
  it.each([
    ["checks: write", "permissions:\n  checks: write", true],
    ["write-all", "permissions: write-all", true],
    ["checks: read", CHECKS_READ, false],
    ["read-all", "permissions: read-all", false],
    ["no permissions block at all", "", false],
  ])(
    "judges whether the token may publish a check run under %s",
    (_name, permissions, expected) => {
      expect(readEvidenceSeed(workflow(permissions)).writesChecks).toBe(
        expected
      );
    }
  );

  it.each([
    [
      "a captured verdict and a step that publishes it",
      `${CAPTURE}${READS_EXIT}${PUBLISH}`,
      true,
    ],
    [
      "a captured verdict whose exit code never reaches $GITHUB_OUTPUT",
      `${CAPTURE_WITHOUT_EXIT}${READS_EXIT}${PUBLISH}`,
      false,
    ],
    [
      "a publish step that reads the step's outputs but not its exit code",
      `${CAPTURE}      - env:\n          VERDICT: \${{ steps.prove.outputs.verdict }}\n${PUBLISH}`,
      false,
    ],
    [
      "the prover alone, whose exit code is the verdict",
      "      - run: node scripts/check-third-party-review-evidence.mjs\n",
      false,
    ],
    ["a captured verdict nothing publishes", CAPTURE, false],
    [
      "a publish step that reads no captured verdict",
      `${CAPTURE}      - ${PUBLISH.trimStart()}`,
      false,
    ],
  ])(
    "judges whether a job with %s publishes its verdict",
    (_name, steps, expected) => {
      expect(
        readEvidenceSeed(workflow(CHECKS_READ, steps)).publishesVerdict
      ).toBe(expected);
    }
  );

  it("reads the seed Lisa ships as publishing its verdict with a token that may", () => {
    const reading = readEvidenceSeed(CURRENT_SEED);

    expect(reading.writesChecks).toBe(true);
    expect(reading.publishesVerdict).toBe(true);
    expect(isCurrentEvidenceSeed(reading)).toBe(true);
  });

  it("holds a copy that reads everything but may not publish to be stale", () => {
    const reading = readEvidenceSeed(
      CURRENT_SEED.replace("checks: write", "checks: read")
    );

    expect(reading.readsChecks).toBe(true);
    expect(reading.writesChecks).toBe(false);
    expect(isCurrentEvidenceSeed(reading)).toBe(false);
  });
});

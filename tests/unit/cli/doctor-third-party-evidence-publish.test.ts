/**
 * Doctor coverage for repositories seeded before the evidence workflow
 * published its verdict on the head it judged.
 *
 * A copy seeded earlier ends its job on the prover's exit code. GitHub
 * attaches that job's check run to the default branch's latest commit, so no
 * pull request ever showed the verdict (CodySwannGT/lisa#4630). The seed is
 * `create-only`, so such a copy is never refreshed; these tests pin the check
 * that reports it, and the lines it prints — the shipped seed's own, byte for
 * byte.
 * @module tests/unit/cli/doctor-third-party-evidence-publish
 */
import * as fse from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CHECKS_WRITE_LINE,
  checkThirdPartyEvidenceSeed,
  EVIDENCE_STEPS_LINES,
  RUN_IDENTITY_LINES,
} from "../../../src/cli/doctor-third-party-evidence-seed.js";
import { applyRewrites } from "../../../src/core/anchored-rewrite.js";
import { THIRD_PARTY_EVIDENCE_WORKFLOW } from "../../../src/core/third-party-evidence-seed.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const ROOT = path.resolve(import.meta.dirname, "../../..");

/** How the detail names a copy that reads check runs and cannot publish one. */
const READ_ONLY_CHECKS = "grants `checks: read` but not `checks: write`";

/** How the detail names a copy whose verdict never reaches the head it judged. */
const NO_PUBLISH = "never publishes its verdict on the pull request head";

/** How the detail names a copy that never reads the run's commit and name. */
const NO_IDENTITY = "never reads the check run's head SHA and name";

/** The publish step's first line, as the seed ships it. */
const PUBLISH_STEP_NAME =
  "      - name: 🕵️ Publish the verdict on the head it judged";

/** The prover step's first line, in every copy. */
const PROVER_STEP_NAME = "      - name: 🕵️ Prove";

/** Every line from the prover step to the end of the file. */
const PROVER_STEP_ONWARD = /^ {6}- name: 🕵️ Prove[\s\S]*$/mu;

/** The seed exactly as Lisa shipped it before #4553. */
const PRE_FIX_SEED = fse.readFileSync(
  path.join(
    ROOT,
    "tests/fixtures/third-party-review-evidence-seed/pre-4553.yml"
  ),
  "utf8"
);

/** The seed Lisa ships now. */
const CURRENT_SEED = fse.readFileSync(
  path.join(
    ROOT,
    "typescript/create-only/.github/workflows/third-party-review-evidence.yml"
  ),
  "utf8"
);

describe("doctor third-party evidence seed check: the published verdict", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Seed the project with one copy of the workflow.
   * @param text - Workflow source
   */
  async function seed(text: string): Promise<void> {
    await fse.outputFile(
      path.join(tempDir, THIRD_PARTY_EVIDENCE_WORKFLOW),
      text
    );
  }

  it("prints the prover and publish steps exactly as the shipped seed has them", () => {
    expect(CURRENT_SEED).toContain(`\n${EVIDENCE_STEPS_LINES.join("\n")}\n`);
    expect(EVIDENCE_STEPS_LINES).toContain(PUBLISH_STEP_NAME);
  });

  it("reports a copy that reads check runs but may not publish one", async () => {
    await seed(CURRENT_SEED.replace(CHECKS_WRITE_LINE, "  checks: read"));

    const check = await checkThirdPartyEvidenceSeed(tempDir);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(READ_ONLY_CHECKS);
    expect(check.detail.split("\n")).toEqual(
      expect.arrayContaining([
        "Add under `permissions:`, in place of `checks: read`:",
        CHECKS_WRITE_LINE,
      ])
    );
    expect(check.detail).not.toContain(NO_PUBLISH);
  });

  it("reports a copy without the publish step, and the lines to add", async () => {
    // A copy seeded before the verdict was published on the head: the prover
    // step ends the job on its own exit code, and nothing reaches the head.
    const [, sha, context] = RUN_IDENTITY_LINES.map(line => line.trim());
    const preFixSteps = PRE_FIX_SEED.slice(
      PRE_FIX_SEED.indexOf(PROVER_STEP_NAME)
    )
      .replace(/EVIDENCE_SHA: .*$/mu, String(sha))
      .replace(/EVIDENCE_CONTEXT: .*$/mu, String(context));
    await seed(
      applyRewrites(
        CURRENT_SEED,
        [{ anchor: PROVER_STEP_ONWARD, replacement: preFixSteps }],
        "the current seed, with the prover step it had before #4630"
      )
    );

    const check = await checkThirdPartyEvidenceSeed(tempDir);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(NO_PUBLISH);
    expect(check.detail).not.toContain(NO_IDENTITY);
    expect(check.detail.split("\n")).toEqual(
      expect.arrayContaining([...EVIDENCE_STEPS_LINES])
    );
  });

  it.each([
    [
      "a prove step that never writes its exit code",
      '          echo "exit_code=$status" >>"$GITHUB_OUTPUT"\n',
      "",
    ],
    [
      "a publish step that never reads the exit code",
      "          PROVER_EXIT: ${{ steps.prove.outputs.exit_code }}\n",
      "",
    ],
  ])(
    "reports a half-converted copy with %s",
    async (_name, line, replacement) => {
      expect(CURRENT_SEED).toContain(line);
      await seed(CURRENT_SEED.replace(line, replacement));

      const check = await checkThirdPartyEvidenceSeed(tempDir);

      expect(check.status).toBe("warn");
      expect(check.detail).toContain(NO_PUBLISH);
      expect(check.detail.split("\n")).toEqual(
        expect.arrayContaining([...EVIDENCE_STEPS_LINES])
      );
    }
  );
});

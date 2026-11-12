/**
 * Doctor coverage for repositories seeded before a manual run of the evidence
 * workflow could name the reviewer whose check run it brings up to date.
 *
 * The verdict is published as `🕵️ Third-party review evidence (<context>)`.
 * A copy seeded earlier takes only a `sha` on `workflow_dispatch`, so a manual
 * run publishes under the bare name and a stale red `(<context>)` can only be
 * cleared by that reviewer reporting again (CodySwannGT/lisa#4738). The seed is
 * `create-only`, so such a copy is never refreshed; these tests pin the check
 * that reports it, the lines it prints, and that applying them is enough.
 * @module tests/unit/cli/doctor-third-party-evidence-dispatch-context
 */
import * as fse from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  checkThirdPartyEvidenceSeed,
  CONCURRENCY_GROUP_LINE,
  DISPATCH_CONTEXT_INPUT_LINES,
  RUN_IDENTITY_LINES,
} from "../../../src/cli/doctor-third-party-evidence-seed.js";
import { applyRewrites } from "../../../src/core/anchored-rewrite.js";
import { THIRD_PARTY_EVIDENCE_WORKFLOW } from "../../../src/core/third-party-evidence-seed.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const ROOT = path.resolve(import.meta.dirname, "../../..");

/** How the detail names a copy whose manual run cannot name a reviewer. */
const NO_DISPATCH_CONTEXT = "manual run takes no `context` input";

/** How the remedy says where the input lines go. */
const ADD_INPUT = "Add under `workflow_dispatch:` `inputs:`, beside `sha:`:";

/** The seed Lisa ships now. */
const CURRENT_SEED = fse.readFileSync(
  path.join(
    ROOT,
    "typescript/create-only/.github/workflows/third-party-review-evidence.yml"
  ),
  "utf8"
);

/** The input block, as the seed ships it. */
const INPUT_BLOCK = `${DISPATCH_CONTEXT_INPUT_LINES.join("\n")}\n`;

/** The seed as Lisa shipped it after #4630 and before #4738. */
const PRE_FIX_COPY = CURRENT_SEED.replace(INPUT_BLOCK, "").replaceAll(
  " || inputs.context",
  ""
);

describe("doctor third-party evidence seed check: a manual run's reviewer", () => {
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

  it("prints the input lines exactly as the shipped seed has them", () => {
    expect(CURRENT_SEED).toContain(`\n${INPUT_BLOCK}`);
    expect(PRE_FIX_COPY).not.toContain("inputs.context");
  });

  it("reports a copy without the context input, and the lines to add", async () => {
    await seed(PRE_FIX_COPY);

    const check = await checkThirdPartyEvidenceSeed(tempDir);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(NO_DISPATCH_CONTEXT);
    expect(check.detail.split("\n")).toEqual(
      expect.arrayContaining([
        ADD_INPUT,
        ...DISPATCH_CONTEXT_INPUT_LINES,
        String(RUN_IDENTITY_LINES[2]),
        CONCURRENCY_GROUP_LINE,
      ])
    );
  });

  it("prints lines that make the copy read as current once applied", async () => {
    const [, , context] = RUN_IDENTITY_LINES.map(line => line.trim());
    await seed(
      applyRewrites(
        PRE_FIX_COPY,
        [
          {
            anchor: /^ {8}type: string\n/mu,
            replacement: `        type: string\n${INPUT_BLOCK}`,
          },
          { anchor: /EVIDENCE_CONTEXT: .*$/mu, replacement: String(context) },
          {
            anchor: /^ {2}group: third-party-review-evidence-.*$/mu,
            replacement: CONCURRENCY_GROUP_LINE,
          },
        ],
        "the pre-#4738 copy, under the printed remedy"
      )
    );

    expect((await checkThirdPartyEvidenceSeed(tempDir)).status).toBe("ok");
  });

  it("stays quiet about the input for the seed Lisa ships now", async () => {
    await seed(CURRENT_SEED);

    const check = await checkThirdPartyEvidenceSeed(tempDir);

    expect(check.status).toBe("ok");
    expect(check.detail).toContain("names the reviewer");
  });
});

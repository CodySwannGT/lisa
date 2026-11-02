/**
 * Doctor coverage for repositories seeded before the evidence workflow could
 * wake on a check run.
 *
 * The workflow is `create-only`: a repository that received it earlier keeps a
 * copy that starts only on `status` events, and a reviewer reporting through a
 * check run fires none — so the copy silently stopped running, and nothing
 * would ever raise the question (CodySwannGT/lisa#4553). These tests pin the
 * check that lets such a repository find ITSELF, the exact lines it prints, that
 * it edits nothing, and that a copy it could not read never renders as a copy
 * with nothing missing.
 * @module tests/unit/cli/doctor-third-party-evidence-seed
 */
import * as fse from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHECK_RUN_TRIGGER_LINES,
  CHECKS_READ_LINE,
  checkThirdPartyEvidenceSeed,
  CONCURRENCY_GROUP_LINE,
  PERMISSIONS_BLOCK_LINES,
  RUN_IDENTITY_LINES,
  THIRD_PARTY_EVIDENCE_SEED_CHECK_NAME,
} from "../../../src/cli/doctor-third-party-evidence-seed.js";
import { runDoctor } from "../../../src/cli/doctor.js";
import { applyRewrites } from "../../../src/core/anchored-rewrite.js";
import { THIRD_PARTY_EVIDENCE_WORKFLOW } from "../../../src/core/third-party-evidence-seed.js";
import { loadYaml } from "../../../src/utils/yaml.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const ROOT = path.resolve(import.meta.dirname, "../../..");

/** How the detail names a copy with no check-run trigger. */
const NO_TRIGGER = "no `check_run` trigger";

/** How the detail names a copy whose token cannot read check runs. */
const NO_CHECKS_READ = "does not grant `checks: read`";

/** How the detail names a copy that never reads the run's commit and name. */
const NO_IDENTITY = "never reads the check run's head SHA and name";

/** How the detail tells a host to stop checking out the event's head. */
const DELETE_REF = "Delete the `ref:` line";

/** How the detail names a copy whose runs can cancel the reviewer's. */
const UNKEYED =
  "concurrency group is not keyed on the check run's head and name";

/** How the check spells "I could not answer that". */
const UNDETERMINABLE = "Could not determine";

/** The seed exactly as Lisa shipped it before this fix. */
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

/** The printed trigger lines, put where the remedy says. */
const ADD_TRIGGER = {
  anchor: "on:\n  status:\n",
  replacement: `on:\n  status:\n${CHECK_RUN_TRIGGER_LINES.join("\n")}\n`,
};

/** The printed permission line, put where the remedy says. */
const ADD_CHECKS_READ = {
  anchor: "permissions:\n  contents: read\n",
  replacement: `permissions:\n  contents: read\n${CHECKS_READ_LINE}\n`,
};

describe("doctor third-party evidence seed check", () => {
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
   * @returns The absolute path written
   */
  async function seed(text: string): Promise<string> {
    const file = path.join(tempDir, THIRD_PARTY_EVIDENCE_WORKFLOW);
    await fse.outputFile(file, text);
    return file;
  }

  it("reports the pre-fix seed and prints the exact lines to add", async () => {
    await seed(PRE_FIX_SEED);

    const check = await checkThirdPartyEvidenceSeed(tempDir);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(THIRD_PARTY_EVIDENCE_WORKFLOW);
    expect(check.detail).toContain(NO_TRIGGER);
    expect(check.detail).toContain(NO_CHECKS_READ);
    expect(check.detail).toContain(NO_IDENTITY);
    expect(check.detail).toContain(DELETE_REF);
    const lines = check.detail.split("\n");
    expect(lines).toEqual(
      expect.arrayContaining([
        "Add under `on:`:",
        ...CHECK_RUN_TRIGGER_LINES,
        "Add under `permissions:`:",
        CHECKS_READ_LINE,
        ...RUN_IDENTITY_LINES,
        CONCURRENCY_GROUP_LINE,
      ])
    );
  });

  it("prints values that are the shipped seed's own, byte for byte", () => {
    // Ties the remedy to the seed rather than to itself: a wrong expression in
    // a printed line fails here even though the doctor would accept it.
    const seedDocument = loadYaml(CURRENT_SEED) as {
      concurrency: { group: string };
      jobs: {
        evidence: { steps: Array<{ env?: Record<string, string> }> };
      };
    };
    const env = seedDocument.jobs.evidence.steps.find(
      step => step.env?.EVIDENCE_SHA !== undefined
    )?.env;
    const printed = Object.fromEntries(
      [...RUN_IDENTITY_LINES, CONCURRENCY_GROUP_LINE].map(line => {
        const [key, ...value] = line.trim().split(": ");
        return [key, value.join(": ")];
      })
    );

    expect(printed.EVIDENCE_SHA).toBe(env?.EVIDENCE_SHA);
    expect(printed.EVIDENCE_CONTEXT).toBe(env?.EVIDENCE_CONTEXT);
    expect(printed.group).toBe(seedDocument.concurrency.group);
  });

  it("prints lines that make the pre-fix seed read as current", async () => {
    // The remedy is checked by applying it, not by reading it: every printed
    // line goes where the check says, and the result must pass.
    const [sha, context] = RUN_IDENTITY_LINES.map(line => line.trim());
    const group = CONCURRENCY_GROUP_LINE.trim();
    const repaired = applyRewrites(
      PRE_FIX_SEED,
      [
        ADD_TRIGGER,
        ADD_CHECKS_READ,
        { anchor: /EVIDENCE_SHA: .*$/mu, replacement: String(sha) },
        { anchor: /EVIDENCE_CONTEXT: .*$/mu, replacement: String(context) },
        {
          anchor: /group: third-party-review-evidence-.*$/mu,
          replacement: String(group),
        },
        { anchor: /^ *ref: .*\n/mu, replacement: "" },
      ],
      "the pre-fix seed, under the whole printed remedy"
    );
    await seed(repaired);

    expect((await checkThirdPartyEvidenceSeed(tempDir)).status).toBe("ok");
  });

  it("still warns a copy that applied everything but the concurrency group", async () => {
    // Under the old key every check run resolves to one group, so any app's
    // run anywhere cancels the reviewer's verdict while it is being judged.
    const [sha, context] = RUN_IDENTITY_LINES.map(line => line.trim());
    await seed(
      applyRewrites(
        PRE_FIX_SEED,
        [
          ADD_TRIGGER,
          ADD_CHECKS_READ,
          { anchor: /EVIDENCE_SHA: .*$/mu, replacement: String(sha) },
          { anchor: /EVIDENCE_CONTEXT: .*$/mu, replacement: String(context) },
          { anchor: /^ *ref: .*\n/mu, replacement: "" },
        ],
        "the pre-fix seed, with every edit but the group"
      )
    );

    const check = await checkThirdPartyEvidenceSeed(tempDir);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(UNKEYED);
    expect(check.detail.split("\n")).toContain(CONCURRENCY_GROUP_LINE);
    expect(check.detail).not.toContain(NO_IDENTITY);
  });

  it("prints the whole permissions block when the token cannot read pull requests", async () => {
    await seed(CURRENT_SEED.replace("  pull-requests: read\n", ""));

    const check = await checkThirdPartyEvidenceSeed(tempDir);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain("Make the `permissions:` block");
    expect(check.detail.split("\n")).toEqual(
      expect.arrayContaining([...PERMISSIONS_BLOCK_LINES])
    );
  });

  it("still warns a copy that gained only the trigger and the permission", async () => {
    // Waking is not judging: this copy starts on every check run and passes an
    // empty --sha, so it must not read as repaired.
    await seed(
      applyRewrites(
        PRE_FIX_SEED,
        [ADD_TRIGGER, ADD_CHECKS_READ],
        "the pre-fix seed, with only the trigger and the permission"
      )
    );

    const check = await checkThirdPartyEvidenceSeed(tempDir);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(NO_IDENTITY);
    expect(check.detail).not.toContain(NO_TRIGGER);
    expect(check.detail).not.toContain(NO_CHECKS_READ);
  });

  it("warns a current copy that checks out the head of the event that woke it", async () => {
    await seed(
      CURRENT_SEED.replace(
        "          persist-credentials: false",
        "          ref: ${{ github.event.check_run.head_sha }}\n          persist-credentials: false"
      )
    );

    const check = await checkThirdPartyEvidenceSeed(tempDir);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(DELETE_REF);
    expect(check.detail).not.toContain(NO_TRIGGER);
  });

  it("prints the whole permissions block for a copy that declares none", async () => {
    await seed(CURRENT_SEED.replace(/^permissions:\n(?: {2}.*\n)+/mu, ""));

    const check = await checkThirdPartyEvidenceSeed(tempDir);

    expect(check.status).toBe("warn");
    expect(check.detail.split("\n")).toEqual(
      expect.arrayContaining([...PERMISSIONS_BLOCK_LINES])
    );
  });

  it("names only the missing permission when the trigger is already there", async () => {
    await seed(CURRENT_SEED.replace(`${CHECKS_READ_LINE}\n`, ""));

    const check = await checkThirdPartyEvidenceSeed(tempDir);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(NO_CHECKS_READ);
    expect(check.detail).not.toContain(NO_TRIGGER);
    expect(check.detail).not.toContain("Add under `on:`");
    expect(check.detail).not.toContain(DELETE_REF);
  });

  it("names only the missing trigger when the permission is already there", async () => {
    await seed(
      CURRENT_SEED.replace(`${CHECK_RUN_TRIGGER_LINES.join("\n")}\n`, "")
    );

    const check = await checkThirdPartyEvidenceSeed(tempDir);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(NO_TRIGGER);
    expect(check.detail).not.toContain(NO_CHECKS_READ);
  });

  it("leaves the reported copy byte-for-byte unchanged", async () => {
    const file = await seed(PRE_FIX_SEED);

    await checkThirdPartyEvidenceSeed(tempDir);

    expect(await fse.readFile(file, "utf8")).toBe(PRE_FIX_SEED);
  });

  it("stays quiet for the seed Lisa ships now", async () => {
    await seed(CURRENT_SEED);

    expect((await checkThirdPartyEvidenceSeed(tempDir)).status).toBe("ok");
  });

  it("stays quiet for a project that was never seeded the workflow", async () => {
    const check = await checkThirdPartyEvidenceSeed(tempDir);

    expect(check.status).toBe("ok");
    expect(check.detail).toContain("No ");
  });

  it("fails rather than passing when the workflow cannot be read", async () => {
    const file = await seed(PRE_FIX_SEED);
    await fse.chmod(file, 0o000);
    try {
      const check = await checkThirdPartyEvidenceSeed(tempDir);

      expect(check.status).toBe("fail");
      expect(check.detail).toContain(UNDETERMINABLE);
      expect(check.detail).toContain("EACCES");
    } finally {
      await fse.chmod(file, 0o600);
    }
  });

  it("fails rather than passing when the workflow will not parse", async () => {
    await seed("on:\n  status:\n  - [unbalanced\n");

    const check = await checkThirdPartyEvidenceSeed(tempDir);

    expect(check.status).toBe("fail");
    expect(check.detail).toContain(UNDETERMINABLE);
  });

  it("fails rather than passing when the project path is absent", async () => {
    const check = await checkThirdPartyEvidenceSeed(
      path.join(tempDir, "no-such-project")
    );

    expect(check.status).toBe("fail");
    expect(check.detail).toContain(UNDETERMINABLE);
  });

  it("runs as part of lisa doctor, which leaves the copy alone", async () => {
    const file = await seed(PRE_FIX_SEED);
    await fse.writeJson(path.join(tempDir, ".lisa.config.json"), {
      harness: "claude",
    });

    const result = await runDoctor(
      tempDir,
      { offline: true },
      {
        write: vi.fn(),
        setExitCode: vi.fn(),
        runUpdateCheck: vi.fn().mockResolvedValue({ updateAvailable: false }),
      }
    );

    const check = result.checks.find(
      candidate => candidate.name === THIRD_PARTY_EVIDENCE_SEED_CHECK_NAME
    );
    expect(check?.status).toBe("warn");
    expect(await fse.readFile(file, "utf8")).toBe(PRE_FIX_SEED);
  });
});

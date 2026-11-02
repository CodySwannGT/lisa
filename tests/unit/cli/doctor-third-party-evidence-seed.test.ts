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
  PERMISSIONS_BLOCK_LINES,
  RUN_IDENTITY_LINES,
  THIRD_PARTY_EVIDENCE_SEED_CHECK_NAME,
} from "../../../src/cli/doctor-third-party-evidence-seed.js";
import { runDoctor } from "../../../src/cli/doctor.js";
import { THIRD_PARTY_EVIDENCE_WORKFLOW } from "../../../src/core/third-party-evidence-seed.js";
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

/**
 * Apply edits in order, insisting each one changes the text.
 * @param text - Workflow source
 * @param edits - Each anchor and its replacement
 * @returns The edited source
 */
function applyAll(
  text: string,
  edits: ReadonlyArray<readonly [string | RegExp, string]>
): string {
  return edits.reduce((current, [anchor, replacement]) => {
    const next = current.replace(anchor, replacement);
    if (next === current)
      throw new Error(`edit did not apply: ${String(anchor)}`);
    return next;
  }, text);
}

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
      ])
    );
  });

  it("prints lines that make the pre-fix seed read as current", async () => {
    // The remedy is checked by applying it, not by reading it: every printed
    // line goes where the check says, and the result must pass.
    const [sha, context, group] = RUN_IDENTITY_LINES.map(line => line.trim());
    const repaired = applyAll(PRE_FIX_SEED, [
      [
        "on:\n  status:\n",
        `on:\n  status:\n${CHECK_RUN_TRIGGER_LINES.join("\n")}\n`,
      ],
      [
        "permissions:\n  contents: read\n",
        `permissions:\n  contents: read\n${CHECKS_READ_LINE}\n`,
      ],
      [/EVIDENCE_SHA: .*$/mu, String(sha)],
      [/EVIDENCE_CONTEXT: .*$/mu, String(context)],
      [/group: third-party-review-evidence-.*$/mu, String(group)],
      [/^ *ref: .*\n/mu, ""],
    ]);
    await seed(repaired);

    expect((await checkThirdPartyEvidenceSeed(tempDir)).status).toBe("ok");
  });

  it("still warns a copy that gained only the trigger and the permission", async () => {
    // Waking is not judging: this copy starts on every check run and passes an
    // empty --sha, so it must not read as repaired.
    await seed(
      applyAll(PRE_FIX_SEED, [
        [
          "on:\n  status:\n",
          `on:\n  status:\n${CHECK_RUN_TRIGGER_LINES.join("\n")}\n`,
        ],
        [
          "permissions:\n  contents: read\n",
          `permissions:\n  contents: read\n${CHECKS_READ_LINE}\n`,
        ],
      ])
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

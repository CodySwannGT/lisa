/**
 * Which read failures the evidence-seed doctor check calls an absence.
 *
 * Only a definitive "not there" — `ENOENT`, `ENOTDIR` — may read as a project
 * that was never seeded the workflow. Any other errno means the check could not
 * look, and must FAIL rather than pass: a workflow this check could not read is
 * not a workflow with nothing missing (CodySwannGT/lisa#4553).
 *
 * `ENAMETOOLONG` is on the failing side on purpose. It describes the path the
 * check built, not the file, and a project nested past the platform's path
 * limit can still hold the workflow.
 *
 * The read is replaced here rather than provoked through file modes, because a
 * permission bit does not stop root: under root a `chmod 000` file reads fine
 * and the case would prove nothing. Pinning the classification both ways also
 * means moving `EACCES` into the absent list fails a test instead of passing
 * every one.
 * @module tests/unit/cli/doctor-third-party-evidence-seed-errno
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkThirdPartyEvidenceSeed } from "../../../src/cli/doctor-third-party-evidence-seed.js";
import { THIRD_PARTY_EVIDENCE_WORKFLOW } from "../../../src/core/third-party-evidence-seed.js";
import { ABSENT_CODES, UNDETERMINABLE_CODES } from "../../helpers/fs-errno.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

/**
 * Assert the check consulted the replaced read, once, for the workflow's path.
 *
 * Without this the absent cases could pass for the wrong reason: a real read
 * of an empty project is also ENOENT, so a check that stopped going through
 * this read would still report "never seeded".
 * @param projectRoot - The project the check was pointed at
 */
function expectOneWorkflowRead(projectRoot: string): void {
  expect(readFile).toHaveBeenCalledTimes(1);
  expect(vi.mocked(readFile).mock.calls[0]?.[0]).toBe(
    path.join(projectRoot, THIRD_PARTY_EVIDENCE_WORKFLOW)
  );
}

/**
 * A read failure carrying one errno, as Node reports it.
 * @param code - The errno code
 * @returns The rejection value
 */
function readFailure(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: simulated read failure`), { code });
}

describe("doctor third-party evidence seed check — read failures", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    vi.mocked(readFile).mockReset();
    await cleanupTempDir(tempDir);
  });

  it.each(UNDETERMINABLE_CODES)(
    "fails, naming %s, when the check cannot read the workflow",
    async code => {
      vi.mocked(readFile).mockRejectedValueOnce(readFailure(code));

      const check = await checkThirdPartyEvidenceSeed(tempDir);

      expectOneWorkflowRead(tempDir);
      expect(check.status).toBe("fail");
      expect(check.detail).toContain("Could not determine");
      expect(check.detail).toContain(code);
    }
  );

  it.each(ABSENT_CODES)(
    "reads %s as a project that was never seeded the workflow",
    async code => {
      vi.mocked(readFile).mockRejectedValueOnce(readFailure(code));

      const check = await checkThirdPartyEvidenceSeed(tempDir);

      expectOneWorkflowRead(tempDir);
      expect(check.status).toBe("ok");
      expect(check.detail).toBe(
        `No ${THIRD_PARTY_EVIDENCE_WORKFLOW} in this project`
      );
    }
  );
});

/**
 * Which `stat` failures the config-precedence doctor check calls an absence.
 *
 * Only `ENOENT` and `ENOTDIR` may read as "this config is not there". Any other
 * errno means the check could not look and must FAIL: a project root nested
 * past the platform's path limit can hold every config this check exists to
 * catch, and `ENAMETOOLONG` used to pass it as clean (CodySwannGT/lisa#4629).
 *
 * The project on disk really does carry `knip.json` beside `knip.ts`, so a
 * case that stopped going through the replaced `stat` would report the
 * shadowing instead of the expected line.
 * @module tests/unit/cli/doctor-config-shadowing-errno
 */
import * as fse from "fs-extra";
import { stat } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkConfigShadowing } from "../../../src/cli/doctor-config-shadowing.js";
import {
  ABSENT_CODES,
  type FsPromises,
  realFsPromises,
  refusingAt,
  UNDETERMINABLE_CODES,
} from "../../helpers/fs-errno.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<FsPromises>();
  return { ...actual, stat: vi.fn(actual.stat) };
});

/** The Lisa-seeded config whose probe is refused. */
const TEMPLATE = "knip.json";

describe("doctor config-precedence check — stat failures", () => {
  let tempDir: string;
  let refused: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    refused = path.join(tempDir, TEMPLATE);
    await fse.writeJson(refused, {});
    await fse.writeFile(path.join(tempDir, "knip.ts"), "export default {};\n");
  });

  afterEach(async () => {
    vi.mocked(stat).mockReset();
    await cleanupTempDir(tempDir);
  });

  /**
   * Refuse the template's probe with one errno.
   * @param code - Errno code to reject with
   */
  async function refuseTemplate(code: string): Promise<void> {
    const actual = await realFsPromises();
    vi.mocked(stat).mockImplementation(refusingAt(actual.stat, refused, code));
  }

  /**
   * Every path the check passed to `stat`.
   * @returns The probed paths, in call order
   */
  function probedPaths(): readonly unknown[] {
    return vi.mocked(stat).mock.calls.map(([target]) => target);
  }

  it.each(UNDETERMINABLE_CODES)(
    "fails, naming %s, when the check cannot probe a seeded config",
    async code => {
      await refuseTemplate(code);

      const check = await checkConfigShadowing(tempDir);

      expect(probedPaths()).toContain(refused);
      expect(check.status).toBe("fail");
      expect(check.detail.startsWith("Could not determine")).toBe(true);
      expect(check.detail).toContain(code);
    }
  );

  it.each(ABSENT_CODES)(
    "reads %s as a config that is not there",
    async code => {
      await refuseTemplate(code);

      const check = await checkConfigShadowing(tempDir);

      expect(probedPaths()).toContain(refused);
      expect(check.status).toBe("ok");
      expect(check.detail).toBe(
        "No Lisa-seeded config outranks a config this project wrote"
      );
    }
  );
});

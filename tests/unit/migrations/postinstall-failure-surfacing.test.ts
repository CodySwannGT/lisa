/**
 * Migration coverage for postinstall failure handling.
 *
 * The bounded runner owns timeout, visible diagnostics, and the durable
 * failure marker. This suite pins the migration boundary: every historical
 * direct-apply spelling is replaced in place by that runner, while host-owned
 * postinstall work is retained exactly once.
 * @module tests/unit/migrations/postinstall-failure-surfacing
 */
import * as path from "node:path";
import * as fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectType } from "../../../src/core/config.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import {
  EnsureLisaPostinstallMigration,
  LISA_INVOCATION,
} from "../../../src/migrations/ensure-lisa-postinstall.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const DIRECT_ENTRY = "node_modules/@codyswann/lisa/dist/index.js";
const SWALLOWING_INVOCATION = `[ -n "$CI" ] || LISA_BOOTSTRAP=1 node ${DIRECT_ENTRY} --yes --skip-git-check . 2>/dev/null || true`;
const EXIT_ZERO_WARNING_INVOCATION = `[ -n "$CI" ] || LISA_BOOTSTRAP=1 LISA_POSTINSTALL=1 node ${DIRECT_ENTRY} --yes --skip-git-check . || echo "lisa: TEMPLATE APPLY FAILED - see ${DIRECT_ENTRY} doctor" >&2`;
const FATAL_INVOCATION = `[ -n "$CI" ] || LISA_BOOTSTRAP=1 LISA_POSTINSTALL=1 node ${DIRECT_ENTRY} --yes --skip-git-check . || { echo "lisa: TEMPLATE APPLY FAILED" >&2; exit 1; }`;
const BOUNDED_RUNNER =
  '[ -n "$CI" ] || LISA_BOOTSTRAP=1 node node_modules/@codyswann/lisa/all/copy-overwrite/scripts/lisa-postinstall.mjs || true';

describe("postinstall migration adopts the bounded failure runner", () => {
  let tempDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(projectDir);
  });

  afterEach(async () => cleanupTempDir(tempDir));

  /**
   * Migrate one installed postinstall spelling.
   * @param existing Current postinstall value.
   * @returns The migrated postinstall value.
   */
  async function upgrade(existing: string): Promise<string> {
    await fs.writeJson(path.join(projectDir, "package.json"), {
      scripts: { postinstall: existing },
    });
    const detectedTypes: readonly ProjectType[] = ["typescript"];
    await new EnsureLisaPostinstallMigration().apply({
      projectDir,
      lisaDir: tempDir,
      detectedTypes,
      dryRun: false,
      logger: new SilentLogger(),
    });
    const pkg = await fs.readJson(path.join(projectDir, "package.json"));
    return pkg.scripts.postinstall;
  }

  it("exports the same bounded runner the package template uses", () => {
    expect(LISA_INVOCATION).toBe(BOUNDED_RUNNER);
  });

  it.each([
    SWALLOWING_INVOCATION,
    EXIT_ZERO_WARNING_INVOCATION,
    FATAL_INVOCATION,
  ])("replaces a historical direct apply in place", async old => {
    const after = await upgrade(old);

    expect(after).toBe(BOUNDED_RUNNER);
    expect(after).not.toContain(DIRECT_ENTRY);
  });

  it("preserves host work once while replacing the direct apply", async () => {
    expect(await upgrade(`${SWALLOWING_INVOCATION} && patch-package`)).toBe(
      `${BOUNDED_RUNNER} && patch-package`
    );
  });

  it("leaves an already upgraded script byte-identical", async () => {
    expect(await upgrade(`${BOUNDED_RUNNER} && patch-package`)).toBe(
      `${BOUNDED_RUNNER} && patch-package`
    );
  });

  it("normalizes an unguarded bounded runner without duplicating it", async () => {
    const unguarded =
      "node node_modules/@codyswann/lisa/all/copy-overwrite/scripts/lisa-postinstall.mjs";

    expect(await upgrade(`${unguarded} && patch-package`)).toBe(
      `${BOUNDED_RUNNER} && patch-package`
    );
  });
});

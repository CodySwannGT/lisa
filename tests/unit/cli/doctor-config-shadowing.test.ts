/**
 * Doctor coverage for a Lisa-seeded config already outranking the project's.
 *
 * The write-path guard decides whether to create a file and is never reached
 * again once the file exists, so the repositories seeded before it shipped
 * carry a `knip.json` that silently wins over their own `knip.ts` and have no
 * way to discover it. These tests pin the check that lets such a repository
 * find itself — and, just as importantly, pin that it stays quiet for the two
 * shapes that look similar and are fine (CodySwannGT/lisa#3858).
 * @module tests/unit/cli/doctor-config-shadowing
 */
import * as fse from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkConfigShadowing,
  CONFIG_SHADOWING_CHECK_NAME,
} from "../../../src/cli/doctor-config-shadowing.js";
import { runDoctor } from "../../../src/cli/doctor.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** A minimal but real knip config in the TypeScript spelling. */
const KNIP_TS_SOURCE = "export default {};\n";

describe("doctor config-precedence check", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await fse.writeJson(path.join(tempDir, ".lisa.config.json"), {
      harness: "claude",
    });
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("reports the outranked file when both configs are present", async () => {
    await fse.writeJson(path.join(tempDir, "knip.json"), { entry: ["src"] });
    await fse.writeFile(
      path.join(tempDir, "knip.ts"),
      "export default { entry: ['src/index.ts'] };\n"
    );

    const check = await checkConfigShadowing(tempDir);

    expect(check.status).toBe("fail");
    expect(check.detail).toContain("knip.json outranks knip.ts");
    expect(check.detail).toContain("not being read");
  });

  it("stays quiet when knip is configured only as knip.json", async () => {
    await fse.writeJson(path.join(tempDir, "knip.json"), { entry: ["src"] });

    const check = await checkConfigShadowing(tempDir);

    expect(check.status).toBe("ok");
    expect(check.detail).not.toContain("knip.json");
  });

  it("stays quiet when knip is configured only in TypeScript", async () => {
    await fse.writeFile(path.join(tempDir, "knip.ts"), KNIP_TS_SOURCE);

    const check = await checkConfigShadowing(tempDir);

    expect(check.status).toBe("ok");
    expect(check.detail).not.toContain("knip.ts");
  });

  it("reports every spelling knip actually resolves", async () => {
    for (const sibling of [
      "knip.jsonc",
      ".knip.json",
      ".knip.jsonc",
      "knip.ts",
      "knip.js",
      "knip.config.ts",
      "knip.config.js",
    ]) {
      const projectRoot = await createTempDir();
      await fse.writeJson(path.join(projectRoot, "knip.json"), {});
      await fse.writeFile(path.join(projectRoot, sibling), "{}\n");

      const check = await checkConfigShadowing(projectRoot);

      expect(check.status).toBe("fail");
      expect(check.detail).toContain(`knip.json outranks ${sibling}`);
      await cleanupTempDir(projectRoot);
    }
  });

  it("stays quiet for a spelling knip never reads", async () => {
    // `knip.mjs` is not in KNIP_CONFIG_LOCATIONS, so it configures nothing and
    // shadows nothing. Reporting it would send an operator to delete a working
    // seed in favour of a file the tool ignores.
    await fse.writeJson(path.join(tempDir, "knip.json"), {});
    await fse.writeFile(path.join(tempDir, "knip.mjs"), KNIP_TS_SOURCE);

    const check = await checkConfigShadowing(tempDir);

    expect(check.status).toBe("ok");
  });

  it("ignores a knip.json nested below the repository root", async () => {
    await fse.writeFile(path.join(tempDir, "knip.ts"), KNIP_TS_SOURCE);
    await fse.outputJson(path.join(tempDir, "packages/app/knip.json"), {});

    const check = await checkConfigShadowing(tempDir);

    expect(check.status).toBe("ok");
  });

  it("fails rather than passing when the tree cannot be inspected", async () => {
    const check = await checkConfigShadowing(
      path.join(tempDir, "no-such-project")
    );

    expect(check.status).toBe("fail");
    expect(check.detail).toContain("Could not determine config precedence");
  });

  it("fails rather than passing when a probe is refused", async () => {
    // The failure mode this check exists to end, aimed at the check itself: a
    // tree it cannot read must not render as a tree with nothing in it.
    const projectRoot = await createTempDir();
    await fse.chmod(projectRoot, 0o000);
    try {
      const check = await checkConfigShadowing(projectRoot);

      expect(check.status).toBe("fail");
      expect(check.detail).toContain("Could not determine config precedence");
      expect(check.detail).toContain("EACCES");
    } finally {
      await fse.chmod(projectRoot, 0o700);
      await cleanupTempDir(projectRoot);
    }
  });

  it("runs as part of lisa doctor", async () => {
    await fse.writeJson(path.join(tempDir, "knip.json"), {});
    await fse.writeFile(path.join(tempDir, "knip.ts"), KNIP_TS_SOURCE);

    const setExitCode = vi.fn();
    const result = await runDoctor(
      tempDir,
      { offline: true },
      {
        write: vi.fn(),
        setExitCode,
        runUpdateCheck: vi.fn().mockResolvedValue({ updateAvailable: false }),
      }
    );

    const check = result.checks.find(
      candidate => candidate.name === CONFIG_SHADOWING_CHECK_NAME
    );
    expect(check?.status).toBe("fail");
    expect(setExitCode).toHaveBeenCalledWith(1);
  });
});

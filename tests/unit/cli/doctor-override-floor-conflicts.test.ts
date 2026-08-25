/**
 * Doctor coverage for an override that would resolve a Lisa floor DOWNWARDS.
 *
 * The defect these close is not a wrong answer — `lisa apply` already refuses
 * correctly. It is that the refusal arrives from inside a `postinstall`, on a
 * machine that has already committed to updating, with nothing anywhere having
 * said the project was exposed. Measured across the local workspace checkouts
 * when CodySwannGT/lisa#2754 was filed: 14 such overrides across four
 * repositories, none of them detectable in advance.
 *
 * Two of these cases are the ones that keep the check honest rather than
 * merely present:
 *
 * - the negative control — a direct dependency AT the floor must stay quiet, or
 *   the check fires on the fixed state and gets ignored;
 * - the inert cases — zero floors resolved, or an unparseable manifest, must
 *   FAIL rather than report an all-clear over an empty conflict list.
 * @module tests/unit/cli/doctor-override-floor-conflicts
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkOverrideFloorConflicts } from "../../../src/cli/doctor-override-floor-conflicts.js";
import { runDoctor } from "../../../src/cli/doctor.js";
import {
  cleanupTempDir,
  createTempDir,
  createTypeScriptProject,
} from "../../helpers/test-utils.js";

const CHECK_NAME = "Override self-references safe?";

describe("checkOverrideFloorConflicts", () => {
  let tempDir: string;
  let lisaRoot: string;
  let projectDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaRoot = path.join(tempDir, "lisa");
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(lisaRoot);
    await fs.ensureDir(projectDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Write a package.lisa.json template into the fixture Lisa root.
   * @param typeName - Project type directory (e.g. "typescript")
   * @param template - Template contents
   */
  async function writeTemplate(
    typeName: string,
    template: object
  ): Promise<void> {
    const dir = path.join(lisaRoot, typeName, "package-lisa");
    await fs.ensureDir(dir);
    await fs.writeJson(path.join(dir, "package.lisa.json"), template);
  }

  /**
   * Write the host manifest for the fixture project.
   * @param manifest - package.json contents
   */
  async function writeManifest(manifest: object): Promise<void> {
    await fs.writeJson(path.join(projectDir, "package.json"), manifest);
  }

  it("reports the package, both ranges, and the raise needed", async () => {
    await createTypeScriptProject(projectDir);
    await writeTemplate("typescript", {
      force: { overrides: { vite: "^8.0.16" } },
    });
    await writeManifest({
      name: "host",
      dependencies: { typescript: "^5.0.0" },
      devDependencies: { vite: "^8.0.5" },
    });

    const result = await checkOverrideFloorConflicts(projectDir, lisaRoot);

    expect(result.name).toBe(CHECK_NAME);
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("overrides.vite");
    expect(result.detail).toContain("direct ^8.0.5");
    expect(result.detail).toContain("Lisa floor ^8.0.16");
    expect(result.detail).toContain(
      'Raise the direct dependency vite from "^8.0.5" to "^8.0.16"'
    );
  });

  it("does NOT report a direct dependency that satisfies the floor", async () => {
    await createTypeScriptProject(projectDir);
    await writeTemplate("typescript", {
      force: { overrides: { vite: "^8.0.16" } },
    });
    await writeManifest({
      name: "host",
      dependencies: { typescript: "^5.0.0" },
      devDependencies: { vite: "^8.0.16" },
    });

    const result = await checkOverrideFloorConflicts(projectDir, lisaRoot);

    expect(result.status).toBe("ok");
    expect(result.detail).toContain("No override resolves below a Lisa floor");
  });

  it("does NOT report a self-reference on a package Lisa does not floor", async () => {
    await createTypeScriptProject(projectDir);
    await writeTemplate("typescript", {
      force: { overrides: { vite: "^8.0.16" } },
    });
    await writeManifest({
      name: "host",
      dependencies: { typescript: "^5.0.0" },
      devDependencies: { vite: "^8.0.16", tailwindcss: "^3.4.7" },
      overrides: { tailwindcss: "$tailwindcss" },
    });

    const result = await checkOverrideFloorConflicts(projectDir, lisaRoot);

    expect(result.status).toBe("ok");
  });

  it("prints what it inspected, so an empty finding carries its denominator", async () => {
    await createTypeScriptProject(projectDir);
    await writeTemplate("typescript", {
      force: {
        overrides: { vite: "^8.0.16" },
        resolutions: { vite: "^8.0.16" },
      },
    });
    await writeManifest({
      name: "host",
      dependencies: { typescript: "^5.0.0" },
      devDependencies: { vite: "^8.0.16" },
    });

    const result = await checkOverrideFloorConflicts(projectDir, lisaRoot);

    expect(result.detail).toContain("2 Lisa floors");
    expect(result.detail).toContain("postinstall: 2 overrides, 2 judged");
    expect(result.detail).toContain("full apply: 2 overrides, 2 judged");
  });

  it("fails rather than passes when package.json is not parseable", async () => {
    await fs.writeFile(path.join(projectDir, "tsconfig.json"), "{}");
    await writeTemplate("typescript", {
      force: { overrides: { vite: "^8.0.16" } },
    });
    await fs.writeFile(path.join(projectDir, "package.json"), "{ not json");

    const result = await checkOverrideFloorConflicts(projectDir, lisaRoot);

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("Could not verify");
    expect(result.detail).toContain("not parseable JSON");
  });

  it("fails rather than passes when a detected project type resolves zero floors", async () => {
    await createTypeScriptProject(projectDir);
    await writeTemplate("typescript", { force: {} });

    const result = await checkOverrideFloorConflicts(projectDir, lisaRoot);

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("resolved 0 override floors");
    expect(result.detail).toContain("typescript");
    expect(result.detail).toContain("this is not a pass");
  });

  it("does not count a $name template entry as a floor", async () => {
    await createTypeScriptProject(projectDir);
    await writeTemplate("typescript", {
      force: { overrides: { vite: "$vite" } },
    });

    const result = await checkOverrideFloorConflicts(projectDir, lisaRoot);

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("resolved 0 override floors");
  });

  it("warns rather than passes when floors exist but no manifest does", async () => {
    await fs.writeFile(path.join(projectDir, "tsconfig.json"), "{}");
    await writeTemplate("typescript", {
      force: { overrides: { vite: "^8.0.16" } },
    });

    const result = await checkOverrideFloorConflicts(projectDir, lisaRoot);

    expect(result.status).toBe("warn");
    expect(result.detail).toContain("0 manifests inspected");
  });

  it("says not applicable when no Lisa project type is detected", async () => {
    const result = await checkOverrideFloorConflicts(projectDir, lisaRoot);

    expect(result.status).toBe("ok");
    expect(result.detail).toContain("Not applicable");
    expect(result.detail).toContain("0 floors, 0 manifests inspected");
  });

  it("names the apply paths that would refuse", async () => {
    await createTypeScriptProject(projectDir);
    await writeTemplate("typescript", {
      force: { resolutions: { axios: ">=1.18.0" } },
    });
    await writeManifest({
      name: "host",
      dependencies: { typescript: "^5.0.0", axios: "^1.16.0" },
    });

    const result = await checkOverrideFloorConflicts(projectDir, lisaRoot);

    expect(result.status).toBe("fail");
    expect(result.detail).toContain("refuses on postinstall and full apply");
    expect(result.detail).toContain(
      'Raise the direct dependency axios from "^1.16.0" to "^1.18.0"'
    );
  });
});

describe("lisa doctor wiring", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("runs the override self-reference check", async () => {
    const result = await runDoctor(
      tempDir,
      { offline: true },
      { setExitCode: () => {}, write: () => {} }
    );

    expect(result.checks.map(check => check.name)).toContain(CHECK_NAME);
  });
});

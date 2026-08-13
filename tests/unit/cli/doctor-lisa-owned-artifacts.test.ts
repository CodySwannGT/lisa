/**
 * The fleet's way to notice it is running an old enforcement guard.
 *
 * Apply delivers Lisa-owned artifacts on a version bump, so this check is
 * normally quiet — but a project that pinned an old Lisa, or that never
 * re-applied after upgrading, still runs whatever it has, and before this check
 * nothing anywhere said so.
 * @module tests/unit/cli/doctor-lisa-owned-artifacts
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkLisaOwnedArtifacts } from "../../../src/cli/doctor-lisa-owned-artifacts.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const GUARD = "scripts/lisa-hooks/block-no-verify.sh";
const HOST_CONFIG = "tsconfig.json";
const SHIPPED_GUARD = "#!/usr/bin/env bash\n# closed\n";
const OLD_GUARD = "#!/usr/bin/env bash\n# fails open\n";
const ENTRYPOINT = "scripts/lisa-work-item.mjs";
const LISA_PACKAGE = '{"name":"@codyswann/lisa"}';
const HOST_PACKAGE = '{"name":"some-host-app"}';
const OK = "ok";
const WARN = "warn";

/**
 * Absolute path of a destination as the `all` stack ships it.
 * @param lisaRoot - Lisa package root shipping the template.
 * @param destination - Project-relative destination path.
 * @returns Absolute path to the shipped template.
 */
function shippedPath(lisaRoot: string, destination: string): string {
  return path.join(lisaRoot, "all", "copy-overwrite", destination);
}

/**
 * Write a project package.json so the check can tell Lisa's own repository from
 * an ordinary host project.
 * @param projectDir - Project root to write into.
 * @param contents - package.json body.
 */
async function writePackageJson(
  projectDir: string,
  contents: string
): Promise<void> {
  await fs.outputFile(path.join(projectDir, "package.json"), contents);
}

/**
 * Build the trampoline Lisa's own repository keeps at a Lisa-owned entrypoint:
 * a few lines that re-export the shipped implementation instead of duplicating
 * 50KB of it. The specifier is computed rather than written out so the test
 * asserts on a path that genuinely resolves to the shipped file.
 * @param projectDir - Project root the trampoline is installed into.
 * @param lisaRoot - Lisa package root shipping the template.
 * @returns Trampoline file contents.
 */
function trampolineFor(projectDir: string, lisaRoot: string): string {
  const specifier = path
    .relative(
      path.dirname(path.join(projectDir, ENTRYPOINT)),
      shippedPath(lisaRoot, ENTRYPOINT)
    )
    .split(path.sep)
    .join("/");
  return `#!/usr/bin/env node\n\n// The installed copy lives under all/copy-overwrite.\nimport { runCli } from "${specifier}";\n\nrunCli();\n`;
}

describe("checkLisaOwnedArtifacts", () => {
  let tempDir: string;
  let lisaRoot: string;
  let projectDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaRoot = path.join(tempDir, "lisa");
    projectDir = path.join(tempDir, "project");
    await fs.outputFile(shippedPath(lisaRoot, GUARD), SHIPPED_GUARD);
    await fs.outputFile(shippedPath(lisaRoot, HOST_CONFIG), '{"strict":true}');
    await fs.outputFile(
      shippedPath(lisaRoot, ENTRYPOINT),
      "export function runCli() {}\n"
    );
    await fs.ensureDir(projectDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("warns and names the guard when the project has an older copy", async () => {
    await fs.outputFile(path.join(projectDir, GUARD), OLD_GUARD);

    const check = await checkLisaOwnedArtifacts(projectDir, lisaRoot);

    expect(check.status).toBe(WARN);
    expect(check.detail).toContain(GUARD);
  });

  it("passes when the guard matches what Lisa ships", async () => {
    await fs.outputFile(path.join(projectDir, GUARD), SHIPPED_GUARD);

    const check = await checkLisaOwnedArtifacts(projectDir, lisaRoot);

    expect(check.status).toBe(OK);
  });

  it("passes when the project never installed the guard", async () => {
    // A missing artifact means the stack does not apply here, not drift.
    const check = await checkLisaOwnedArtifacts(projectDir, lisaRoot);

    expect(check.status).toBe(OK);
  });

  it("ignores drift in host-owned managed config", async () => {
    // Customised build config is exactly what a project is allowed to do; this
    // check is only about the files Lisa owns.
    await fs.outputFile(path.join(projectDir, GUARD), SHIPPED_GUARD);
    await fs.outputFile(path.join(projectDir, HOST_CONFIG), "{}");

    const check = await checkLisaOwnedArtifacts(projectDir, lisaRoot);

    expect(check.status).toBe(OK);
  });

  it("respects .lisaignore", async () => {
    // A project that deliberately holds its own copy said so already.
    await fs.outputFile(path.join(projectDir, GUARD), OLD_GUARD);
    await fs.outputFile(
      path.join(projectDir, ".lisaignore"),
      "scripts/lisa-hooks/\n"
    );

    const check = await checkLisaOwnedArtifacts(projectDir, lisaRoot);

    expect(check.status).toBe(OK);
  });

  describe("when the project is Lisa's own repository", () => {
    beforeEach(async () => {
      await writePackageJson(projectDir, LISA_PACKAGE);
    });

    it("does not report a trampoline that re-exports the shipped template", async () => {
      // Lisa's own repo cannot hold a byte copy of a file it also ships: the
      // entrypoint is a re-export so its hooks and CI run the exact shipped
      // implementation. That is the opposite of drift, and calling it drift in
      // Lisa's own repo teaches everyone to ignore this check.
      await fs.outputFile(
        path.join(projectDir, ENTRYPOINT),
        trampolineFor(projectDir, lisaRoot)
      );

      const check = await checkLisaOwnedArtifacts(projectDir, lisaRoot);

      expect(check.status).toBe(OK);
    });

    it("still reports a guard that genuinely drifted", async () => {
      // The exemption is for re-exports, not for Lisa's repo wholesale.
      await fs.outputFile(path.join(projectDir, GUARD), OLD_GUARD);

      const check = await checkLisaOwnedArtifacts(projectDir, lisaRoot);

      expect(check.status).toBe(WARN);
      expect(check.detail).toContain(GUARD);
    });

    it("still reports a stub that points somewhere other than the template", async () => {
      await fs.outputFile(
        path.join(projectDir, ENTRYPOINT),
        'import { runCli } from "./somewhere-else.mjs";\n\nrunCli();\n'
      );

      const check = await checkLisaOwnedArtifacts(projectDir, lisaRoot);

      expect(check.status).toBe(WARN);
      expect(check.detail).toContain(ENTRYPOINT);
    });
  });

  it("does not exempt a trampoline in an ordinary host project", async () => {
    // Load-bearing: drift detection is what makes Lisa's fixes reach installed
    // repos. A host must never be able to swap a guard for a thin re-export and
    // have doctor call it current.
    await writePackageJson(projectDir, HOST_PACKAGE);
    await fs.outputFile(
      path.join(projectDir, ENTRYPOINT),
      trampolineFor(projectDir, lisaRoot)
    );

    const check = await checkLisaOwnedArtifacts(projectDir, lisaRoot);

    expect(check.status).toBe(WARN);
    expect(check.detail).toContain(ENTRYPOINT);
  });
});

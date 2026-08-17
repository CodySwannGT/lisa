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
import { createHash } from "node:crypto";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkLisaOwnedArtifacts } from "../../../src/cli/doctor-lisa-owned-artifacts.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const GUARD = "scripts/lisa-hooks/block-no-verify.sh";
const HOST_CONFIG = "tsconfig.json";
const GENERATED_ARTIFACT = "scripts/lisa-new-artifact.mjs";
const SHIPPED_GUARD = "#!/usr/bin/env bash\n# closed\n";
const OLD_GUARD = "#!/usr/bin/env bash\n# fails open\n";
const SHIPPED_GENERATED = "export const governed = true;\n";
const SHIPPED_GUARD_VERSION = "sha256:1f8d79a5e303";
const OLD_GUARD_VERSION = "sha256:5708bbd8b37f";
const SHIPPED_GENERATED_VERSION = "sha256:c534dbb9ff9e";
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

/**
 * A ledger declaring `OLD_GUARD` to be bytes Lisa genuinely published.
 *
 * That is what a project sitting on an older release actually has. Omitting it
 * would make the fixture content Lisa never shipped, which the check correctly
 * reads as a downstream edit rather than as drift — so a test meaning to
 * exercise "outdated" would quietly exercise "modified" instead.
 * @returns Hash ledger for injection
 */
function shippedLedger(): Readonly<Record<string, readonly string[]>> {
  return {
    [GUARD]: [
      createHash("sha256").update(Buffer.from(OLD_GUARD)).digest("hex"),
    ],
  };
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

    const check = await checkLisaOwnedArtifacts(
      projectDir,
      lisaRoot,
      shippedLedger()
    );

    expect(check.status).toBe(WARN);
    expect(check.detail).toContain(GUARD);
    expect(check.detail).toContain("Outdated");
  });

  it("tells an operator to run apply only when apply would actually help", async () => {
    // A downstream edit is still worth a warn — a project that swapped a guard
    // for a stub should not get silence — but it must not be labelled outdated,
    // because apply will now deliberately keep the project's copy. Sending the
    // operator to `lisa apply .` here is a loop with no exit.
    await fs.outputFile(
      path.join(projectDir, GUARD),
      "#!/usr/bin/env bash\n# hardened downstream\n"
    );

    const check = await checkLisaOwnedArtifacts(
      projectDir,
      lisaRoot,
      shippedLedger()
    );

    expect(check.status).toBe(WARN);
    expect(check.detail).toContain(GUARD);
    expect(check.detail).not.toContain("Outdated");
    expect(check.detail).toContain("keep yours");
  });

  it("passes when the guard matches what Lisa ships", async () => {
    await fs.outputFile(path.join(projectDir, GUARD), SHIPPED_GUARD);

    const check = await checkLisaOwnedArtifacts(projectDir, lisaRoot);

    expect(check.status).toBe(OK);
    expect(check.detail).toContain("Resolvable Lisa-owned artifact copies");
    expect(check.detail).toContain(`governed by project:${GUARD} first`);
    expect(check.detail).toContain(
      `project:${GUARD}@${SHIPPED_GUARD_VERSION} governs`
    );
    expect(check.detail).toContain(
      `package:all/copy-overwrite/${GUARD}@${SHIPPED_GUARD_VERSION}`
    );
  });

  it("passes when the project never installed the guard", async () => {
    // A missing artifact means the stack does not apply here, not drift.
    const check = await checkLisaOwnedArtifacts(projectDir, lisaRoot);

    expect(check.status).toBe(OK);
    expect(check.detail).not.toContain("Resolvable Lisa-owned artifact copies");
  });

  it("warns when resolvable Lisa-owned artifact copies disagree", async () => {
    await fs.outputFile(path.join(projectDir, GUARD), OLD_GUARD);

    const check = await checkLisaOwnedArtifacts(
      projectDir,
      lisaRoot,
      shippedLedger()
    );

    expect(check.status).toBe(WARN);
    expect(check.detail).toContain(
      "Resolvable Lisa-owned artifact copies disagree"
    );
    expect(check.detail).toContain(`governed by project:${GUARD} first`);
    expect(check.detail).toContain(
      `project:${GUARD}@${OLD_GUARD_VERSION} governs`
    );
    expect(check.detail).toContain(
      `package:all/copy-overwrite/${GUARD}@${SHIPPED_GUARD_VERSION}`
    );
  });

  it("discovers newly shipped Lisa-owned artifacts from copy-overwrite sources", async () => {
    await fs.outputFile(
      path.join(lisaRoot, "typescript", "copy-overwrite", GENERATED_ARTIFACT),
      SHIPPED_GENERATED
    );
    await fs.outputFile(
      path.join(projectDir, GENERATED_ARTIFACT),
      SHIPPED_GENERATED
    );

    const check = await checkLisaOwnedArtifacts(projectDir, lisaRoot);

    expect(check.status).toBe(OK);
    expect(check.detail).toContain(GENERATED_ARTIFACT);
    expect(check.detail).toContain(
      `project:${GENERATED_ARTIFACT}@${SHIPPED_GENERATED_VERSION} governs`
    );
    expect(check.detail).toContain(
      `package:typescript/copy-overwrite/${GENERATED_ARTIFACT}@${SHIPPED_GENERATED_VERSION}`
    );
  });

  it("ignores drift in host-owned managed config", async () => {
    // Customised build config is exactly what a project is allowed to do; this
    // check is only about the files Lisa owns.
    await fs.outputFile(path.join(projectDir, GUARD), SHIPPED_GUARD);
    await fs.outputFile(path.join(projectDir, HOST_CONFIG), "{}");

    const check = await checkLisaOwnedArtifacts(projectDir, lisaRoot);

    expect(check.status).toBe(OK);
  });

  it("keeps .lisaignore unassessed while still reporting copy disagreement", async () => {
    // A project that deliberately holds its own copy said so already, but the
    // operator still needs to know there are multiple resolvable copies and
    // which one the documented invocation path reaches.
    await fs.outputFile(path.join(projectDir, GUARD), OLD_GUARD);
    await fs.outputFile(
      path.join(projectDir, ".lisaignore"),
      "scripts/lisa-hooks/\n"
    );

    const check = await checkLisaOwnedArtifacts(projectDir, lisaRoot);

    expect(check.status).toBe(WARN);
    expect(check.detail).toContain("not assessed (.lisaignore)");
    expect(check.detail).toContain(
      "Resolvable Lisa-owned artifact copies disagree"
    );
    expect(check.detail).toContain(
      `project:${GUARD}@${OLD_GUARD_VERSION} governs`
    );
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

/**
 * The audit hash-checks every installed copy of a patched package, so it must
 * find every copy: hoisted, nested, in an isolated store, and under a linked
 * workspace package, whose own node_modules can hold a copy of a different
 * version. Links are followed by real path, so a copy reached through several
 * links counts once and a link back up the tree cannot loop.
 */
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyCapturedAudit } from "../../../src/core/audit.js";
import { installedCopies } from "../../../src/core/audit-installed-copies.js";
import {
  PATCH_FILE,
  PRISTINE,
  UNPATCHED_ONLY,
  fixture,
  put,
  removeFixtures,
  report,
} from "../../helpers/audit-patch-fixture.js";

afterEach(removeFixtures);

/** A workspace package directory, relative to the fixture root. */
const APP = "packages/app";

/**
 * Link a workspace package into node_modules, as Bun and npm workspaces do.
 * @param root - Fixture root
 * @param link - Path under node_modules
 * @param target - Workspace package directory, relative to the root
 */
function linkWorkspace(root: string, link: string, target: string): void {
  mkdirSync(join(root, target), { recursive: true });
  mkdirSync(join(root, "node_modules", link, ".."), { recursive: true });
  symlinkSync(join(root, target), join(root, "node_modules", link));
}

/**
 * The versions of every copy found, sorted.
 * @param root - Fixture root
 * @returns Versions
 */
const versions = (root: string) =>
  installedCopies(root, "glob")
    .map(copy => copy.version)
    .sort((a, b) => a.localeCompare(b));

describe("installed copies of a patched package", () => {
  it("finds hoisted and isolated copies and counts a linked copy once", () => {
    const root = fixture();
    put(
      root,
      "node_modules/parent/node_modules/glob/package.json",
      '{"name":"glob","version":"0.9.0"}'
    );
    symlinkSync(
      join(root, "node_modules/.bun/glob@1.0.0/node_modules/glob"),
      join(root, "node_modules/glob")
    );
    expect(versions(root)).toEqual(["0.9.0", "1.0.0"]);
  });

  it("finds a copy under a linked workspace package, scoped or not", () => {
    const root = fixture();
    linkWorkspace(root, "app", APP);
    linkWorkspace(root, "@ws/lib", "packages/lib");
    put(
      root,
      "packages/app/node_modules/glob/package.json",
      '{"name":"glob","version":"0.8.0"}'
    );
    put(
      root,
      "packages/lib/node_modules/glob/package.json",
      '{"name":"glob","version":"0.7.0"}'
    );
    expect(versions(root)).toEqual(["0.7.0", "0.8.0", "1.0.0"]);
  });

  it("stops at a link back up the tree and skips a broken link", () => {
    const root = fixture();
    linkWorkspace(root, "app", APP);
    mkdirSync(join(root, "packages/app/node_modules"), { recursive: true });
    symlinkSync(join(root, APP), join(root, "packages/app/node_modules/self"));
    symlinkSync(root, join(root, "packages/app/node_modules/root"));
    symlinkSync(
      join(root, "missing"),
      join(root, "packages/app/node_modules/broken")
    );
    expect(versions(root)).toEqual(["1.0.0"]);
  });

  it("fails the audit when a linked workspace package holds an unpatched copy", async () => {
    const root = fixture();
    linkWorkspace(root, "app", APP);
    put(
      root,
      "packages/app/node_modules/glob/package.json",
      '{"name":"glob","version":"1.0.0"}'
    );
    put(root, "packages/app/node_modules/glob/lib/index.js", PRISTINE);
    const verdict = await verifyCapturedAudit(root, "bun", report(), {
      publishedVersions: UNPATCHED_ONLY,
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.messages.join("\n")).toContain(
      `installed files do not match ${PATCH_FILE}`
    );
  });
});

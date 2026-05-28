/**
 * Unit tests for the hooks installer's rules mirror — verifies that
 * `plugins/<name>/rules/{eager,reference}/*.md` is mirrored into
 * `.codex/lisa-rules/{eager,reference}/*.md` with subdir structure
 * preserved, that the flat `rules/*.md` shape is still mirrored for
 * backward compatibility, and that path collisions across plugins fail
 * the install. Kept separate from the main installer test file so each
 * stays under the project's max-lines rule.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LISA_RULES_SUBDIR,
  installHooks,
} from "../../../src/codex/hooks-installer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** Rule .md file shipped from the lisa plugin. */
const BASE_RULES_MD = "base-rules.md";
/** Second rule .md file shipped from the lisa plugin. */
const CODING_PHILOSOPHY_MD = "coding-philosophy.md";
/** Stack plugin name reused across cases that exercise stack rules. */
const HARPER_FABRIC = "harper-fabric";
/** Rule .md file shipped from the Harper/Fabric stack plugin. */
const HARPER_FABRIC_MD = `${HARPER_FABRIC}.md`;
/** Stack plugin directory under plugins/. */
const HARPER_FABRIC_PLUGIN = `lisa-${HARPER_FABRIC}`;
/** Eager subdir name used in both source and destination layouts. */
const EAGER = "eager";
/** Reference subdir name used in both source and destination layouts. */
const REFERENCE = "reference";

describe("codex/hooks-installer rules mirror", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");
    await fs.ensureDir(destDir);

    const rulesDir = path.join(lisaDir, "plugins", "lisa", "rules");
    const eagerDir = path.join(rulesDir, EAGER);
    const referenceDir = path.join(rulesDir, REFERENCE);
    await fs.ensureDir(eagerDir);
    await fs.ensureDir(referenceDir);
    await fs.writeFile(
      path.join(eagerDir, BASE_RULES_MD),
      "# Base Rules (load-bearing)\n\nFollow these.\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(referenceDir, BASE_RULES_MD),
      "# Base Rules — full reference\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(eagerDir, CODING_PHILOSOPHY_MD),
      "# Coding Philosophy (load-bearing)\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(referenceDir, CODING_PHILOSOPHY_MD),
      "# Coding Philosophy — full reference\n",
      "utf8"
    );
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("preserves the eager/reference split when mirroring lisa-plugin rules", async () => {
    await installHooks(lisaDir, destDir, []);
    const rulesDir = path.join(destDir, ".codex", LISA_RULES_SUBDIR);
    expect(await fs.pathExists(path.join(rulesDir, EAGER, BASE_RULES_MD))).toBe(
      true
    );
    expect(
      await fs.pathExists(path.join(rulesDir, REFERENCE, BASE_RULES_MD))
    ).toBe(true);
    expect(
      await fs.pathExists(path.join(rulesDir, EAGER, CODING_PHILOSOPHY_MD))
    ).toBe(true);
    expect(
      await fs.pathExists(path.join(rulesDir, REFERENCE, CODING_PHILOSOPHY_MD))
    ).toBe(true);
    const eagerBase = await fs.readFile(
      path.join(rulesDir, EAGER, BASE_RULES_MD),
      "utf8"
    );
    expect(eagerBase).toContain("load-bearing");
    const refBase = await fs.readFile(
      path.join(rulesDir, REFERENCE, BASE_RULES_MD),
      "utf8"
    );
    expect(refBase).toContain("full reference");
  });

  it("mirrors detected stack plugin rules alongside lisa-plugin rules", async () => {
    const harperEagerDir = path.join(
      lisaDir,
      "plugins",
      HARPER_FABRIC_PLUGIN,
      "rules",
      EAGER
    );
    await fs.ensureDir(harperEagerDir);
    await fs.writeFile(
      path.join(harperEagerDir, HARPER_FABRIC_MD),
      "# Harper/Fabric Project Rules (load-bearing)\n",
      "utf8"
    );

    await installHooks(lisaDir, destDir, ["typescript", HARPER_FABRIC]);

    const rulesDir = path.join(destDir, ".codex", LISA_RULES_SUBDIR);
    expect(await fs.pathExists(path.join(rulesDir, EAGER, BASE_RULES_MD))).toBe(
      true
    );
    expect(
      await fs.pathExists(path.join(rulesDir, EAGER, HARPER_FABRIC_MD))
    ).toBe(true);
  });

  it("falls back to mirroring flat rules/*.md for older plugin builds", async () => {
    // Simulate an older plugin build that ships rules flat under rules/.
    const legacyRulesDir = path.join(
      lisaDir,
      "plugins",
      HARPER_FABRIC_PLUGIN,
      "rules"
    );
    await fs.ensureDir(legacyRulesDir);
    await fs.writeFile(
      path.join(legacyRulesDir, HARPER_FABRIC_MD),
      "# Legacy flat rule\n",
      "utf8"
    );

    await installHooks(lisaDir, destDir, [HARPER_FABRIC]);

    const destRulesDir = path.join(destDir, ".codex", LISA_RULES_SUBDIR);
    expect(await fs.pathExists(path.join(destRulesDir, HARPER_FABRIC_MD))).toBe(
      true
    );
  });

  it("throws when two plugins ship rules at the same relative path", async () => {
    const harperEagerDir = path.join(
      lisaDir,
      "plugins",
      HARPER_FABRIC_PLUGIN,
      "rules",
      EAGER
    );
    await fs.ensureDir(harperEagerDir);
    await fs.writeFile(
      path.join(harperEagerDir, BASE_RULES_MD),
      "# Duplicate Rule (load-bearing)\n",
      "utf8"
    );

    await expect(
      installHooks(lisaDir, destDir, [HARPER_FABRIC])
    ).rejects.toThrow(
      `Duplicate Lisa rule path "${path.join(EAGER, BASE_RULES_MD)}"`
    );
  });
});

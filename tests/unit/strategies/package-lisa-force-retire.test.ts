import * as fs from "fs-extra";
import * as path from "node:path";
import { satisfies, subset, validRange } from "semver";
import { PackageLisaStrategy } from "../../../src/strategies/package-lisa.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import type { LisaConfig } from "../../../src/core/config.js";
import {
  createTempDir,
  cleanupTempDir,
  createTypeScriptProject,
} from "../../helpers/test-utils.js";
import { describe, expect, it } from "vitest";
import {
  APPLYING_VERSION,
  buildStrategyContext,
  writePackageLisaTemplate,
  PACKAGE_JSON,
  PACKAGE_LISA_DIR,
  PACKAGE_LISA_JSON,
  MY_PROJECT,
  HOST_PROJECT,
} from "./package-lisa-fixtures.js";

/** A host compound range whose hand-written ceiling excludes the next major. */
const HOST_COMPOUND_RANGE = ">=5.0.9 <6.0.0";

/** A host compound range whose inclusive ceiling admits the next major. */
const HOST_INCLUSIVE_CEILING_RANGE = ">=5.0.9 <=6.0.0";

describe("PackageLisaStrategy", () => {
  let strategy: PackageLisaStrategy;
  let tempDir: string;
  let lisaDir: string;
  let projectDir: string;

  beforeEach(async () => {
    strategy = new PackageLisaStrategy(() => APPLYING_VERSION);
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(lisaDir);
    await fs.ensureDir(projectDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Create a strategy context for testing
   * @param overrides - Configuration overrides for this test case
   * @returns StrategyContext with mocked callbacks
   */
  function createContext(overrides: Partial<LisaConfig> = {}): StrategyContext {
    return buildStrategyContext(lisaDir, projectDir, overrides);
  }

  /**
   * Create package.lisa.json template in Lisa directory
   * @param typeName - The project type (e.g., "all", "typescript", "expo")
   * @param template - The package.lisa.json template object with force/defaults/merge sections
   * @returns Promise resolving when template is created
   */
  async function createPackageLisaTemplate(
    typeName: string,
    template: object
  ): Promise<void> {
    await writePackageLisaTemplate(lisaDir, typeName, template);
  }

  describe("force behavior", () => {
    it("still raises a host direct dependency that sits below the template floor", async () => {
      await createPackageLisaTemplate("typescript", {
        force: { dependencies: { tar: ">=7.5.21" } },
      });

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: HOST_PROJECT,
        dependencies: { tar: ">=7.5.19" },
      });

      await strategy.apply(sourcePath, destPath, PACKAGE_JSON, createContext());

      const content = await fs.readJson(destPath);
      expect(content.dependencies.tar).toBe(">=7.5.21");
    });

    // Regression: a security floor that turns out to be harmful cannot be
    // corrected by lowering it — `preserveHigherHostPins` keeps whichever side
    // is higher, so the host's copy of the bad pin wins and the fix never
    // lands. Retiring the key through `remove` is the path that reaches an
    // already-written host, which is why `brace-expansion` left the templates
    // that way rather than by being re-pinned.
    it("deletes a retired override key from a host that already carries it", async () => {
      await createPackageLisaTemplate("typescript", {
        remove: {
          resolutions: ["brace-expansion"],
          overrides: ["brace-expansion"],
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: HOST_PROJECT,
        // What a previous `lisa apply` wrote here.
        resolutions: { "brace-expansion": ">=5.0.9", tar: ">=7.5.21" },
        overrides: { "brace-expansion": ">=5.0.9", tar: ">=7.5.21" },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
        createContext({ skipGitCheck: true })
      );

      const content = await fs.readJson(destPath);
      for (const section of ["resolutions", "overrides"] as const) {
        expect(content[section]["brace-expansion"]).toBeUndefined();
        // Neighbouring pins in the same section are untouched.
        expect(content[section].tar).toBe(">=7.5.21");
      }
    });

    // An unparseable range (a git URL, an npm alias) cannot be compared, so the
    // template value stands — the guard may only ever RAISE a pin, never block a
    // force-bump it failed to reason about. Uses a package that is NOT a direct
    // dependency, so `normalizeSelfReferencingOverrides` does not rewrite the
    // result into npm's `"$name"` form and mask what is being asserted.
    it("applies the template pin when the host range is not comparable", async () => {
      await createPackageLisaTemplate("typescript", {
        force: { overrides: { "transitive-only": ">=2.0.0" } },
      });

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: HOST_PROJECT,
        overrides: { "transitive-only": "github:someone/transitive-only" },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
        createContext({ skipGitCheck: true })
      );

      const content = await fs.readJson(destPath);
      expect(content.overrides["transitive-only"]).toBe(">=2.0.0");
    });

    // Regression: force.resolutions and force.overrides must replace project-side
    // values for package-level dep pinning (e.g. axios). This is the write that
    // was silently lost when `bun add -d @codyswann/lisa@latest` clobbered
    // postinstall changes; see utils/postinstall-trampoline.ts for the
    // package-manager race context.
    it("replaces project resolutions.<pkg> and overrides.<pkg> via force", async () => {
      await createPackageLisaTemplate("typescript", {
        force: {
          resolutions: { axios: ">=1.15.0" },
          overrides: { axios: ">=1.15.0" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: MY_PROJECT,
        resolutions: { axios: ">=1.13.5", "other-pkg": "^1.0.0" },
        overrides: { axios: ">=1.13.5", "other-pkg": "^1.0.0" },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      // Force replaces the template-governed entries
      expect(content.resolutions.axios).toBe(">=1.15.0");
      expect(content.overrides.axios).toBe(">=1.15.0");
      // Sibling entries inside the same nested object are preserved
      expect(content.resolutions["other-pkg"]).toBe("^1.0.0");
      expect(content.overrides["other-pkg"]).toBe("^1.0.0");
    });
  });

  // Regression (#3068): the host-ahead branch refused a host range that IS a
  // subset of Lisa's whenever the operator spelled it as a compound range. The
  // cause is NOT that the comparison "falls through on multi-comparator ranges"
  // — `semver.subset(">=5.0.9 <6.0.0", "^5.0.1")` is itself `false`, and
  // correctly so: `^5.0.1` desugars to `>=5.0.1 <6.0.0-0`, so the hand-written
  // `<6.0.0` ceiling is strictly taller and admits `6.0.0-0`. No install can
  // ever select those points, so the two spellings admit the same real versions
  // and must reach the same verdict. Putting both ceilings into npm's sentinel
  // convention is what makes them comparable.
  describe("compound host ranges are compared as intervals", () => {
    const PKG = "@isaacs/brace-expansion";

    /**
     * Apply a template pin against a host pin and report what happened.
     * @param templateRange - The range Lisa's `force` section carries.
     * @param hostRange - The range the host package.json already carries.
     * @returns The written host range plus any refusal error.
     */
    const applyPinPair = async (
      templateRange: string,
      hostRange: string
    ): Promise<{ written: unknown; error: Error | null; note?: string }> => {
      await createPackageLisaTemplate("typescript", {
        force: { overrides: { [PKG]: templateRange } },
      });
      const sourcePath = path.join(
        lisaDir,
        "typescript",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: HOST_PROJECT,
        overrides: { [PKG]: hostRange },
      });
      const outcome = await strategy
        .apply(sourcePath, destPath, PACKAGE_JSON, createContext())
        .then(
          result => ({ error: null, note: result.note }),
          (caught: unknown) => ({ error: caught as Error, note: undefined })
        );
      const content = await fs.readJson(destPath);
      return {
        written: content.overrides?.[PKG],
        error: outcome.error,
        ...(outcome.note === undefined ? {} : { note: outcome.note }),
      };
    };

    // THE BITE. This is the case the ticket reproduces: an operator followed the
    // refusal's own remedy — "pick one range that satisfies both constraints" —
    // wrote the strictest such range, and was refused again.
    it("keeps a compound host range that sits strictly inside Lisa's", async () => {
      const outcome = await applyPinPair("^5.0.1", HOST_COMPOUND_RANGE);

      expect(outcome.error).toBeNull();
      expect(outcome.written).toBe(HOST_COMPOUND_RANGE);
      // The floor the host had hardened to is still the floor afterwards.
      expect(satisfies("5.0.5", outcome.written as string)).toBe(false);
      expect(satisfies("5.0.9", outcome.written as string)).toBe(true);
    });

    // NEGATIVE CONTROL. Already correct before the fix — its job is to prove the
    // probe is sound, so the compound row above reads as a measurement.
    it("keeps a caret host range that sits strictly inside Lisa's", async () => {
      const outcome = await applyPinPair("^5.0.1", "^5.0.9");

      expect(outcome.error).toBeNull();
      expect(outcome.written).toBe("^5.0.9");
    });

    // NEGATIVE CONTROL. `>=5.0.9` is unbounded above and admits `6.x`, which
    // `^5.0.1` forbids. Neither contains the other, so the refusal is the whole
    // point of the guard and must survive untouched.
    it("still refuses an unbounded host range and names both sides", async () => {
      const outcome = await applyPinPair("^5.0.1", ">=5.0.9");

      expect(outcome.error).not.toBeNull();
      expect(outcome.error?.message).toContain(`overrides.${PKG}`);
      expect(outcome.error?.message).toContain(">=5.0.9");
      expect(outcome.error?.message).toContain("^5.0.1");
      // Refusing means refusing: the host manifest is left as it was.
      expect(outcome.written).toBe(">=5.0.9");
    });

    // The nearest neighbour to the fix, and the reason it is a `<` rewrite and
    // not a `<=` one. `>=5.0.9 <=6.0.0` differs from the kept case by a single
    // character and genuinely admits `6.0.0`, which `^5.0.1` forbids — a fix
    // that widened "comparable" carelessly would swallow this one too.
    it("still refuses an inclusive ceiling that admits the next major", async () => {
      const outcome = await applyPinPair(
        "^5.0.1",
        HOST_INCLUSIVE_CEILING_RANGE
      );

      expect(satisfies("6.0.0", HOST_INCLUSIVE_CEILING_RANGE)).toBe(true);
      expect(satisfies("6.0.0", "^5.0.1")).toBe(false);
      expect(outcome.error).not.toBeNull();
      expect(outcome.error?.message).toContain("<=6.0.0");
      expect(outcome.written).toBe(HOST_INCLUSIVE_CEILING_RANGE);
    });

    // A spec semver cannot parse at all is not a range question. It never
    // reaches the subset test, so Lisa leaves Phase 1's value standing rather
    // than refusing — unchanged by this fix, and asserted so it stays that way.
    it("leaves an unparseable host spec to Phase 1 without refusing", async () => {
      const outcome = await applyPinPair(
        "^5.0.1",
        "npm:@isaacs/brace-expansion@^5.0.9"
      );

      expect(outcome.error).toBeNull();
      expect(outcome.written).toBe("^5.0.1");
    });

    // Upstream behaviour pin. The fix compensates for a `semver` convention, so
    // it must fail loudly if that convention ever moves — in EITHER direction. A
    // workaround for behaviour that changed underneath it is a bug of its own.
    it("pins the semver ceiling convention the normalization compensates for", () => {
      // `^` desugars with the `-0` sentinel; a hand-written `<` does not.
      expect(validRange("^5.0.1")).toBe(">=5.0.1 <6.0.0-0");
      expect(validRange(HOST_COMPOUND_RANGE)).toBe(HOST_COMPOUND_RANGE);

      // Consequence: subset says false, and is arithmetically right to.
      expect(subset(HOST_COMPOUND_RANGE, "^5.0.1")).toBe(false);
      // Same interval in caret form: true. The disagreement is the defect.
      expect(subset("^5.0.9", "^5.0.1")).toBe(true);
      // `includePrerelease` does NOT reconcile them — it widens both sides.
      expect(
        subset(HOST_COMPOUND_RANGE, "^5.0.1", { includePrerelease: true })
      ).toBe(false);
      // Once the ceilings agree, so does subset. This is what the fix does.
      expect(subset(">=5.0.9 <6.0.0-0", "^5.0.1")).toBe(true);

      // And why the widening is sound: the points that separate the two
      // intervals satisfy NEITHER range, so no install can select them.
      expect(satisfies("6.0.0-alpha.1", HOST_COMPOUND_RANGE)).toBe(false);
      expect(satisfies("6.0.0-alpha.1", "^5.0.1")).toBe(false);
      expect(satisfies("6.0.0-0", HOST_COMPOUND_RANGE)).toBe(false);
    });
  });
});

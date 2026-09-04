/**
 * @file package-lisa-version-pin.test.ts
 * @description The version an apply WRITES and the version a host has INSTALLED
 * must be the same version (#2953).
 *
 * `lisa apply` updates the vendored templates but left `@codyswann/lisa` in the
 * host's `package.json` untouched. The templates and the package were then
 * different versions, and a template that calls a newly-added export broke
 * every consumer of it: a config file written by the applying version called an
 * export the pinned version did not have, and every ESLint invocation died at
 * config load — lint, lint-staged, the pre-commit hook, CI Lint. The apply
 * reported success.
 *
 * It is not caught locally either: `postinstall` runs `tsc || true`, so
 * `|| true` swallows the failure. (It also used to skip the build entirely
 * whenever a `dist/` already existed; that presence guard was removed in
 * #3778, which removes one of the two mechanisms but not this one.)
 * The mismatch surfaces at the
 * NEXT ESLint run, detached from the apply that caused it, and reads as a
 * broken ESLint config rather than as a version skew.
 *
 * The rule made executable here: whenever `apply` writes a template that
 * references the package's own API, the applied version and the installed
 * version must agree — and where the pin cannot be written, the apply says so.
 * @module tests/unit/strategies/package-lisa-version-pin
 */
import { describe, expect, it } from "vitest";

import { PackageLisaStrategy } from "../../../src/strategies/package-lisa.js";
import { createPackageLisaApplyHarness } from "../../helpers/package-lisa-apply-harness.js";

/** The package whose pin must track the applying version. */
const LISA = "@codyswann/lisa";

/** A version the fixtures apply AS. Deliberately unlike any real release. */
const APPLYING = "9.9.9";

/** A version the fixtures start PINNED at, older than the applying one. */
const PINNED = "3.47.5";

/** A spec naming a local checkout rather than a release. */
const LOCAL_PATH_SPEC = "file:../lisa";

const DEV_DEPENDENCIES = "devDependencies";
const DEPENDENCIES = "dependencies";
const TYPESCRIPT = "typescript";

/** A template that governs nothing but is loadable, so the pin phase runs. */
const INERT_TEMPLATE = { force: { scripts: { build: "tsc" } } };

/**
 * A strategy that reports a fixed applying version.
 * @param version - Version the strategy should report as the applying one
 * @returns Strategy that applies as {@link APPLYING} unless told otherwise
 */
function applyingAt(version: string = APPLYING): PackageLisaStrategy {
  return new PackageLisaStrategy(() => version);
}

describe("apply pins the version it is applying (#2953)", () => {
  const host = createPackageLisaApplyHarness();

  /**
   * Read one dependency section back off disk.
   * @param section - Section name
   * @returns The section, or an empty object
   */
  async function deps(section: string): Promise<Record<string, string>> {
    const pkg = await host.hostPackage();
    return (pkg[section] ?? {}) as Record<string, string>;
  }

  describe("the applied version and the pinned version agree", () => {
    it("rewrites a devDependency pin that is behind the applying version", async () => {
      await host.writeTemplate(TYPESCRIPT, INERT_TEMPLATE);
      await host.writeHostManifest({
        [DEV_DEPENDENCIES]: { [LISA]: PINNED },
      });

      await host.runApply({}, applyingAt());

      expect((await deps(DEV_DEPENDENCIES))[LISA]).toBe(APPLYING);
    });

    it("rewrites the pin where the host declared it rather than moving it", async () => {
      // A host that depends on Lisa at runtime keeps it in `dependencies`.
      // Writing the pin into `devDependencies` instead would leave the stale
      // spec in place AND add a second, conflicting one.
      await host.writeTemplate(TYPESCRIPT, INERT_TEMPLATE);
      await host.writeHostManifest({ [DEPENDENCIES]: { [LISA]: PINNED } });

      await host.runApply({}, applyingAt());

      expect((await deps(DEPENDENCIES))[LISA]).toBe(APPLYING);
      expect((await deps(DEV_DEPENDENCIES))[LISA]).toBeUndefined();
    });

    it("rewrites a range that would admit an older package than the templates need", async () => {
      // A caret range is the dangerous case, not the safe one: it ADMITS the
      // applying version without requiring it, so a host whose lockfile still
      // resolves an older build installs templates that call exports the
      // installed package does not have.
      await host.writeTemplate(TYPESCRIPT, INERT_TEMPLATE);
      await host.writeHostManifest({
        [DEV_DEPENDENCIES]: { [LISA]: `^${PINNED}` },
      });

      await host.runApply({}, applyingAt());

      expect((await deps(DEV_DEPENDENCIES))[LISA]).toBe(APPLYING);
    });

    it("installs the pin at the applying version on a host that has none", async () => {
      await host.writeTemplate(TYPESCRIPT, INERT_TEMPLATE);
      await host.writeHostManifest({
        [DEV_DEPENDENCIES]: { eslint: "^9.0.0" },
      });

      await host.runApply({}, applyingAt());

      expect((await deps(DEV_DEPENDENCIES))[LISA]).toBe(APPLYING);
    });

    it("leaves a pin that already matches exactly alone and silently", async () => {
      await host.writeTemplate(TYPESCRIPT, INERT_TEMPLATE);
      await host.writeHostManifest({
        [DEV_DEPENDENCIES]: { [LISA]: APPLYING },
      });

      const result = await host.runApply({}, applyingAt());

      expect((await deps(DEV_DEPENDENCIES))[LISA]).toBe(APPLYING);
      expect(result.note ?? "").not.toContain(LISA);
    });
  });

  describe("a mismatch is never silent", () => {
    it("names both versions when it moves the pin", async () => {
      await host.writeTemplate(TYPESCRIPT, INERT_TEMPLATE);
      await host.writeHostManifest({
        [DEV_DEPENDENCIES]: { [LISA]: PINNED },
      });

      const result = await host.runApply({}, applyingAt());

      expect(result.note).toContain(PINNED);
      expect(result.note).toContain(APPLYING);
    });

    it("names both versions when it will not touch a local-path spec", async () => {
      // `file:` / `link:` / `workspace:` mean somebody is developing Lisa
      // against this checkout. Overwriting that with a registry version breaks
      // their setup, so the apply reports the skew instead of resolving it.
      await host.writeTemplate(TYPESCRIPT, INERT_TEMPLATE);
      await host.writeHostManifest({
        [DEV_DEPENDENCIES]: { [LISA]: LOCAL_PATH_SPEC },
      });

      const result = await host.runApply({}, applyingAt());

      expect((await deps(DEV_DEPENDENCIES))[LISA]).toBe(LOCAL_PATH_SPEC);
      expect(result.note).toContain(LOCAL_PATH_SPEC);
      expect(result.note).toContain(APPLYING);
    });

    it("names both versions for a workspace protocol spec", async () => {
      await host.writeTemplate(TYPESCRIPT, INERT_TEMPLATE);
      await host.writeHostManifest({
        [DEV_DEPENDENCIES]: { [LISA]: "workspace:*" },
      });

      const result = await host.runApply({}, applyingAt());

      expect((await deps(DEV_DEPENDENCIES))[LISA]).toBe("workspace:*");
      expect(result.note).toContain(APPLYING);
    });
  });

  describe("the postinstall path does not rewrite the host's manifest", () => {
    it("leaves a stale pin alone during a security-pins-only apply", async () => {
      // `skip-git-check` on an existing manifest is the postinstall path, where
      // the installed package IS the applying version, so there is nothing to
      // reconcile — and rewriting somebody's package.json from inside their
      // `install` is not this phase's to do.
      await host.writeTemplate(TYPESCRIPT, INERT_TEMPLATE);
      await host.writeHostManifest({
        [DEV_DEPENDENCIES]: { [LISA]: PINNED },
      });

      const result = await host.runApply(
        { skipGitCheck: true, postinstall: true },
        applyingAt()
      );

      expect((await deps(DEV_DEPENDENCIES))[LISA]).toBe(PINNED);
      expect(result.note ?? "").not.toContain(APPLYING);
    });
  });

  describe("Lisa never pins itself", () => {
    it("adds no self-dependency when the host manifest is Lisa's own", async () => {
      await host.writeTemplate(TYPESCRIPT, INERT_TEMPLATE);
      await host.writeHostManifest({
        name: LISA,
        [DEV_DEPENDENCIES]: { eslint: "^9.0.0" },
      });

      await host.runApply({}, applyingAt());

      expect((await deps(DEV_DEPENDENCIES))[LISA]).toBeUndefined();
      expect((await deps(DEPENDENCIES))[LISA]).toBeUndefined();
    });
  });
});

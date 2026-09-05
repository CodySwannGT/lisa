/**
 * @file package-lisa-test-script-governance.test.ts
 * @description Every host-facing test script must be a governed PAIR, not a
 * forced value.
 *
 * The defect: #3070 converted `test:integration` to the reserved-base pattern
 * #2952 established — Lisa forces `test:integration:lisa`, and merely defaults
 * `test:integration` to invoke it, so the host owns the composition point. Its
 * five siblings were left in `force`, where Lisa's value REPLACES the host's on
 * every apply. `test:integration` was governed correctly and `test:cov` was not,
 * in the same file, for the same reason, with nothing asserting the difference
 * was deliberate.
 *
 * Measured downstream on a consumer upgrade: an apply
 * silently rewrote all six of that repository's test scripts. Two distinct
 * things were destroyed, and neither failure was loud:
 *
 *   - `LISA_TEST_SCRATCH_PREFIXES`, the operator's registry of fixture prefixes
 *     its suites legitimately create. Losing it failed 19 healthy suites
 *     through Lisa's OWN scratch-leak guard, which reported them as leaking.
 *   - A coverage-margin reporter chained onto `test:cov`. That one is worse: it
 *     does not fail, it just stops reporting. The same class of silent removal
 *     had already left that consumer's `typecheck` gate dead for fifty days
 *     with nothing red.
 *
 * The host had nowhere else to put either one. `test:cov` is what the gate
 * invokes by name, so it is the only composition point there is — exactly the
 * situation #2952 was written for.
 *
 * These cases drive the templates this repository SHIPS. A governance
 * classification defect lives in the shipped file, and a spec that states its
 * own template cannot see it.
 * @module tests/unit/strategies/package-lisa-test-script-governance
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/** Every shipped stack template that governs test scripts. */
const TEMPLATES = [
  "typescript",
  "npm-package",
  "nestjs",
  "cdk",
  "harper-fabric",
  "phaser",
  "expo",
] as const;

/**
 * The host-facing test scripts a project composes on.
 * @remarks
 * `test:integration` is included deliberately. It is the one key that was
 * already correct, so it is the control: if the pattern itself ever regresses,
 * this list fails as a whole rather than only for the keys #3070 missed.
 */
const HOST_FACING = [
  "test",
  "test:unit",
  "test:cov",
  "test:cov:unit",
  "test:watch",
  "test:integration",
] as const;

/**
 * The keys this change converted, which is the scope of the adopt assertion.
 * @remarks
 * `test:integration` is excluded there, and only there, because four templates
 * — `npm-package`, `harper-fabric`, `phaser`, `expo` — force a stack-specific
 * value for it that appears in no adopt list, their own or the parent's. That
 * gap is real and PRE-EXISTING: a host on one of those stacks still holding
 * Lisa's own value is read as having customised it. It is left alone here
 * because closing it interacts with the `inheritsDefault` design that
 * `tests/unit/config/governed-script-composition-points.test.ts` encodes —
 * those templates deliberately declare no default of their own, and an adopt
 * entry without a default to adopt into is itself a violation. Fixing it is a
 * separate change to a key this one does not touch.
 */
const CONVERTED = [
  "test",
  "test:unit",
  "test:cov",
  "test:cov:unit",
  "test:watch",
] as const;

/**
 * The template every stack inherits from.
 * @remarks
 * A stack may DECLARE a host-facing default or inherit this one — both are
 * correct, and `tests/unit/config/governed-script-composition-points.test.ts`
 * encodes that as `inheritsDefault`. Reading a template file alone cannot tell
 * a stack that inherits from one that ships nothing, so every assertion below
 * falls back to this template rather than demanding a local declaration.
 */
const PARENT = "typescript";

/** A parsed `package.lisa.json`, to the depth these assertions read. */
interface Template {
  readonly force?: { readonly scripts?: Record<string, string> };
  readonly defaults?: { readonly scripts?: Record<string, string> };
  readonly merge?: { readonly scripts?: Record<string, string> };
  readonly adopt?: { readonly scripts?: Record<string, readonly string[]> };
}

/**
 * Read a shipped template off disk.
 * @param stack - Stack template directory name
 * @returns The parsed template
 */
const shippedTemplate = (stack: string): Template =>
  fs.readJsonSync(
    path.join(REPO_ROOT, stack, "package-lisa", "package.lisa.json")
  ) as Template;

/**
 * Name the template sections that carry a given script key.
 * @param template - A parsed `package.lisa.json`
 * @param scriptName - The script key to locate
 * @returns Section names, in a stable order
 */
const sectionsCarrying = (
  template: Template,
  scriptName: string
): readonly string[] =>
  (["force", "defaults", "merge"] as const).filter(
    section => template[section]?.scripts?.[scriptName] !== undefined
  );

describe("host-facing test scripts are governed pairs, not forced values", () => {
  it.each(TEMPLATES)(
    "%s: forces the reserved base and only defaults the host-facing name",
    stack => {
      const template = shippedTemplate(stack);
      const present = HOST_FACING.filter(
        key =>
          sectionsCarrying(template, key).length > 0 ||
          template.force?.scripts?.[`${key}:lisa`] !== undefined
      );

      // Truthiness first: a template that shipped none of these keys would
      // satisfy every per-key assertion below by vacuity.
      expect(present.length).toBeGreaterThan(0);

      const parent = shippedTemplate(PARENT);
      const misgoverned = present
        .map(key => ({
          key,
          // An inherited default declares nothing locally, which is correct.
          host:
            sectionsCarrying(template, key).length > 0
              ? sectionsCarrying(template, key)
              : sectionsCarrying(parent, key),
          base: sectionsCarrying(template, `${key}:lisa`),
        }))
        .filter(
          entry =>
            entry.host.join() !== "defaults" || entry.base.join() !== "force"
        )
        .map(
          entry =>
            `${entry.key}: host=[${entry.host.join(",")}] base=[${entry.base.join(",")}]`
        );

      expect(misgoverned).toEqual([]);
    }
  );

  it.each(TEMPLATES)(
    "%s: points each host-facing default at its own reserved base",
    stack => {
      const template = shippedTemplate(stack);
      const wrong = HOST_FACING.filter(
        key => template.defaults?.scripts?.[key] !== undefined
      )
        .map(key => [key, template.defaults?.scripts?.[key] ?? ""] as const)
        .filter(([key, value]) => value !== `$npm_execpath run ${key}:lisa`)
        .map(([key, value]) => `${key}=${value}`);

      expect(wrong).toEqual([]);
    }
  );

  it.each(TEMPLATES)(
    "%s: adopts the value it used to force, so an untouched host migrates",
    stack => {
      const template = shippedTemplate(stack);
      const parent = shippedTemplate(PARENT);
      const unadopted = CONVERTED.filter(
        key => template.force?.scripts?.[`${key}:lisa`] !== undefined
      ).filter(key => {
        const forced = template.force?.scripts?.[`${key}:lisa`] ?? "";
        // adopt is merged as a UNION across the inheritance chain, so a value
        // the parent already recognises need not be repeated in the child.
        const recognised = [
          ...(template.adopt?.scripts?.[key] ?? []),
          ...(parent.adopt?.scripts?.[key] ?? []),
        ];
        return !recognised.includes(forced);
      });

      // Without this, a host whose script still holds Lisa's own old value is
      // reported as having customised something it never touched, and stops
      // tracking the template.
      expect(unadopted).toEqual([]);
    }
  );

  it("never leaves a host-facing test script in force in any template", () => {
    const offenders = TEMPLATES.flatMap(stack =>
      HOST_FACING.filter(
        key => shippedTemplate(stack).force?.scripts?.[key] !== undefined
      ).map(key => `${stack}:${key}`)
    );

    expect(offenders).toEqual([]);
  });
});

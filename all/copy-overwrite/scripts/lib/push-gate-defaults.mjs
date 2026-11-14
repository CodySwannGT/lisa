// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * The `pushGate` defaults a project gets without writing them
 * (CodySwannGT/lisa#4611).
 *
 * Lisa proved the smart push gate on itself behind explicit `pushGate`
 * switches, all off by default. TypeScript hosts get it switched on through
 * this file. The default depends on the project's stack and is worked out when
 * the push runs, so `lisa apply` writes nothing into a host's
 * `.lisa.config.json` and an existing host needs no migration. Anything the
 * host sets explicitly wins, `false` included.
 *
 * TypeScript defaults:
 *
 * - `cache: true`: an unchanged tree re-pushes from remembered passes.
 * - `admission: true`: heavy runs wait for machine headroom.
 * - `affectedTests: true`: the unit run narrows to the tests a change can
 *   reach, and runs everything whenever that could be wrong.
 * - `affectedCoverage: "changed-files"`: a narrowed run with coverage on
 *   holds every changed source file to the coverage floors on its own. That
 *   keeps coverage enforced at push. It falls back to the full measured suite
 *   when it cannot hold the files, for example when there is no
 *   `vitest.thresholds.json` or no test reaches a changed file.
 * - `buildOnce` is NOT defaulted on. In Lisa a push built two or three times,
 *   and build-once removes the repeats. A host's push gates do not build at
 *   all, so a build-once step would add a full build to every push, a fully
 *   cached re-push included. A host whose push steps do build can still set
 *   `buildOnce: true`.
 *
 * Rails defaults (CodySwannGT/lisa#4612, #4613) are the same four switches:
 * the pass cache and admission for `scripts/lisa-rails-gates.mjs`, and
 * affected-spec selection with `changed-files` coverage for
 * `scripts/lisa-rspec-select.mjs`. A Rails project is one with `bin/rails` or
 * `config/application.rb`, as `src/detection/detectors/rails.ts` judges it.
 * Rails is checked first, so a Rails app that also carries a `tsconfig.json`
 * gets the Rails table; the two tables agree today.
 *
 * Other stacks get no defaults here. This file is the one place every stack's
 * `pushGate` defaults live; the TypeScript and Rails runners, `lisa check` and
 * `lisa-test-run`'s admission all read them through it.
 *
 * This file is plain `.mjs` and runs before any build, so it cannot import
 * `src/detection/`. It mirrors `src/detection/detectors/typescript.ts`: a
 * TypeScript project has a root `tsconfig.json`, or `typescript` in
 * `package.json` dependencies or devDependencies. `src/core/push-gate-defaults.ts`
 * holds the same table for the CLI, and a unit test keeps the two in step.
 * @module push-gate-defaults
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** What a TypeScript project gets when it does not say. */
export const TYPESCRIPT_PUSH_GATE_DEFAULTS = Object.freeze({
  cache: true,
  admission: true,
  affectedTests: true,
  affectedCoverage: "changed-files",
});

/** What a Rails project gets when it does not say. */
export const RAILS_PUSH_GATE_DEFAULTS = Object.freeze({
  cache: true,
  admission: true,
  affectedTests: true,
  affectedCoverage: "changed-files",
});

/**
 * Whether `root` is a Rails project: `bin/rails`, else `config/application.rb`.
 * @param {string} root Project root.
 * @returns {boolean} True for a Rails project.
 */
export function isRailsProject(root) {
  return (
    existsSync(join(root, "bin", "rails")) ||
    existsSync(join(root, "config", "application.rb"))
  );
}

/**
 * Whether `root` is a TypeScript project, judged as `src/detection` judges it.
 * @param {string} root Project root.
 * @returns {boolean} True for a TypeScript project.
 */
export function isTypeScriptProject(root) {
  if (existsSync(join(root, "tsconfig.json"))) return true;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  } catch {
    return false;
  }
  return (
    manifest?.dependencies?.typescript !== undefined ||
    manifest?.devDependencies?.typescript !== undefined
  );
}

/**
 * The defaults for the project at `root`.
 * @param {string} root Project root.
 * @returns {Readonly<Record<string, unknown>>} Defaults (empty when none apply).
 */
export function pushGateDefaultsFor(root) {
  if (isRailsProject(root)) return RAILS_PUSH_GATE_DEFAULTS;
  return isTypeScriptProject(root) ? TYPESCRIPT_PUSH_GATE_DEFAULTS : {};
}

/**
 * A parsed `.lisa.config.json` with the stack's `pushGate` defaults filled in
 * under the project's own keys.
 *
 * A malformed `pushGate` (null, an array, a string) is returned untouched, so
 * the readers still refuse it with their own message rather than having a
 * default hide the typo. The input is never modified.
 * @param {Record<string, unknown>|null|undefined} config Parsed config.
 * @param {string} root Project root.
 * @returns {Record<string, unknown>} The config the push gate should read.
 */
export function withPushGateDefaults(config, root) {
  return withDefaults(config, pushGateDefaultsFor(root));
}

/**
 * A parsed `.lisa.config.json` with the given `pushGate` defaults filled in
 * under the project's own keys, by the same rules as
 * {@link withPushGateDefaults}. For a caller that already knows the stack.
 * @param {Record<string, unknown>|null|undefined} config Parsed config.
 * @param {Readonly<Record<string, unknown>>} defaults The stack's defaults.
 * @returns {Record<string, unknown>} The config with defaults applied.
 */
export function withDefaults(config, defaults) {
  const base = config && typeof config === "object" ? config : {};
  const declared = base.pushGate;
  const malformed =
    declared !== undefined &&
    (declared === null ||
      typeof declared !== "object" ||
      Array.isArray(declared));
  if (malformed) return base;
  if (Object.keys(defaults).length === 0) return base;
  return { ...base, pushGate: { ...defaults, ...(declared ?? {}) } };
}

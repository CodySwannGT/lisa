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
 * Other stacks get no defaults here. Rails is a separate leaf.
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
  const base = config && typeof config === "object" ? config : {};
  const declared = base.pushGate;
  const malformed =
    declared !== undefined &&
    (declared === null ||
      typeof declared !== "object" ||
      Array.isArray(declared));
  if (malformed) return base;
  const defaults = pushGateDefaultsFor(root);
  if (Object.keys(defaults).length === 0) return base;
  return { ...base, pushGate: { ...defaults, ...(declared ?? {}) } };
}

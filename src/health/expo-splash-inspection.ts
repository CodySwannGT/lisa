/**
 * Read-only inspection of the Android splash-exit opt-out for Expo projects.
 *
 * ## Why a health finding rather than only a template file
 *
 * Lisa's Expo template ships `eslint.config.ts`, `tsconfig*.json`, `jest*`,
 * `knip.json` and `scripts/` — and **never** `app.config.*` or `app.json`. The
 * Expo plugin list is host-owned, so Lisa can put
 * `withAndroidSplashNoClientExit.js` on disk but cannot register it.
 *
 * A config plugin that is present and unregistered does **nothing**. Shipping
 * one without saying so would put a file that looks like a fix into every
 * consumer while the defect stayed live — the same silent-no-op class the
 * plugin exists to remove, reproduced by the delivery mechanism, and strictly
 * worse than shipping nothing because it looks done.
 *
 * This check is what makes shipping the file honest: it reports the one thing
 * Lisa cannot do for the project.
 *
 * ## What is being detected
 *
 * `expo-splash-screen` unconditionally registers an `OnExitAnimationListener`,
 * which arms the platform's 2000ms splash-transfer deadline. A first frame
 * slower than that strands a `STARTING_REVEAL` animation on the activity's main
 * window for its lifetime, and every synced input event then waits out
 * WindowManager's 5000ms animation budget twice.
 *
 * The exposure therefore requires `expo-splash-screen` to be **enabled**. A
 * project that does not use it has no listener to clear and must not be
 * reported — a check that fired on every Expo project would be noise, and noise
 * is how a real finding gets ignored.
 * @module health/expo-splash-inspection
 */

import type { HealthFinding } from "./contract.js";
import { deterministicFinding } from "./finding-utils.js";
import { readProjectJsonObject, readProjectText } from "./read-only-fs.js";

/** The health check id. */
export const SPLASH_EXIT_CHECK = "expo.splash-exit";

/** The plugin file Lisa ships into the Expo template. */
export const SPLASH_PLUGIN_BASENAME = "withAndroidSplashNoClientExit";

/** The Expo package whose registration creates the exposure. */
const SPLASH_PACKAGE = "expo-splash-screen";

/**
 * App-config filenames Expo resolves, in its own precedence order.
 *
 * All are read rather than only the first found: a project may carry both a
 * static `app.json` and a dynamic `app.config.ts` that extends it, and the
 * registration can live in either.
 */
const APP_CONFIG_FILES = Object.freeze([
  "app.config.ts",
  "app.config.js",
  "app.config.mjs",
  "app.json",
]);

/** What the inspection concluded. */
export type SplashExitInspection =
  | { readonly status: "pass"; readonly reason: string }
  | { readonly status: "warn"; readonly reason: string };

/** How strongly the app config evidences an active registration. */
type Registration = "proven" | "mentioned" | "absent";

/**
 * Whether a `plugins` entry names the plugin.
 *
 * An entry is either a bare specifier or `[specifier, options]`, so the tuple
 * form has to be unwrapped or a plugin configured with options reads as absent.
 * @param entry One element of the plugins array.
 * @returns True when it references the plugin.
 */
function entryNamesPlugin(entry: unknown): boolean {
  const specifier = Array.isArray(entry) ? entry[0] : entry;
  return (
    typeof specifier === "string" && specifier.includes(SPLASH_PLUGIN_BASENAME)
  );
}

/**
 * Registration PROVEN from static `app.json`, which can be parsed exactly.
 * @param projectRoot Absolute project root.
 * @returns True when `expo.plugins` actually contains the plugin.
 */
async function provenInAppJson(projectRoot: string): Promise<boolean> {
  const config = await readProjectJsonObject(projectRoot, "app.json").catch(
    () => undefined
  );
  const expo = config?.["expo"];
  if (expo === null || typeof expo !== "object") return false;
  const plugins = (expo as Record<string, unknown>)["plugins"];
  return Array.isArray(plugins) && plugins.some(entryNamesPlugin);
}

/**
 * How well the app config evidences that the plugin is actually registered.
 *
 * ## Why a mention is not proof
 *
 * A dynamic `app.config.ts` cannot be evaluated from a read-only health check —
 * running project code to answer a question about project code is not something
 * this layer may do. So for that file all that is available is text, and text
 * lies in the dangerous direction: a commented-out line, an unused import, or a
 * registration inside a branch that never executes all contain the name while
 * the plugin is not registered at all.
 *
 * Treating a mention as proof would make this check report `pass` — "you are
 * protected" — to a project that is fully exposed. That is a worse outcome than
 * no check, and it is precisely the false-green failure this check exists to
 * prevent, so the asymmetry decides it: `pass` requires proof, and a mention
 * that cannot be proven stays a warning that says exactly what to confirm.
 * @param projectRoot Absolute project root.
 * @returns The strongest evidence available.
 */
async function registrationEvidence(
  projectRoot: string
): Promise<Registration> {
  if (await provenInAppJson(projectRoot)) return "proven";
  for (const file of APP_CONFIG_FILES) {
    const text = await readProjectText(projectRoot, file);
    if (typeof text === "string" && text.includes(SPLASH_PLUGIN_BASENAME))
      return "mentioned";
  }
  return "absent";
}

/**
 * The project manifest, or undefined when it cannot be read as one.
 *
 * `readProjectJsonObject` THROWS on malformed JSON and on a non-object root, so
 * an unparseable package.json would propagate out of a health check whose whole
 * contract is to stay quiet when it cannot see. Collapsed to undefined here
 * because "cannot read the manifest" and "the manifest says no" are the same
 * answer for this check: no evidence of exposure, so no finding.
 * @param projectRoot Absolute project root.
 * @returns The manifest, or undefined.
 */
async function readManifest(
  projectRoot: string
): Promise<Readonly<Record<string, unknown>> | undefined> {
  return readProjectJsonObject(projectRoot, "package.json").catch(
    () => undefined
  );
}

/**
 * Whether the project depends on `expo-splash-screen`.
 *
 * Dependency presence, not app-config mention: the package registers its
 * listener from its own autolinked module, so being installed is what creates
 * the exposure. A project that lists it in `plugins` but has not installed it
 * is not exposed, and one that installed it without listing it is.
 * @param projectRoot Absolute project root.
 * @returns True when the package is a declared dependency.
 */
async function dependsOnSplashScreen(projectRoot: string): Promise<boolean> {
  // `readProjectJsonObject` THROWS on malformed JSON and on a non-object root,
  // so an unparseable package.json would propagate out of a health check whose
  // whole contract is to stay quiet when it cannot see. Caught here rather than
  // at the call site: "cannot read the manifest" and "the manifest says no" are
  // the same answer for this check — no evidence of exposure, so no finding.
  const pkg = await readManifest(projectRoot);
  if (!pkg) return false;
  for (const field of ["dependencies", "devDependencies"] as const) {
    const deps = pkg[field];
    if (
      deps !== null &&
      typeof deps === "object" &&
      SPLASH_PACKAGE in (deps as Record<string, unknown>)
    )
      return true;
  }
  return false;
}

/**
 * Inspect an Expo project for the unregistered splash-exit opt-out.
 *
 * Fail-safe toward silence: anything unreadable yields `pass`. A health check
 * that guesses when it cannot see is worse than one that says nothing, because
 * a warning nobody can act on trains readers to skip the whole report.
 * @param projectRoot Absolute project root.
 * @returns The inspection outcome.
 */
export async function inspectSplashExitOptOut(
  projectRoot: string
): Promise<SplashExitInspection> {
  if (!(await dependsOnSplashScreen(projectRoot)))
    return {
      status: "pass",
      reason: `${SPLASH_PACKAGE} is not a dependency, so no exit listener is registered and there is nothing to clear`,
    };

  const evidence = await registrationEvidence(projectRoot);

  if (evidence === "proven")
    return {
      status: "pass",
      reason: `app.json lists ${SPLASH_PLUGIN_BASENAME} in expo.plugins, so the Android 12+ splash-exit handshake is opted out of`,
    };

  if (evidence === "mentioned")
    return {
      status: "warn",
      reason:
        `${SPLASH_PLUGIN_BASENAME} is named in a dynamic app config, but a read-only check cannot ` +
        "execute that config to confirm the plugin is actually in the effective `plugins` array — a " +
        "commented-out line, an unused import, or a branch that never runs all read the same as a real " +
        "registration. Confirm it is registered AFTER expo-splash-screen. This is reported rather than " +
        "passed because a wrong `pass` here tells an exposed project it is protected.",
    };

  return {
    status: "warn",
    reason:
      `${SPLASH_PACKAGE} is installed and the app config does not register ${SPLASH_PLUGIN_BASENAME}. ` +
      "Lisa ships that plugin but CANNOT register it — the Expo plugin list is owned by this project. " +
      "Until it is registered the plugin file is inert: expo-splash-screen's exit listener stays " +
      "armed, and a first frame slower than the platform's 2000ms splash-transfer deadline strands a " +
      "STARTING_REVEAL animation for the life of the activity, costing every synced input event two " +
      "5000ms animation waits. Add it to the plugins array AFTER expo-splash-screen.",
  };
}

/**
 * The health finding for the splash-exit opt-out.
 *
 * Gated on the Expo stack. `expo-splash-screen` cannot be a dependency of a
 * project that is not an Expo project, so this is belt-and-braces — but it is
 * the cheap kind: it means a future change to dependency detection cannot make
 * this check start speaking to Rails or CDK projects, where its advice would be
 * nonsense and its presence would teach readers to skim the report.
 * @param projectRoot Absolute project root.
 * @param types Detected project types for this repository.
 * @returns The finding.
 */
export async function splashExitFinding(
  projectRoot: string,
  types: readonly string[]
): Promise<HealthFinding> {
  if (!types.includes("expo"))
    return deterministicFinding(
      SPLASH_EXIT_CHECK,
      "pass",
      "not an Expo project, so there is no Android splash-exit handshake to opt out of"
    );
  const inspection = await inspectSplashExitOptOut(projectRoot);
  return deterministicFinding(
    SPLASH_EXIT_CHECK,
    inspection.status,
    inspection.reason
  );
}

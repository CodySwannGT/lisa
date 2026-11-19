/**
 * @file package-lisa-pin-alignment.ts
 * @description Phase 5 of the package-lisa apply: make the host's
 * `@codyswann/lisa` pin name the version performing the apply.
 * @module strategies
 */
import { asRecord } from "../core/override-floors.js";
import { LISA_PACKAGE_NAME } from "../core/self-apply.js";
import type { PackageJsonPlan } from "./package-lisa-types.js";

/**
 * Dependency sections a host may declare `@codyswann/lisa` in, most-specific
 * first: a runtime dependency is the unusual choice, so finding one there means
 * the host meant it.
 */
const LISA_PIN_SECTIONS = ["dependencies", "devDependencies"] as const;

/** Where a pin goes on a host that does not have one yet. */
const DEFAULT_LISA_PIN_SECTION = "devDependencies";

/**
 * Specs that name a LOCATION rather than a registry version.
 * @remarks
 * `file:` / `link:` / `portal:` / `workspace:` and the git forms all mean
 * somebody is developing against a checkout instead of a release. Replacing one
 * with a version number breaks that setup, so the apply reports the skew rather
 * than resolving it — which is the branch the second acceptance scenario is
 * about.
 */
const NON_REGISTRY_SPEC =
  /^(?:file|link|portal|workspace|git|git\+[a-z]+|github|https?|npm):/i;

/**
 * Does this spec point at a location rather than name a registry version?
 * @param spec - The version spec the host declared
 * @returns True when the spec resolves outside the registry
 */
function isNonRegistrySpec(spec: string): boolean {
  return NON_REGISTRY_SPEC.test(spec);
}

/**
 * Where the host declares its Lisa pin, and what it currently says.
 * @param packageJson - The manifest as the merge phases left it
 * @returns The section to write into and the spec already there, if any
 */
function locateLisaPin(packageJson: Record<string, unknown>): {
  readonly section: string;
  readonly current: string | undefined;
} {
  const declared = LISA_PIN_SECTIONS.map(section => ({
    section,
    current: asRecord(packageJson[section])[LISA_PACKAGE_NAME],
  })).find(found => typeof found.current === "string");
  return declared === undefined
    ? { section: DEFAULT_LISA_PIN_SECTION, current: undefined }
    : { section: declared.section, current: declared.current as string };
}

/**
 * Make the host's `@codyswann/lisa` pin name the version doing the applying.
 * @remarks
 * An apply writes templates that call into the package's own API, so the
 * applied version and the INSTALLED version are two halves of one thing. When
 * they drift, a config file calls an export the installed package does not have
 * and every run of the tool that loads it dies at config load — while the apply
 * itself reports success, and `postinstall`'s `tsc || true` swallows the only
 * local signal. The failure then surfaces at the next
 * lint run, detached from the apply that caused it (#2953).
 *
 * A range is rewritten as readily as an exact pin, and deliberately so: a caret
 * range ADMITS the applying version without requiring it, so a lockfile still
 * resolving an older build produces exactly the skew this closes.
 *
 * Lisa applying to its own repository never reaches here: that path is
 * restricted to security pins, and a package cannot depend on itself.
 *
 * The consequence, recorded because it was twice discovered rather than read
 * (#3768): Lisa's own manifest DOES carry a `@codyswann/lisa` devDependency —
 * the fixture its templates resolve against — and this phase is the only thing
 * that would keep such a pin current. Skipping it here means **the single
 * repository whose pin no automation will ever correct is the one that ships
 * the automation.** That pin rotted two majors twice, in #2279 and again in
 * #3662, each time found only because somebody read a version string. The
 * reader that replaces them is `scripts/check-self-dependency-pin.mjs`, run as
 * a required CI step; this exemption stays as written, and is now watched.
 * @param packageJson - The manifest as the merge phases left it
 * @param applyingVersion - Version of the Lisa performing this apply
 * @returns The manifest with the pin aligned, plus operator-visible notes
 */
export function alignLisaPin(
  packageJson: Record<string, unknown>,
  applyingVersion: string
): PackageJsonPlan {
  const { section, current } = locateLisaPin(packageJson);
  if (current === applyingVersion) return { packageJson, notes: [] };

  if (current !== undefined && isNonRegistrySpec(current)) {
    return {
      packageJson,
      notes: [
        `Left ${LISA_PACKAGE_NAME} at "${current}", which points at a local copy rather than a release, but this apply is ${applyingVersion}. If that copy is older, the files just written may call something it does not have and every lint run will fail before it checks anything.`,
      ],
    };
  }

  const note =
    current === undefined
      ? `Added ${LISA_PACKAGE_NAME} ${applyingVersion} to ${section}. The files this apply just wrote come from ${applyingVersion} and call into it, so install it before your next lint run.`
      : `Pinned ${LISA_PACKAGE_NAME} to ${applyingVersion}; it was ${current}. The files this apply just wrote come from ${applyingVersion} and call into it, so the two have to be the same version — install it before your next lint run.`;

  return {
    packageJson: {
      ...packageJson,
      [section]: {
        ...asRecord(packageJson[section]),
        [LISA_PACKAGE_NAME]: applyingVersion,
      },
    },
    notes: [note],
  };
}

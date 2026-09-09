/**
 * Is a repository carrying the CDK application preset one that was ever
 * eligible for it?
 *
 * `cdk.json` is now the only thing that admits the preset, and every surface
 * that decides CDK-ness reads {@link CDK_APP_MARKER} rather than its own copy
 * of the filename. That fix reaches the DECISION, not the repositories the old
 * decision already wrote to: the preset's artifacts are `copy-overwrite`, its
 * dependencies are force-merged into `package.json`, and nothing in the
 * toolchain ever asked afterwards whether the repository it wrote them into
 * was a CDK app (CodySwannGT/lisa#3533, CodySwannGT/lisa#3711).
 *
 * The classification lives here, apart from its callers, for the reason the
 * Rails deploy-intent module gives: the seed-time decision and the
 * installed-base check have to ask the identical question, and two spellings
 * would drift silently in the direction that matters — an installed-base check
 * quietly accepting a repository the seed guard would now reject.
 *
 * The naive discriminator is "preset artifacts present, `cdk.json` absent",
 * and on its own it misses part of the affected population. `cdk.json` is
 * itself one of the files the preset delivers, under `create-only`: a
 * repository admitted by the old predicate and then applied received a
 * `cdk.json` it never wrote, which makes it read as a genuine CDK app to any
 * check that stops at the marker. So the marker is asked a second question —
 * does the application entrypoint it names exist? A real CDK app cannot synth
 * without one; a repository holding a seeded marker has never had one.
 *
 * Three states, kept apart because they are three different facts:
 * {@link CdkPresetAdoption} distinguishes a repository that is entitled to the
 * preset, one that is not, and one this module cannot place. Collapsing the
 * third into either of the others is how a population stays unknown.
 * @module core/cdk-preset-adoption
 */

/**
 * The single marker that makes a repository a CDK application.
 *
 * Exported so the detector, the package-lisa type scan, the health template
 * inspection, the setup stack classification, and the installed-base doctor
 * check all read one constant. Depending on a CDK package answers a different
 * question — `aws-cdk-lib` and `constructs` say the repository USES CDK types,
 * which any construct library does, while this file says it IS an app.
 */
export const CDK_APP_MARKER = "cdk.json";

/**
 * `copy-overwrite` artifacts that ONLY the CDK preset delivers.
 *
 * Their presence is what says the preset was applied here. The rest of
 * `cdk/copy-overwrite` — `eslint.config.ts`, `knip.json`, `tsconfig.json`,
 * `vitest.config.ts` and friends — is shipped by other stacks too, so it
 * says nothing about which preset a repository received. `.github/workflows/
 * .keep` is technically CDK-exclusive and deliberately excluded: it is a
 * directory placeholder that any repository may create for its own reasons.
 *
 * A regression test derives this set from the shipped stack trees, so an
 * artifact added to the preset later cannot leave this list behind.
 */
export const CDK_PRESET_ARTIFACTS = [
  "eslint.cdk.ts",
  "tsconfig.cdk.json",
  "vitest.cdk.ts",
] as const;

/**
 * Runtime dependencies `cdk/package-lisa/package.lisa.json` force-merges.
 *
 * `force` means the values are not a suggestion: a repository that removes
 * them by hand gets them back on the next apply for as long as it is still
 * classified as a CDK app. Naming them is half the remedy, which is why the
 * check states them rather than saying "some dependencies".
 */
export const CDK_PRESET_FORCED_DEPENDENCIES = [
  "aws-cdk-github-oidc",
  "constructs",
  "source-map-support",
] as const;

/** The `bin` entry the CDK preset force-merges, and the file it names. */
export const CDK_PRESET_BIN_ENTRY = {
  name: "infrastructure",
  target: "bin/infrastructure.js",
} as const;

/**
 * What the CDK application entrypoint declared by a `cdk.json` turns out to
 * be.
 *
 * `unrecognised` is not a defect and not a pass. A `cdk.json` may drive a
 * non-JavaScript app, or name its entry somewhere this module cannot pick a
 * single token out of, and guessing either way would be worse than saying so.
 */
export type CdkAppEntry =
  /** A single source file the `app` command names. */
  | {
      readonly kind: "resolved";
      readonly source: string;
      readonly present: boolean;
    }
  /** No single source file could be read out of the `app` command. */
  | { readonly kind: "unrecognised" };

/** Filesystem evidence a caller gathers before classification. */
export interface CdkAdoptionEvidence {
  /** Which of {@link CDK_PRESET_ARTIFACTS} are present in the repository. */
  readonly presetArtifacts: readonly string[];
  /** Whether {@link CDK_APP_MARKER} is present — the seed-time predicate. */
  readonly hasAppMarker: boolean;
  /** What the marker declares, or null when there is no marker to read. */
  readonly appEntry: CdkAppEntry | null;
}

/**
 * How a repository stands to the CDK application preset.
 *
 * `absent` and `eligible` are both "nothing to report" to an operator, and are
 * still kept apart: one repository never received the preset and the other
 * received it correctly, and a check that cannot tell them apart cannot say
 * which of its own answers it is giving.
 */
export type CdkPresetAdoption =
  /** No CDK preset artifacts here. */
  | "absent"
  /** Carries the preset, and is a CDK application. */
  | "eligible"
  /** Carries the preset, and is not a CDK application. */
  | "ineligible"
  /** Carries the preset; the evidence does not settle which. */
  | "undeterminable";

/**
 * File extensions a CDK `app` command can name its entry source with.
 *
 * Deliberately not exhaustive over every runtime: an `app` this list does not
 * match yields `unrecognised`, which is reported as such rather than folded
 * into either verdict.
 */
const ENTRY_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs"] as const;

/** Quote characters a shell-ish `app` command may wrap a path in. */
const QUOTES = new Set(['"', "'", "`"]);

/**
 * Strip one layer of surrounding quotes from a command token.
 * @param token - Whitespace-delimited token from an `app` command
 * @returns The token without its outer quotes
 */
function unquote(token: string): string {
  const first = token.charAt(0);
  if (token.length < 2 || !QUOTES.has(first)) return token;
  return token.charAt(token.length - 1) === first ? token.slice(1, -1) : token;
}

/**
 * The single source file a CDK `app` command names, when there is exactly one.
 *
 * Split on whitespace and filtered by extension rather than matched with a
 * pattern: the command is arbitrary shell, and a token scan cannot backtrack.
 * Zero candidates means the entry is not a source file this module knows how
 * to look for; more than one means the command is doing something this module
 * should not guess about. Both answer `null`, which the caller reports as
 * undeterminable rather than as a finding.
 * @param appCommand - The `app` value from a `cdk.json`
 * @returns The entry source path, or null when it cannot be singled out
 */
export function cdkAppEntrySource(appCommand: string): string | null {
  const candidates = appCommand
    .split(/[ \t\r\n]+/u)
    .map(unquote)
    .filter(token =>
      ENTRY_EXTENSIONS.some(extension => token.endsWith(extension))
    );
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

/**
 * Classify a repository's standing against the CDK application preset.
 * @param evidence - Filesystem evidence gathered by the caller
 * @returns Which of the four states the repository is in
 */
export function classifyCdkPresetAdoption(
  evidence: CdkAdoptionEvidence
): CdkPresetAdoption {
  if (evidence.presetArtifacts.length === 0) return "absent";
  if (!evidence.hasAppMarker) return "ineligible";
  if (evidence.appEntry === null || evidence.appEntry.kind === "unrecognised") {
    return "undeterminable";
  }
  return evidence.appEntry.present ? "eligible" : "ineligible";
}

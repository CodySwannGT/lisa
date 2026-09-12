/**
 * `lisa doctor` check: is this repository carrying a CDK application preset it
 * was never eligible for?
 *
 * `src/detection/detectors/cdk.ts` closed the decision — nothing is classified
 * as a CDK app now without a `cdk.json`. That guard runs at detection time, so
 * it reaches the next apply and nothing else: a repository admitted by the old
 * `aws-cdk*`-dependency arm keeps its preset, its force-merged runtime
 * dependencies, and — because the dead-code gate's entry globs are ordinary
 * TypeScript directory names — a knip run that measures a fraction of the
 * source and exits zero. None of that announces itself, and the first of them
 * actively reports success (CodySwannGT/lisa#3533, CodySwannGT/lisa#3711).
 *
 * This check REPORTS. It removes nothing: a repository may since have come to
 * depend on something the preset delivered, and that judgement is not one a
 * health probe gets to make.
 *
 * The whole point is that an affected repository can find ITSELF, so a probe
 * that cannot look must never render as a repository with nothing to report.
 * Every filesystem answer here is three-valued — present, absent, or
 * undeterminable — and the last one fails rather than passing quietly.
 * @module cli/doctor-cdk-preset-adoption
 */
import { readFile, stat } from "node:fs/promises";
import * as path from "node:path";

import {
  CDK_APP_MARKER,
  CDK_PRESET_ARTIFACTS,
  CDK_PRESET_BIN_ENTRY,
  CDK_PRESET_FORCED_DEPENDENCIES,
  cdkAppEntrySource,
  classifyCdkPresetAdoption,
  type CdkAppEntry,
} from "../core/cdk-preset-adoption.js";
import type { DoctorCheck } from "./doctor.js";

/** Name of the CDK preset-adoption check as doctor reports it. */
export const CDK_PRESET_ADOPTION_CHECK_NAME = "CDK preset earned?";

/** Repo-relative manifest the preset force-merges its dependencies into. */
const PACKAGE_JSON = "package.json";

/**
 * Errno codes that ANSWER the question rather than refusing it: the path is
 * genuinely not there. Anything else — a permission denial, an I/O error, a
 * symlink loop — means the probe could not look, which is a different answer
 * and must not be spelled the same way.
 */
const ABSENT_CODES = new Set(["ENOENT", "ENOTDIR", "ENAMETOOLONG"]);

/**
 * The errno code of a rejected filesystem call, when it carries one.
 * @param error - Value thrown by a filesystem call
 * @returns The errno code, or undefined when the value carries none
 */
function errnoCode(error: unknown): string | undefined {
  const code: unknown =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof code === "string" ? code : undefined;
}

/**
 * Answer whether a repo-relative path exists, REJECTING when the filesystem
 * declines to say.
 *
 * `fs-extra`'s `pathExists` resolves false for every failure, including a
 * permission denial, so a repository this process cannot read would report the
 * same "no CDK preset here" as a healthy one.
 * @param projectRoot - Absolute project root
 * @param relativePath - Repo-relative path to probe
 * @returns True when the path is present, false when it is provably absent
 * @throws {Error} When the filesystem cannot answer
 */
async function probeExists(
  projectRoot: string,
  relativePath: string
): Promise<boolean> {
  try {
    await stat(path.join(projectRoot, relativePath));
    return true;
  } catch (error) {
    const code = errnoCode(error);
    if (code !== undefined && ABSENT_CODES.has(code)) return false;
    throw new Error(
      `could not read ${relativePath}: ${code ?? String(error)}`,
      {
        cause: error,
      }
    );
  }
}

/**
 * Read a repo-relative file, REJECTING when the filesystem declines to say.
 * @param projectRoot - Absolute project root
 * @param relativePath - Repo-relative path to read
 * @returns The file text, or null when the file is provably absent
 * @throws {Error} When the file exists but could not be read
 */
async function readTextOrAbsent(
  projectRoot: string,
  relativePath: string
): Promise<string | null> {
  try {
    return await readFile(path.join(projectRoot, relativePath), "utf8");
  } catch (error) {
    const code = errnoCode(error);
    if (code !== undefined && ABSENT_CODES.has(code)) return null;
    throw new Error(
      `could not read ${relativePath}: ${code ?? String(error)}`,
      {
        cause: error,
      }
    );
  }
}

/**
 * Read a repo-relative JSON document, REJECTING when the filesystem declines
 * to say and when the bytes will not parse.
 *
 * A document that exists but cannot be parsed is not a document with nothing
 * in it, and must not be classified as one.
 * @param projectRoot - Absolute project root
 * @param relativePath - Repo-relative path to read
 * @returns The parsed document, or null when the file is provably absent
 * @throws {Error} When the file exists but could not be read or parsed
 */
async function readJsonOrAbsent(
  projectRoot: string,
  relativePath: string
): Promise<unknown> {
  const text = await readTextOrAbsent(projectRoot, relativePath);
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(
      `could not parse ${relativePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }
}

/**
 * Which CDK-exclusive preset artifacts this repository carries.
 * @param projectRoot - Absolute project root
 * @returns Present artifacts, in the order the preset ships them
 * @throws {Error} When an artifact can be neither confirmed nor ruled out
 */
async function presentPresetArtifacts(
  projectRoot: string
): Promise<readonly string[]> {
  const present = await Promise.all(
    CDK_PRESET_ARTIFACTS.map(artifact => probeExists(projectRoot, artifact))
  );
  return CDK_PRESET_ARTIFACTS.filter((_, index) => present[index] === true);
}

/**
 * What the repository's `cdk.json` declares as its application entrypoint.
 *
 * The marker alone is not enough. `cdk.json` is itself part of what the preset
 * delivers, under `create-only`, so a repository admitted by the old predicate
 * and then applied holds a marker Lisa wrote for it. A real CDK app cannot
 * synth without the entry its `app` command names; a repository holding a
 * seeded marker has never had one.
 * @param projectRoot - Absolute project root
 * @param marker - Parsed `cdk.json` document
 * @returns What the marker's `app` command turns out to name
 * @throws {Error} When the entry can be neither confirmed nor ruled out
 */
async function resolveAppEntry(
  projectRoot: string,
  marker: unknown
): Promise<CdkAppEntry> {
  const app: unknown =
    typeof marker === "object" && marker !== null
      ? (marker as { app?: unknown }).app
      : undefined;
  if (typeof app !== "string") return { kind: "unrecognised" };
  const source = cdkAppEntrySource(app);
  if (source === null) return { kind: "unrecognised" };
  return {
    kind: "resolved",
    source,
    present: await probeExists(projectRoot, source),
  };
}

/**
 * Which of the preset's force-merged package.json entries this repository
 * still carries, stated so the reader knows what to back out.
 * @param manifest - Parsed `package.json`, or null when absent
 * @returns Operator-readable clauses, empty when none are present
 */
function describeMergedEntries(manifest: unknown): readonly string[] {
  if (typeof manifest !== "object" || manifest === null) return [];
  const record = manifest as {
    dependencies?: unknown;
    bin?: unknown;
  };
  const dependencies =
    typeof record.dependencies === "object" && record.dependencies !== null
      ? (record.dependencies as Record<string, unknown>)
      : {};
  const merged = CDK_PRESET_FORCED_DEPENDENCIES.filter(
    name => name in dependencies
  );
  const bin =
    typeof record.bin === "object" && record.bin !== null
      ? (record.bin as Record<string, unknown>)
      : {};
  return [
    merged.length > 0
      ? [`runtime dependencies \`${merged.join("`, `")}\` in ${PACKAGE_JSON}`]
      : [],
    bin[CDK_PRESET_BIN_ENTRY.name] === CDK_PRESET_BIN_ENTRY.target
      ? [
          `a \`bin.${CDK_PRESET_BIN_ENTRY.name}\` entry pointing at ` +
            `\`${CDK_PRESET_BIN_ENTRY.target}\``,
        ]
      : [],
  ].flat();
}

/** What an operator has to weigh before backing any of this out. */
const REMEDY =
  "Nothing here is removed automatically: the repository may since have come " +
  "to depend on something the preset delivered. Decide per file, then keep " +
  `the decision by making sure no \`${CDK_APP_MARKER}\` is present — while ` +
  "one is, every apply re-merges the entries above";

/**
 * The consequence worth stating, because it is the one that reports success.
 */
const QUIET_CONSEQUENCE =
  "The preset's knip `entry` globs include ordinary TypeScript directory " +
  "names (`config`, `util`, `utils`, `functions`), so the dead-code gate may " +
  "be measuring a fraction of the source and passing";

/**
 * Report whether a repository carries a CDK preset it was never eligible for.
 *
 * Fails rather than warns on a hit: a dead-code gate reporting success over a
 * fraction of the source is a live false green, and force-merged runtime
 * dependencies return on every apply until the marker is gone. Fails equally
 * when the question could not be answered, for the reason in the module note.
 * @param targetPath - Project path to inspect
 * @returns Doctor check result
 */
export async function checkCdkPresetAdoption(
  targetPath: string
): Promise<DoctorCheck> {
  try {
    const root = await stat(targetPath);
    if (!root.isDirectory()) {
      throw new Error(`${targetPath} is not a directory`);
    }
    return await assess(targetPath);
  } catch (error) {
    return {
      name: CDK_PRESET_ADOPTION_CHECK_NAME,
      status: "fail",
      detail:
        "Could not determine whether this repository carries a CDK " +
        `application preset: ${
          error instanceof Error ? error.message : String(error)
        }. Treated as a failure rather than a pass: a tree that could not be ` +
        "read is not a tree with nothing in it",
    };
  }
}

/**
 * Gather the evidence and turn it into the check line it earns.
 * @param projectRoot - Absolute project root
 * @returns Doctor check result
 * @throws {Error} When any part of the evidence cannot be gathered
 */
async function assess(projectRoot: string): Promise<DoctorCheck> {
  const presetArtifacts = await presentPresetArtifacts(projectRoot);
  if (presetArtifacts.length === 0) {
    return ok("No CDK application preset artifacts in this repository");
  }
  const marker = await readJsonOrAbsent(projectRoot, CDK_APP_MARKER);
  const hasAppMarker = marker !== null;
  const appEntry = hasAppMarker
    ? await resolveAppEntry(projectRoot, marker)
    : null;
  const adoption = classifyCdkPresetAdoption({
    presetArtifacts,
    hasAppMarker,
    appEntry,
  });
  if (adoption === "eligible") {
    return ok(`Carries the CDK application preset and has a ${CDK_APP_MARKER}`);
  }
  if (adoption === "undeterminable") {
    return {
      name: CDK_PRESET_ADOPTION_CHECK_NAME,
      status: "warn",
      detail:
        `This repository carries the CDK application preset and a ` +
        `${CDK_APP_MARKER}, but that marker names no application entry this ` +
        "check can look for, so whether the preset was earned could not be " +
        `settled. Confirm by hand that \`${CDK_APP_MARKER}\` drives a real ` +
        `CDK app; if it does not, see ${QUIET_CONSEQUENCE.toLowerCase()}`,
    };
  }
  return {
    name: CDK_PRESET_ADOPTION_CHECK_NAME,
    status: "fail",
    detail: ineligibleDetail(
      presetArtifacts,
      appEntry !== null && appEntry.kind === "resolved"
        ? appEntry.source
        : null,
      await mergedEntries(projectRoot)
    ),
  };
}

/**
 * The preset's force-merged manifest entries, or why they could not be listed.
 *
 * A manifest this check cannot read does not unsettle the verdict — the
 * verdict was already reached from the artifacts and the marker — so the
 * failure is stated as part of the finding instead of replacing it with
 * "could not determine".
 * @param projectRoot - Absolute project root
 * @returns Operator-readable clauses, empty when there are none to state
 */
async function mergedEntries(projectRoot: string): Promise<readonly string[]> {
  try {
    return describeMergedEntries(
      await readJsonOrAbsent(projectRoot, PACKAGE_JSON)
    );
  } catch (error) {
    return [
      `entries this check could not list, because ${PACKAGE_JSON} would not ` +
        `read (${error instanceof Error ? error.message : String(error)})`,
    ];
  }
}

/**
 * State the finding, what it delivered, and what the reader has to decide.
 * @param presetArtifacts - CDK-exclusive artifacts found
 * @param missingEntry - Entry the marker names but does not have, if any
 * @param delivered - Force-merged package.json entries still present
 * @returns One operator-readable detail line
 */
function ineligibleDetail(
  presetArtifacts: readonly string[],
  missingEntry: string | null,
  delivered: readonly string[]
): string {
  const why =
    missingEntry === null
      ? `there is no ${CDK_APP_MARKER}, which is the only thing that admits ` +
        "the preset"
      : `its ${CDK_APP_MARKER} names an application entry ` +
        `(\`${missingEntry}\`) that does not exist, so the marker is one ` +
        "Lisa seeded rather than one this repository wrote";
  const merged =
    delivered.length > 0
      ? ` It also force-merged ${delivered.join(" and ")}.`
      : "";
  return (
    "This repository carries the CDK application preset it was never " +
    `eligible for: \`${presetArtifacts.join("`, `")}\` are present and ` +
    `${why}.${merged} ${QUIET_CONSEQUENCE}. ${REMEDY}`
  );
}

/**
 * A passing line for this check.
 * @param detail - What was found
 * @returns Doctor check result
 */
function ok(detail: string): DoctorCheck {
  return { name: CDK_PRESET_ADOPTION_CHECK_NAME, status: "ok", detail };
}

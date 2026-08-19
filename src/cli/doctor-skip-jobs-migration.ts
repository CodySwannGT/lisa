/**
 * Doctor check: report the gate declaration that replaces each `skip_jobs`
 * token a caller still passes.
 *
 * `skip_jobs` is being retired in favour of `moment` plus gate levels —
 * `quality.yml`'s own `moment` input says so — and it is unsafe by
 * construction, because GitHub counts a SKIPPED required status check as
 * SATISFIED. A job named in `skip_jobs` reports green against a context its
 * ruleset still requires, having run nothing.
 *
 * No consumer could migrate off it, because the table saying which gate
 * replaces which token lived only in one of Lisa's test fixtures — not shipped,
 * so nothing running in a caller repository could read it. Eleven of the pairs
 * are not recoverable from the name (`sg_scan` is `structural-rules`), and
 * being wrong declares the WRONG gate `off`: a check silently stops running
 * while the configuration reads deliberate. The table now ships in
 * `scripts/lisa-gates.mjs`, and this check reads it.
 *
 * ## Why this reports rather than repairs
 *
 * Established the hard way in this repository on 2026-08-18. A doctor check was
 * built that auto-migrated `*.test.mjs` suites to `.test.ts`. It passed six
 * fixture tests. Against a real consumer's twelve suites it would have migrated
 * ten, and nine of those import a local `.mjs` module that project's jest
 * cannot load — turning passing suites into hard failures. The fixtures agreed
 * with the code because one author wrote both.
 *
 * `lisa apply` runs on postinstall. A repair that edits a caller's workflow
 * there and gets it wrong is silent. So this check establishes what is true and
 * names the exact edit; the edit is made by something that can read the
 * surrounding code and verify afterwards that the same checks still run.
 *
 * ## Why it warns and never fails
 *
 * The input still works, and it must keep working until every consumer has
 * migrated. A `fail` here would turn `lisa doctor` red in every repository that
 * has not yet done a migration Lisa only just made possible.
 * @module cli/doctor-skip-jobs-migration
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { DoctorCheck } from "./doctor.js";

/** Name rendered in the doctor report. */
const CHECK_NAME = "skip_jobs migrated to gates?";

/** The moment `quality.yml` resolves gates at when a caller declares none. */
const DEFAULT_MOMENT = "pull-request";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** A caller's `skip_jobs` input, whatever quoting style it uses. */
const SKIP_JOBS_INPUT = /^([ \t]{0,64})skip_jobs:[ \t]{0,64}(.{0,4096})$/;

/** A caller's `moment` input, whatever quoting style it uses. */
const MOMENT_INPUT = /^([ \t]{0,64})moment:[ \t]{0,64}(.{0,4096})$/;

/** One token's migration, exactly as the shipped registry resolves it. */
export interface SkipJobToken {
  /** The token as the caller spells it, including any damaging whitespace. */
  readonly token: string;
  /** One of the registry's `SKIP_JOB_STATUS` values. */
  readonly status: string;
  /** The gate that replaces it, or null when there is none. */
  readonly gate: string | null;
  /** The `quality.yml` jobs the token suppresses. */
  readonly jobs: readonly string[];
  /** Suppressed jobs with no gate — these keep running after the migration. */
  readonly ungated: readonly string[];
  /** The `.lisa.config.json` fragment to write, or null when none exists. */
  readonly declaration: string | null;
}

/** One caller workflow that still passes `skip_jobs`. */
export interface SkipJobCaller {
  /** Workflow file, relative to the project root. */
  readonly file: string;
  /** The moment that caller resolves gates at. */
  readonly moment: string;
  /** Every token it passes, in the order it passes them. */
  readonly tokens: readonly SkipJobToken[];
}

/** The slice of the shipped registry this check calls. */
interface GateRegistryModule {
  readonly skipJobMigration: (
    token: string,
    moment: string
  ) => {
    readonly token: string;
    readonly status: string;
    readonly gate: string | null;
    readonly jobs: readonly string[];
    readonly ungated: readonly string[];
    readonly declaration: string | null;
  };
}

/**
 * Walk parents until a package-root-relative file exists.
 * @param startDir - Directory to start searching from
 * @param relativePath - Path under the package root
 * @returns Absolute path, or null when no ancestor holds it
 */
function findPackageFileWalk(
  startDir: string,
  relativePath: string
): string | null {
  const candidate = path.join(startDir, relativePath);
  if (existsSync(candidate)) return candidate;
  const parent = path.dirname(startDir);
  return parent === startDir ? null : findPackageFileWalk(parent, relativePath);
}

/**
 * Locate the shipped gate registry inside the running Lisa package.
 *
 * Deliberately Lisa's own copy rather than the project's `scripts/lisa-gates.mjs`.
 * Both are the same file in a healthy repository — it installs by
 * copy-overwrite — but a stale project copy would answer with a table that
 * describes a workflow that is no longer there, which is the failure this whole
 * check exists to stop. The authority is the version of Lisa doing the
 * reporting.
 * @returns Absolute path to the registry, or null when it cannot be found
 */
function resolveGateRegistry(): string | null {
  const relative = path.join(
    "all",
    "copy-overwrite",
    "scripts",
    "lisa-gates.mjs"
  );
  const fromPackageRoot = path.join(__dirname, "..", "..", relative);
  if (existsSync(fromPackageRoot)) return fromPackageRoot;
  return findPackageFileWalk(__dirname, relative);
}

/**
 * Import the shipped registry.
 * @returns The registry module, or null when it is not installed
 */
async function loadRegistry(): Promise<GateRegistryModule | null> {
  const script = resolveGateRegistry();
  if (script === null) return null;
  return (await import(
    pathToFileURL(script).href
  )) as unknown as GateRegistryModule;
}

/**
 * Strip YAML quoting and a trailing comment from an inline scalar.
 * @param raw - The text after `key:`
 * @returns The scalar's value
 */
function scalar(raw: string): string {
  const withoutComment = /^(['"])(.*?)\1/.exec(raw.trim());
  if (withoutComment) return withoutComment[2] ?? "";
  return raw.split("#")[0]?.trim() ?? "";
}

/**
 * The `moment` declared in the same `with:` block as a `skip_jobs` line.
 *
 * Scoped by indentation rather than taken from anywhere in the file: a
 * workflow may call `quality.yml` twice with different moments, and attributing
 * one job's moment to the other's tokens would produce a declaration that is
 * legal for neither.
 * @param lines - The workflow file's lines
 * @param at - Index of the `skip_jobs` line
 * @param indent - That line's leading whitespace
 * @returns The declared moment, or the workflow's default
 */
function momentFor(lines: string[], at: number, indent: string): string {
  const sameBlock = (index: number): boolean => {
    const line = lines[index];
    if (line === undefined) return false;
    if (line.trim() === "") return true;
    return line.startsWith(indent) && !/^[ \t]/.test(line.slice(indent.length));
  };
  const declaredAt = (index: number): string | null => {
    const match = MOMENT_INPUT.exec(lines[index] ?? "");
    return match && match[1] === indent ? scalar(match[2] ?? "") : null;
  };
  const scan = (index: number, step: number): string | null =>
    sameBlock(index) ? (declaredAt(index) ?? scan(index + step, step)) : null;
  return scan(at - 1, -1) ?? scan(at + 1, 1) ?? DEFAULT_MOMENT;
}

/**
 * Every workflow file in a project's `.github/workflows` directory.
 * @param targetPath - Project root
 * @returns Absolute paths, empty when the directory is absent
 */
async function workflowFiles(targetPath: string): Promise<string[]> {
  const dir = path.join(targetPath, ".github", "workflows");
  const entries = await readdir(dir).catch(() => undefined);
  if (entries === undefined) return [];
  return entries
    .filter(name => /\.ya?ml$/.test(name))
    .sort((left, right) => left.localeCompare(right))
    .map(name => path.join(dir, name));
}

/**
 * Read one workflow's `skip_jobs` callers.
 *
 * Matched as text rather than through a YAML parse, for the same reason
 * `doctor-reusable-workflow-refs` does: a caller whose YAML is malformed still
 * passes the input, and a parse failure would silently drop the file from the
 * audit — reporting a migrated project because one file could not be read.
 * @param registry - The shipped gate registry
 * @param targetPath - Project root
 * @param file - Absolute path to the workflow
 * @returns One entry per `skip_jobs` input carrying at least one token
 */
async function callersIn(
  registry: GateRegistryModule,
  targetPath: string,
  file: string
): Promise<SkipJobCaller[]> {
  const lines = (await readFile(file, "utf8").catch(() => "")).split("\n");
  return lines.flatMap((line, index) => {
    const match = SKIP_JOBS_INPUT.exec(line);
    if (match === null) return [];
    const indent = match[1] ?? "";
    // Split on commas WITHOUT trimming. `'lint, lint_slow'` yields the token
    // `" lint_slow"`, which GitHub matches against nothing, so that job RUNS.
    // Trimming here would report a skip that was never in effect and migrate
    // the operator to a declaration that turns a passing check off.
    const tokens = scalar(match[2] ?? "")
      .split(",")
      .filter(token => token !== "");
    if (tokens.length === 0) return [];
    const moment = momentFor(lines, index, indent);
    return [
      {
        file: path.relative(targetPath, file),
        moment,
        tokens: tokens.map(token => {
          const resolved = registry.skipJobMigration(token, moment);
          return {
            token: resolved.token,
            status: resolved.status,
            gate: resolved.gate,
            jobs: resolved.jobs,
            ungated: resolved.ungated,
            declaration: resolved.declaration,
          };
        }),
      },
    ];
  });
}

/**
 * Every caller in a project that still passes `skip_jobs`, with its migration.
 * @param targetPath - Project root
 * @returns One entry per `skip_jobs` input carrying at least one token
 */
export async function skipJobCallers(
  targetPath: string
): Promise<SkipJobCaller[]> {
  const registry = await loadRegistry();
  if (registry === null) return [];
  const files = await workflowFiles(targetPath);
  const perFile = await Promise.all(
    files.map(file => callersIn(registry, targetPath, file))
  );
  return perFile.flat();
}

/**
 * The operator-readable line for one token.
 * @param entry - The token's resolved migration
 * @returns One line naming the edit, or naming why there is none
 */
export function describeToken(entry: SkipJobToken): string {
  switch (entry.status) {
    case "replaceable":
      return `${entry.token} → declare ${entry.declaration} and delete the token`;
    case "partial":
      return (
        `${entry.token} → PARTIAL: ${entry.declaration} covers ${entry.gate ?? ""}, ` +
        `but ${entry.ungated.join(", ")} have no gate yet and keep running — ` +
        "keep the token until they are converted"
      );
    case "moment-illegal":
      return (
        `${entry.token} → the ${entry.gate ?? ""} gate cannot be declared at this ` +
        "caller's moment, so there is no legal declaration — keep the token"
      );
    case "unmappable":
      return (
        `${entry.token} → no gate equivalent yet (${entry.jobs.join(", ")} ` +
        "was never converted to a gate façade) — keep the token"
      );
    case "inert":
      return `${entry.token} → no job honours this token; it suppresses nothing`;
    default:
      return (
        `${entry.token} → unknown token; no job matches it, so it suppresses ` +
        "nothing (check for a space after a comma)"
      );
  }
}

/**
 * Report the gate declarations that replace a caller's `skip_jobs` tokens.
 *
 * Reports only. `ci.yml` ships create-only, so `lisa apply` never refreshes it
 * and the migration is a consumer-side edit either way — but the reason this
 * does not write is the one in the module docstring, not that one.
 * @param targetPath - Project path to inspect
 * @returns Doctor check result
 */
export async function checkSkipJobsMigration(
  targetPath: string
): Promise<DoctorCheck> {
  const callers = await skipJobCallers(targetPath);
  if (callers.length === 0) {
    return {
      name: CHECK_NAME,
      status: "ok",
      detail: "No caller workflow passes skip_jobs",
    };
  }

  const detail = callers
    .map(
      caller =>
        `${caller.file} (moment: ${caller.moment}) — ${caller.tokens
          .map(describeToken)
          .join("; ")}`
    )
    .join(" | ");

  const count = callers.reduce(
    (total, caller) => total + caller.tokens.length,
    0
  );

  return {
    name: CHECK_NAME,
    status: "warn",
    detail:
      `${count} skip_jobs token(s) still passed. A skipped required check ` +
      `counts as SATISFIED on GitHub, so each of these reports green having ` +
      `run nothing; declaring the gate instead removes it from the required ` +
      `contexts. Add the declarations to the "gates" block of ` +
      `.lisa.config.json, then delete the token — doctor does not edit the ` +
      `workflow, so confirm the same checks still run afterwards. Same answer ` +
      `on demand: \`node scripts/lisa-gates.mjs skip-jobs --json\`. ${detail}`,
  };
}

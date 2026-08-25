/**
 * Doctor check: report what to do about each `skip_jobs` token a caller still
 * passes — the gate declaration that replaces it, or, for a token no gate
 * governs, that there is no declaration to write and the token should go.
 *
 * The second half is not a footnote. `SKIP_JOB_TOKENS` has more entries than
 * `QUALITY_JOB_GATES`, so some tokens resolve to `gates: []`, and telling
 * their operator to declare a gate names a destination that does not exist
 * (CodySwannGT/lisa#3101). Both the per-token lines and the summary above them
 * are derived from the same per-token classification so they cannot disagree.
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
import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";

import type { DoctorCheck } from "./doctor.js";
import { importGateRegistry } from "./gate-registry-source.js";

/** Name rendered in the doctor report. */
const CHECK_NAME = "skip_jobs migrated to gates?";

/** The moment `quality.yml` resolves gates at when a caller declares none. */
const DEFAULT_MOMENT = "pull-request";

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
 * Import the shipped registry.
 *
 * Resolution lives in `gate-registry-source` so every doctor check that reads
 * the registry reads the same copy — the one inside the running Lisa package,
 * never a project's possibly-stale `scripts/lisa-gates.mjs`.
 * @returns The registry module, or null when it is not installed
 */
async function loadRegistry(): Promise<GateRegistryModule | null> {
  return importGateRegistry<GateRegistryModule>();
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
        `${entry.token} → no gate governs ${entry.jobs.join(", ")} ` +
        "(never converted to a gate façade), so there is no declaration to " +
        "write for this token — keep it, because deleting it lets that job run"
      );
    case "inert":
      // The defect this branch was fixed for: it used to stop at "suppresses
      // nothing", and the summary then told EVERY operator to declare a gate.
      // For a token with `gates: []` there is no gate id to write, so the
      // instruction named a destination that does not exist and left the
      // operator further from a working configuration than the token did.
      return (
        `${entry.token} → no job honours this token and no gate governs it, ` +
        "so it suppresses nothing and there is no gate to declare in its " +
        "place — delete it from skip_jobs"
      );
    case "retired":
      // Distinct from `unknown` on purpose. The default branch below tells the
      // reader to check for a space after a comma, which is wrong advice for a
      // token they spelled correctly and which this workflow really did honour.
      return (
        `${entry.token} → RETIRED: this workflow deliberately deleted the token, ` +
        "so it suppresses nothing and cannot be made to — delete it from skip_jobs"
      );
    default:
      return (
        `${entry.token} → unknown token; no job matches it, so it suppresses ` +
        "nothing (check for a space after a comma)"
      );
  }
}

/** How many tokens fall in each class the remediation answers differently. */
interface TokenCounts {
  /** Every token reported, whatever it resolves to. */
  readonly total: number;
  /** Tokens a job honours — these really do report green having run nothing. */
  readonly suppressing: number;
  /** Suppressing tokens with a declaration to migrate to. */
  readonly declarable: number;
  /** Suppressing tokens with none — no gate, or none legal at this moment. */
  readonly keepers: number;
  /** Tokens no job honours and no gate governs — nothing to declare. */
  readonly hollow: number;
}

/**
 * Count the token classes the summary has to speak about separately.
 * @param callers - Every caller reported
 * @returns The per-class counts
 */
function countTokens(callers: readonly SkipJobCaller[]): TokenCounts {
  const tokens = callers.flatMap(caller => [...caller.tokens]);
  const suppressing = tokens.filter(entry => entry.jobs.length > 0);
  const declarable = suppressing.filter(
    entry => entry.declaration !== null
  ).length;
  return {
    total: tokens.length,
    suppressing: suppressing.length,
    declarable,
    keepers: suppressing.length - declarable,
    hollow: tokens.length - suppressing.length,
  };
}

/**
 * The tokens that really do report green having run nothing.
 * @param count - How many
 * @returns The sentence
 */
function falselyGreen(count: number): string {
  return count === 1
    ? "1 turns off a check that GitHub counts as SATISFIED when it is " +
        "skipped, so it reports green having run nothing."
    : `${count} turn off checks that GitHub counts as SATISFIED when they ` +
        "are skipped, so they report green having run nothing.";
}

/**
 * The tokens a gate declaration replaces.
 * @param count - How many
 * @returns The sentence
 */
function migrateThese(count: number): string {
  const tail =
    ' declaration to the "gates" block of .lisa.config.json, then delete the ' +
    "token — declaring the gate takes the check out of the required contexts " +
    "instead of leaving it falsely green.";
  return count === 1
    ? `1 of those has a gate to migrate to: add the${tail}`
    : `${count} of those have a gate to migrate to: add each${tail}`;
}

/**
 * The tokens that suppress a job no declaration can replace.
 *
 * Deleting one of these is not the same edit as deleting a hollow token: the
 * job it was suppressing starts running. That is the operator's call to make,
 * and they cannot make it from a line that only says "migrate".
 * @param count - How many
 * @returns The sentence
 */
function keepThese(count: number): string {
  const why =
    " no declaration to write (no gate, or none legal at this caller's " +
    "moment): keep ";
  return count === 1
    ? `1 has${why}it, because deleting it lets the job it suppresses run.`
    : `${count} have${why}them, because deleting one lets the job it ` +
        "suppresses run.";
}

/**
 * The tokens that suppress nothing and have no gate — the #3101 case.
 * @param count - How many
 * @returns The sentence
 */
function deleteThese(count: number): string {
  return count === 1
    ? "1 suppresses nothing and no gate governs it, so there is nothing to " +
        "declare — delete that token from skip_jobs."
    : `${count} suppress nothing and no gate governs them, so there is ` +
        "nothing to declare — delete those tokens from skip_jobs.";
}

/**
 * The summary above the per-token lines, saying only what holds for the tokens
 * actually found.
 *
 * Written per class rather than once for all of them, because it used to be a
 * blanket claim: every operator was told the tokens report green having run
 * nothing and that declaring the gate fixes it. Neither half holds for a token
 * with no jobs and no gate — it suppresses nothing, and there is no gate id to
 * declare. An operator who followed that text on such a token wrote a
 * declaration for a gate that does not exist. The aggregate and the per-token
 * lines have to agree, so both are now derived from the same classification.
 * @param callers - Every caller reported
 * @returns The summary sentences, space-joined
 */
function summarize(callers: readonly SkipJobCaller[]): string {
  const counts = countTokens(callers);
  return [
    `${counts.total} skip_jobs token(s) still passed.`,
    ...(counts.suppressing > 0 ? [falselyGreen(counts.suppressing)] : []),
    ...(counts.declarable > 0 ? [migrateThese(counts.declarable)] : []),
    ...(counts.keepers > 0 ? [keepThese(counts.keepers)] : []),
    ...(counts.hollow > 0 ? [deleteThese(counts.hollow)] : []),
    "doctor does not edit the workflow, so confirm the same checks still run " +
      "afterwards.",
    "Same answer on demand: `node scripts/lisa-gates.mjs skip-jobs --json`.",
  ].join(" ");
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

  return {
    name: CHECK_NAME,
    status: "warn",
    detail: `${summarize(callers)} ${detail}`,
  };
}

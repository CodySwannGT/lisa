/**
 * Which moment each job in a project's workflows resolves `quality.yml` gates
 * at, and which jobs reach `quality.yml` at all.
 *
 * Split out of `doctor-skip-jobs-migration` because the two questions have
 * different populations. That check reports the jobs passing `skip_jobs`; the
 * jobs that decide whether its advice is SAFE are mostly the ones passing no
 * `skip_jobs` at all, because a gate declaration is keyed by gate and moment in
 * `.lisa.config.json` and therefore governs every job resolving that moment
 * (CodySwannGT/lisa#3100).
 *
 * Matched as text rather than through a YAML parse, for the same reason
 * `doctor-reusable-workflow-refs` does: a caller whose YAML is malformed still
 * passes the input, and a parse failure would silently drop the file from the
 * audit — reporting a migrated project because one file could not be read.
 * @module cli/workflow-moments
 */
import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";

/** The moment `quality.yml` resolves gates at when a caller declares none. */
export const DEFAULT_MOMENT = "pull-request";

/** A caller's `moment` input, whatever quoting style it uses. */
const MOMENT_INPUT = /^([ \t]{0,64})moment:[ \t]{0,64}(.{0,4096})$/;

/** Any `uses:` line, with its indentation and its unparsed value. */
const USES_INPUT = /^([ \t]{0,64})uses:[ \t]{0,64}(.{0,4096})$/;

/**
 * A `uses:` value reaching `quality.yml`, directly or through `release.yml`.
 *
 * `release.yml` counts because it forwards its own `moment` input straight on
 * to `quality.yml`, so a job calling it resolves a `quality.yml` gate set just
 * as directly as a job naming `quality.yml` itself.
 */
const QUALITY_WORKFLOW = /workflows\/(?:quality|release)\.ya?ml(?:@|$)/;

/** The `with:` key — the sibling of `uses:` whose children carry `moment`. */
const WITH_BLOCK = /^with:[ \t]{0,64}(?:#.{0,512})?$/;

/** A `workflow_call` trigger, in either the block or the inline-list form. */
const WORKFLOW_CALL = /^(?:[ \t]{1,64}workflow_call:|on:.{0,256}workflow_call)/;

/**
 * Strip YAML quoting and a trailing comment from an inline scalar.
 * @param raw - The text after `key:`
 * @returns The scalar's value
 */
export function scalar(raw: string): string {
  const withoutComment = /^(['"])(.*?)\1/.exec(raw.trim());
  if (withoutComment) return withoutComment[2] ?? "";
  return raw.split("#")[0]?.trim() ?? "";
}

/**
 * A predicate for "this line is still a key of the block sitting at `indent`".
 *
 * Blank lines count as inside so a block separated by one is not cut in half.
 * @param lines - The workflow file's lines
 * @param indent - The leading whitespace of the block's keys
 * @returns The predicate
 */
function blockAt(lines: string[], indent: string): (index: number) => boolean {
  return (index: number): boolean => {
    const line = lines[index];
    if (line === undefined) return false;
    if (line.trim() === "") return true;
    return line.startsWith(indent) && !/^[ \t]/.test(line.slice(indent.length));
  };
}

/**
 * The `moment` declared among the keys sitting at one indentation.
 *
 * Scoped by indentation rather than taken from anywhere in the file: a
 * workflow may call `quality.yml` twice with different moments, and attributing
 * one job's moment to the other's tokens would produce a declaration that is
 * legal for neither.
 * @param lines - The workflow file's lines
 * @param at - Index to scan outwards from
 * @param indent - The indentation of the keys to scan
 * @returns The declared moment, or the workflow's default
 */
export function momentFor(lines: string[], at: number, indent: string): string {
  const inBlock = blockAt(lines, indent);
  const declaredAt = (index: number): string | null => {
    const match = MOMENT_INPUT.exec(lines[index] ?? "");
    return match && match[1] === indent ? scalar(match[2] ?? "") : null;
  };
  const scan = (index: number, step: number): string | null =>
    inBlock(index) ? (declaredAt(index) ?? scan(index + step, step)) : null;
  return scan(at - 1, -1) ?? scan(at + 1, 1) ?? DEFAULT_MOMENT;
}

/**
 * The indentation of a block's first child line.
 * @param lines - The workflow file's lines
 * @param from - Index to start looking at
 * @param outer - The parent key's leading whitespace
 * @returns The child indentation, or null when the block has no children
 */
function firstChildIndent(
  lines: string[],
  from: number,
  outer: string
): string | null {
  const line = lines[from];
  if (line === undefined) return null;
  if (line.trim() === "") return firstChildIndent(lines, from + 1, outer);
  const lead = /^[ \t]{0,128}/.exec(line)?.[0] ?? "";
  return lead.length > outer.length && lead.startsWith(outer) ? lead : null;
}

/**
 * The moment one `uses:` call resolves gates at.
 *
 * `with:` is a sibling key of `uses:` inside the same job and `moment:` is one
 * of its children, so this locates the sibling `with:` and then reuses the
 * indentation-scoped scan `momentFor` performs around a `skip_jobs` line.
 * @param lines - The workflow file's lines
 * @param at - Index of the `uses:` line
 * @param indent - That line's leading whitespace
 * @returns The declared moment, or the workflow's default
 */
function momentForCall(lines: string[], at: number, indent: string): string {
  const inBlock = blockAt(lines, indent);
  const findWith = (index: number, step: number): number | null => {
    if (!inBlock(index)) return null;
    if (WITH_BLOCK.test((lines[index] ?? "").slice(indent.length)))
      return index;
    return findWith(index + step, step);
  };
  const withAt = findWith(at - 1, -1) ?? findWith(at + 1, 1);
  if (withAt === null) return DEFAULT_MOMENT;
  const children = firstChildIndent(lines, withAt + 1, indent);
  return children === null
    ? DEFAULT_MOMENT
    : momentFor(lines, withAt, children);
}

/**
 * Every workflow file in a project's `.github/workflows` directory.
 * @param targetPath - Project root
 * @returns Absolute paths, empty when the directory is absent
 */
export async function workflowFiles(targetPath: string): Promise<string[]> {
  const dir = path.join(targetPath, ".github", "workflows");
  const entries = await readdir(dir).catch(() => undefined);
  if (entries === undefined) return [];
  return entries
    .filter(name => /\.ya?ml$/.test(name))
    .sort((left, right) => left.localeCompare(right))
    .map(name => path.join(dir, name));
}

/** One job that reaches `quality.yml`, whether or not it passes `skip_jobs`. */
export interface QualityCall {
  /** Workflow file, relative to the project root. */
  readonly file: string;
  /** The moment it resolves, or null when an expression decides it. */
  readonly moment: string | null;
}

/**
 * Every job in one workflow that reaches `quality.yml`.
 *
 * A workflow that is itself called by others (`on: workflow_call`) is skipped.
 * `release.yml` is one, and it forwards whatever moment ITS caller passed — so
 * counting it would invent a caller no repository ever triggers, and would name
 * a file the operator cannot edit.
 * @param targetPath - Project root
 * @param file - Absolute path to the workflow
 * @returns One entry per job reaching `quality.yml`
 */
async function qualityCallsIn(
  targetPath: string,
  file: string
): Promise<QualityCall[]> {
  const lines = (await readFile(file, "utf8").catch(() => "")).split("\n");
  if (lines.some(line => WORKFLOW_CALL.test(line))) return [];
  return lines.flatMap((line, index) => {
    const match = USES_INPUT.exec(line);
    if (match === null) return [];
    if (!QUALITY_WORKFLOW.test(scalar(match[2] ?? ""))) return [];
    const moment = momentForCall(lines, index, match[1] ?? "");
    return [
      {
        file: path.relative(targetPath, file),
        // An expression is not a moment. Reported as null so the advice counts
        // this job against EVERY moment and says it could not be pinned —
        // guessing the default instead would shrink the set of callers a
        // declaration is known to govern, which is the direction that harms.
        moment: moment.includes("${{") ? null : moment,
      },
    ];
  });
}

/**
 * Every job in a project that reaches `quality.yml`.
 * @param targetPath - Project root
 * @returns One entry per job, in workflow-file order
 */
export async function qualityCalls(targetPath: string): Promise<QualityCall[]> {
  const files = await workflowFiles(targetPath);
  const perFile = await Promise.all(
    files.map(file => qualityCallsIn(targetPath, file))
  );
  return perFile.flat();
}

/** What else in the project resolves the moment a token's caller resolves. */
export interface MomentContext {
  /** The moment the caller resolves. */
  readonly moment: string;
  /** Every job resolving it, this caller included, named by workflow file. */
  readonly callers: readonly string[];
  /** Jobs whose moment an expression sets, so doctor cannot pin which it is. */
  readonly unpinned: readonly string[];
}

/**
 * The clause naming the jobs whose moment could not be pinned, if any.
 * @param context - The moment and every job resolving it
 * @returns A parenthetical clause, or the empty string
 */
export function unpinnedClause(context: MomentContext): string {
  if (context.unpinned.length === 0) return "";
  return (
    ` (${context.unpinned.join(", ")} builds its moment from an expression, ` +
    "so doctor cannot tell which moment it resolves and counts it here rather " +
    "than assuming it is a different one)"
  );
}

/**
 * Which jobs resolve one moment.
 *
 * A job whose moment an expression decides counts against every moment: it may
 * be this one, and leaving it out would under-report the callers a declaration
 * governs — the direction that produces the harmful advice.
 * @param calls - Every job in the project reaching `quality.yml`
 * @param moment - The moment to resolve callers for
 * @returns The moment and the jobs resolving it
 */
export function momentContext(
  calls: readonly QualityCall[],
  moment: string
): MomentContext {
  const byName = (left: string, right: string): number =>
    left.localeCompare(right);
  const unpinned = calls.filter(call => call.moment === null);
  return {
    moment,
    callers: calls
      .filter(call => call.moment === null || call.moment === moment)
      .map(call => call.file)
      .sort(byName),
    unpinned: [...new Set(unpinned.map(call => call.file))].sort(byName),
  };
}

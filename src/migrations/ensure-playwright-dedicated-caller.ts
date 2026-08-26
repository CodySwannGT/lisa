import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as fse from "fs-extra";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

/** The seeded caller this migration repairs. */
const CALLER_FILE = path.join(".github", "workflows", "playwright-e2e.yml");

/** Any job-level caller pointing at a Lisa reusable workflow. */
const LISA_CALLER =
  /^\s*uses:\s*CodySwannGT\/lisa\/\.github\/workflows\/(\S+?)\.yml@(\S+)\s*$/u;

/** The reusable workflow a repaired caller must target. */
const DEDICATED_WORKFLOW = "playwright-e2e";

/** The reusable workflow a stale caller still targets. */
const STALE_WORKFLOW = "quality";

/** The `with:` block header inside a caller job. */
const WITH_HEADER = /^ {4}with:\s*$/u;

/** One input key inside a `with:` block. Continuation lines indent deeper. */
const WITH_KEY = /^ {6}(\w+):(.*)$/u;

/** A comment line at input indent — explanatory prose attached to the key below. */
const WITH_COMMENT = /^ {6}#/u;

/** The input a stale caller passes that the dedicated workflow does not declare. */
const RETIRED_INPUT = "skip_jobs";

/**
 * Inputs `playwright-e2e.yml` declares.
 *
 * Hardcoded rather than read from `ctx.lisaDir`, because `.github/` is not in
 * the npm `files` allowlist — an installed Lisa carries no copy of the reusable
 * workflow to parse. Exported so a test can pin it against the real workflow:
 * an input added or renamed there would otherwise silently turn every caller
 * passing it into a "diverged" verdict that nobody retrofits.
 */
export const DECLARED_INPUTS: ReadonlySet<string> = new Set([
  "node_version",
  "package_manager",
  "working_directory",
  "moment",
  "playwright_setup_command",
  "playwright_shards",
  "cache_build",
  "concurrency_group",
  "prepare_environment",
  "prepare_verbs",
  "prepare_setup_command",
  "prepare_timeout_minutes",
]);

/** How a project's caller was classified. */
type Verdict = "not-applicable" | "current" | "stale" | "diverged";

/** One key/value pair read out of a caller's `with:` block. */
interface WithEntry {
  readonly index: number;
  readonly key: string;
  readonly value: string;
}

/** The result of reading and classifying a project's caller. */
interface Plan {
  readonly verdict: Verdict;
  /** Operator-readable explanation, set only for `diverged`. */
  readonly reason: string;
  readonly lines: readonly string[];
  /** Index of the `uses:` line, when a single Lisa caller was found. */
  readonly usesAt: number;
  /** Git ref the caller pins, preserved across the repoint. */
  readonly ref: string;
  /** Index of the `    with:` header line. */
  readonly withAt: number;
  /** Index of the `      skip_jobs:` line, or -1 when absent. */
  readonly retiredAt: number;
  /** Value of the caller's `moment:` input, unquoted. */
  readonly moment: string;
}

const EMPTY: Plan = {
  verdict: "not-applicable",
  reason: "",
  lines: [],
  usesAt: -1,
  ref: "",
  withAt: -1,
  retiredAt: -1,
  moment: "",
};

/**
 * Read the input keys of the `with:` block starting at the given header line.
 * @param lines - The caller file split into lines
 * @param withAt - Index of the `    with:` header line
 * @returns One entry per input key, in file order
 */
function readWithEntries(
  lines: readonly string[],
  withAt: number
): readonly WithEntry[] {
  // Blank lines and comments stay inside the block; anything indented four
  // spaces or less ends it. Continuation lines of a block scalar indent deeper
  // than six spaces and so never match WITH_KEY.
  const breaksAt = lines.findIndex(
    (line, i) => i > withAt && line.trim() !== "" && !line.startsWith("      ")
  );
  const limit = breaksAt < 0 ? lines.length : breaksAt;
  return lines
    .slice(withAt + 1, limit)
    .map((line, offset) => ({
      index: withAt + 1 + offset,
      match: WITH_KEY.exec(line),
    }))
    .filter(
      (entry): entry is { index: number; match: RegExpExecArray } =>
        entry.match !== null
    )
    .map(entry => ({
      index: entry.index,
      key: entry.match[1] as string,
      value: (entry.match[2] as string).trim(),
    }));
}

/**
 * Strip surrounding single or double quotes from a scalar value.
 * @param value - Raw scalar text
 * @returns The value without wrapping quotes
 */
function unquote(value: string): string {
  return value.replace(/^['"]|['"]$/gu, "");
}

/**
 * Input keys the dedicated workflow does not declare.
 *
 * `skip_jobs` CONTENTS are deliberately never consulted. That list was seeded by
 * Lisa, grew every time the shared workflow gained a job, and no consumer could
 * keep it current — a stale list and a hand-tuned one are the same bytes, so it
 * cannot be evidence of host intent. What the host demonstrably chose is the set
 * of INPUTS the caller passes, and that is what decides whether the repoint is
 * safe: an undeclared input is refused at dispatch, so repointing over one would
 * trade a wrong-but-running nightly for a dead one.
 * @param entries - Input keys the caller passes
 * @returns Undeclared keys, with the retired input excluded
 */
function findUndeclared(entries: readonly WithEntry[]): readonly string[] {
  return entries
    .filter(
      entry => entry.key !== RETIRED_INPUT && !DECLARED_INPUTS.has(entry.key)
    )
    .map(entry => entry.key);
}

/**
 * Locate every Lisa reusable-workflow caller line in the file.
 * @param lines - The caller file split into lines
 * @returns Line index and capture groups for each caller found
 */
function findCallers(
  lines: readonly string[]
): readonly { index: number; match: RegExpExecArray }[] {
  return lines
    .map((line, index) => ({ index, match: LISA_CALLER.exec(line) }))
    .filter(
      (entry): entry is { index: number; match: RegExpExecArray } =>
        entry.match !== null
    );
}

/**
 * Classify a caller already known to target the shared quality workflow.
 * @param lines - The caller file split into lines
 * @param caller - The caller line and its captures
 * @param caller.index - Line index of the `uses:` line
 * @param caller.match - Regex captures from the `uses:` line
 * @returns The classification and everything a rewrite needs
 */
function classifyStaleCaller(
  lines: readonly string[],
  caller: { index: number; match: RegExpExecArray }
): Plan {
  const withAt = lines.findIndex(line => WITH_HEADER.test(line));
  if (withAt < 0) {
    return {
      ...EMPTY,
      lines,
      verdict: "diverged",
      reason:
        "its caller job has no `with:` block, so it is not a shape Lisa seeded",
    };
  }

  const entries = readWithEntries(lines, withAt);
  const retired = entries.find(entry => entry.key === RETIRED_INPUT);
  // An empty value means a block scalar (`|` / `>`), whose extent this
  // line-based rewrite will not try to delete safely.
  if (retired && retired.value === "") {
    return {
      ...EMPTY,
      lines,
      verdict: "diverged",
      reason: `its \`${RETIRED_INPUT}\` value is a multi-line block, which this retrofit will not rewrite`,
    };
  }

  const undeclared = findUndeclared(entries);
  const shared = {
    lines,
    usesAt: caller.index,
    ref: caller.match[2] as string,
    withAt,
    retiredAt: retired?.index ?? -1,
    moment: unquote(entries.find(entry => entry.key === "moment")?.value ?? ""),
  };
  return undeclared.length > 0
    ? {
        ...shared,
        verdict: "diverged",
        reason: `it passes ${undeclared.join(", ")}, which the dedicated workflow does not declare`,
      }
    : { ...shared, verdict: "stale", reason: "" };
}

/**
 * Read and classify a project's seeded Playwright caller.
 * @param projectDir - Destination project directory
 * @returns The classification and everything a rewrite needs
 */
async function buildPlan(projectDir: string): Promise<Plan> {
  const file = path.join(projectDir, CALLER_FILE);
  if (!(await fse.pathExists(file))) return EMPTY;
  const lines = (await readFile(file, "utf8")).split("\n");

  const callers = findCallers(lines);
  if (callers.length === 0) return { ...EMPTY, lines };
  if (callers.length > 1) {
    return {
      ...EMPTY,
      lines,
      verdict: "diverged",
      reason: `it calls ${callers.length} Lisa reusable workflows, and this retrofit only understands a file with one`,
    };
  }

  const caller = callers[0] as { index: number; match: RegExpExecArray };
  const workflow = caller.match[1] as string;
  if (workflow === DEDICATED_WORKFLOW) {
    return { ...EMPTY, lines, verdict: "current" };
  }
  if (workflow !== STALE_WORKFLOW) return { ...EMPTY, lines };
  return classifyStaleCaller(lines, caller);
}

/**
 * Derive the environment name to prepare from the caller's declared moment.
 * @param moment - The caller's `moment:` input (e.g. `continuous:development`)
 * @returns The environment segment, defaulting to `development`
 */
function environmentFor(moment: string): string {
  const environment = moment.split(":")[1]?.trim() ?? "";
  return environment === "" ? "development" : environment;
}

/**
 * First line of the contiguous comment block immediately above `at`.
 *
 * The retired input's explanatory prose describes an input being deleted;
 * leaving it behind documents a key the file no longer passes.
 * @param lines - The caller file split into lines
 * @param at - Index of the key line whose comments to find
 * @returns The first line index to delete
 */
function commentStart(lines: readonly string[], at: number): number {
  return lines
    .slice(0, at)
    .reduce((acc, line, i) => (WITH_COMMENT.test(line) ? acc : i + 1), 0);
}

/** The comment written above an inserted `prepare_environment` input. */
const PREPARE_NOTE: readonly string[] = [
  "      # Return the environment to a known state BEFORE the suite. Cleanup-",
  "      # after is best-effort: it does not run when a runner dies, is",
  "      # cancelled, or is evicted, so the next run starts against whatever",
  "      # the last failure left behind.",
];

/**
 * Migration: repoint a project's seeded Playwright caller at the dedicated
 * reusable workflow.
 *
 * `expo/create-only/.github/workflows/playwright-e2e.yml` is create-only, so
 * `src/core/lisa.ts` skips it whenever the destination exists. That is correct —
 * it is why a project can customise the file — but it means editing the template
 * ships the change to greenfield projects ONLY. "Fixed upstream" and "a version
 * bump will carry it" are independent claims for anything in that lane, and this
 * file was edited upstream with no path for the projects already holding a copy.
 *
 * The stale copy calls the shared quality workflow and suppresses the two dozen
 * jobs it does not want by NAME. That inversion goes stale silently: a job added
 * to the shared workflow is absent from every hand-maintained list, so it RUNS on
 * a nightly whose whole point is that it runs one suite.
 *
 * Unlike most `ensure-*` migrations this one REWRITES a file the host owns, so it
 * rewrites only a shape it recognises:
 *
 * - Exactly one Lisa caller in the file, and it targets the shared quality
 *   workflow.
 * - Every input it passes, the retired `skip_jobs` aside, is one the dedicated
 *   workflow declares.
 *
 * Anything else is reported and left exactly as written. A silent fork is the
 * harm to avoid, and so is a silent no-op that leaves an operator believing the
 * retrofit happened — so both outcomes are logged.
 */
export class EnsurePlaywrightDedicatedCallerMigration implements Migration {
  readonly name = "ensure-playwright-dedicated-caller";
  readonly description =
    "Repoint a seeded Playwright caller from the shared quality workflow at the dedicated one";

  /**
   * Applies when the caller is stale, or diverged and worth reporting.
   * @param ctx - Migration context
   * @returns True when there is something to do or something to say
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    const plan = await buildPlan(ctx.projectDir);
    return plan.verdict === "stale" || plan.verdict === "diverged";
  }

  /**
   * Rewrite a stale caller, or report a diverged one without touching it.
   * @param ctx - Migration context
   * @returns Result describing the action taken
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const plan = await buildPlan(ctx.projectDir);
    if (plan.verdict === "diverged") return this.report(ctx, plan);
    if (plan.verdict !== "stale") return { name: this.name, action: "noop" };

    const message = this.describe(plan);

    if (ctx.dryRun) {
      ctx.logger.dry(`Would update ${CALLER_FILE}: ${message}`);
      return {
        name: this.name,
        action: "applied",
        changedFiles: [CALLER_FILE],
        message,
      };
    }

    await writeFile(
      path.join(ctx.projectDir, CALLER_FILE),
      this.rewrite(plan).join("\n")
    );
    ctx.logger.success(message);
    return {
      name: this.name,
      action: "applied",
      changedFiles: [CALLER_FILE],
      message,
    };
  }

  /**
   * Report a caller this migration declines to rewrite.
   * @param ctx - Migration context
   * @param plan - The classification that produced the decision
   * @returns A skipped result carrying the operator-readable reason
   */
  private report(ctx: MigrationContext, plan: Plan): MigrationResult {
    const message = `Left ${CALLER_FILE} alone: ${plan.reason}. It still calls the shared quality workflow, so its nightly runs jobs this suite does not need. Repoint it by hand, or delete it and re-run to be seeded a current one.`;
    ctx.logger.warn(message);
    return { name: this.name, action: "skipped", message };
  }

  /**
   * Produce the rewritten caller lines.
   * @param plan - The classification of the current file
   * @returns The new file contents, line by line
   */
  private rewrite(plan: Plan): readonly string[] {
    const usesLine = (plan.lines[plan.usesAt] as string).replace(
      `${STALE_WORKFLOW}.yml@${plan.ref}`,
      `${DEDICATED_WORKFLOW}.yml@${plan.ref}`
    );
    const repointed = plan.lines.map((line, i) =>
      i === plan.usesAt ? usesLine : line
    );

    // Inserted at the TOP of the `with:` block: a key appended at the bottom
    // could land inside a trailing block scalar such as
    // `playwright_setup_command: |`, where it would be swallowed as script text.
    const withPrepare = [
      ...repointed.slice(0, plan.withAt + 1),
      ...PREPARE_NOTE,
      `      prepare_environment: '${environmentFor(plan.moment)}'`,
      "      prepare_verbs: 'reset,reseed'",
      ...repointed.slice(plan.withAt + 1),
    ];

    if (plan.retiredAt < 0) return withPrepare;
    const retiredAt = plan.retiredAt + (withPrepare.length - repointed.length);
    return [
      ...withPrepare.slice(0, commentStart(withPrepare, retiredAt)),
      ...withPrepare.slice(retiredAt + 1),
    ];
  }

  /**
   * Summarize the rewrite for the operator standing outside the factory.
   * @param plan - The classification of the current file
   * @returns A one-line summary a non-technical reader can act on
   */
  private describe(plan: Plan): string {
    const parts = [
      `pointed it at the dedicated Playwright workflow (${DEDICATED_WORKFLOW}.yml@${plan.ref})`,
      plan.retiredAt < 0 ? null : `dropped the retired ${RETIRED_INPUT} list`,
      "required the complete environment lifecycle (reset, reseed)",
    ].filter((part): part is string => part !== null);
    return `Retrofitted ${CALLER_FILE}: ${parts.join("; ")}`;
  }
}

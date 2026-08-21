/**
 * What, in this project, would actually run a gate's task.
 *
 * Three kinds, and the difference between them is the report's central
 * question. A `gate-runner` site reads the declaration — the hook shells
 * `lisa-run-gates.mjs --moment=<moment>`, so changing the settings file changes
 * what runs. A `hook-builtin` site does not: the shipped hooks carry a
 * fallback step for a named gate, guarded by `lisa_gate_covers <gate>`, which
 * stands down only when the declaration covered it and runs unconditionally
 * otherwise. A `hook-literal` site is the same story without the marker — the
 * command is simply written into the script.
 *
 * The last two are bucket B, the one an operator most needs and can least
 * discover: the check IS running, so the repository looks healthy, and the
 * configuration surface is a decoration.
 *
 * Everything here is read from files the project holds, so both answers are
 * verified rather than inferred — including the negative. "No hook runs this"
 * is a fact about `.husky/`, not a guess about CI.
 * @module cli/gate-report-executors
 */
import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";

import type { ExecutorEvidence } from "./gate-report-types.js";

/** A hook that mentions this is shelling Lisa's gate runner. */
const GATE_RUNNER_REFERENCE = "lisa-run-gates.mjs";

/**
 * The moments a hook hands to the gate runner.
 *
 * Scanned file-wide rather than line-wide, because the shipped hooks assign the
 * runner to a shell variable several lines above the call site, then invoke
 * `node "$GATE_RUNNER" --moment=push`. A same-line pattern matches neither
 * half, and a report that found no gate runner in a repository whose hooks run
 * one on every commit would be the exact "not present, therefore does not run"
 * error this report exists to remove.
 */
const MOMENT_FLAG = /--moment=([A-Za-z0-9:_-]{1,64})/g;

/**
 * The handover marker guarding every built-in step in a shipped hook.
 *
 * `lisa_gate_covers <gate>` is the hook asking whether the gate runner already
 * proved this property. Its presence is therefore proof of the opposite thing
 * from what it reads like: a built-in step exists here, and it runs whenever
 * the declaration does not cover it.
 */
const BUILTIN_MARKER = /lisa_gate_covers[ \t]{1,8}([a-z][a-z0-9-]{0,63})/g;

/** Package-manager prefixes a hook may invoke a task through. */
const RUNNER_PREFIX = String.raw`(?:\$RUNNER|\$\{RUNNER\}|npm run|pnpm run|yarn run|bun run|npm|yarn|bun|pnpm)`;

/**
 * The moment a git hook fires at, for hooks that name no moment themselves.
 *
 * `commit-msg` runs commitlint with no gate marker and no `--moment` flag, so
 * without this it would contribute evidence to no moment at all. The mapping is
 * git's own semantics, not a Lisa convention.
 */
const HOOK_NAME_MOMENTS: Readonly<Record<string, string>> = {
  "pre-commit": "commit",
  "commit-msg": "commit",
  "prepare-commit-msg": "commit",
  "pre-push": "push",
};

/** One project hook file, read and classified. */
export interface HookFile {
  /** Project-relative path, e.g. `.husky/pre-push`. */
  readonly file: string;
  /** Its contents, with comment lines blanked. */
  readonly body: string;
  /** The moments this hook fires at, sorted. */
  readonly moments: readonly string[];
  /** Moments it hands to the gate runner, sorted. Empty when it runs none. */
  readonly gateRunnerMoments: readonly string[];
  /** Gates it carries a `lisa_gate_covers`-guarded built-in step for. */
  readonly builtinGates: readonly string[];
}

/** Everything the project's hooks were found to do. */
export interface HookEvidence {
  /** Hook files, sorted by name, so the report is stable across machines. */
  readonly files: readonly HookFile[];
}

/** Inputs for one (gate, moment) executor lookup. */
export interface ExecutorQuery {
  /** The moment being reported. */
  readonly moment: string;
  /** The gate being reported. */
  readonly gateId: string;
  /** The task this gate resolves to, or null. */
  readonly task: string | null;
  /** Whether the settings file puts this pair into service. */
  readonly declared: boolean;
}

/**
 * Order strings without mutating the caller's collection.
 * @param values - Values to order
 * @returns A new, sorted array
 */
function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

/**
 * Drop shell comments so a commented-out step is never read as an executor.
 *
 * `.husky/pre-push` carries a worked example of a Lighthouse step inside a
 * comment block. Counting that as proof the gate runs is exactly the class of
 * error this report exists to refuse.
 * @param body - Raw file contents
 * @returns The same text with comment lines blanked
 */
function stripComments(body: string): string {
  return body
    .split("\n")
    .map(line => (/^\s{0,64}#/.test(line) ? "" : line))
    .join("\n");
}

/**
 * Every distinct capture of one global pattern, sorted.
 * @param body - Text to scan
 * @param pattern - A global regular expression with one capture group
 * @returns Sorted, de-duplicated captures
 */
function captures(body: string, pattern: RegExp): string[] {
  return sorted(
    new Set(
      [...body.matchAll(pattern)]
        .map(match => match[1])
        .filter((value): value is string => value !== undefined)
    )
  );
}

/**
 * Classify one hook file.
 * @param file - Project-relative path
 * @param raw - Raw file contents
 * @returns The classified hook
 */
export function classifyHook(file: string, raw: string): HookFile {
  const body = stripComments(raw);
  const name = file.slice(file.lastIndexOf("/") + 1);
  const gateRunnerMoments = body.includes(GATE_RUNNER_REFERENCE)
    ? captures(body, MOMENT_FLAG)
    : [];
  const byName = HOOK_NAME_MOMENTS[name];
  const allMoments =
    byName === undefined ? gateRunnerMoments : [...gateRunnerMoments, byName];
  return {
    file,
    body,
    moments: sorted(new Set(allMoments)),
    gateRunnerMoments,
    builtinGates: captures(body, BUILTIN_MARKER),
  };
}

/**
 * Read and classify every hook in `.husky`.
 * @param projectRoot - Project root
 * @returns Hook evidence, empty when the directory is absent
 */
export async function collectHookEvidence(
  projectRoot: string
): Promise<HookEvidence> {
  const dir = path.join(projectRoot, ".husky");
  const entries = await readdir(dir, { withFileTypes: true }).catch(
    () => undefined
  );
  if (entries === undefined) return { files: [] };
  const names = sorted(
    entries
      .filter(entry => entry.isFile() && !entry.name.startsWith("."))
      .map(entry => entry.name)
  );
  const read = await Promise.all(
    names.map(async name => {
      const raw = await readFile(path.join(dir, name), "utf8").catch(
        () => undefined
      );
      return raw === undefined ? null : classifyHook(`.husky/${name}`, raw);
    })
  );
  return { files: read.filter((hook): hook is HookFile => hook !== null) };
}

/**
 * Whether a hook body invokes one task literally, outside the gate runner.
 *
 * Bounded on both sides on purpose. `test:cov` must not match `test:cov:unit`:
 * they are different scripts, and reporting the wrong one as proof would
 * manufacture exactly the green this report exists to withhold.
 * @param body - Comment-stripped hook body
 * @param task - The task to look for
 * @returns True when the hook runs that exact task
 */
export function hookInvokesTask(body: string, task: string): boolean {
  const escaped = task.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const pattern = new RegExp(
    String.raw`(?:^|[\s;&|(])${RUNNER_PREFIX}\s+["']?${escaped}["']?(?=$|[\s"';|&)])`,
    "m"
  );
  return pattern.test(body);
}

/**
 * The evidence a hook contributes for a gate no marker of its names.
 * @param hook - The hook file
 * @param task - The task this gate resolves to, or null
 * @returns Zero or one piece of evidence
 */
function unmarkedEvidence(
  hook: HookFile,
  task: string | null
): ExecutorEvidence[] {
  if (task === null || !hookInvokesTask(hook.body, task)) return [];
  return [
    {
      kind: "hook-literal",
      file: hook.file,
      detail: `${hook.file} runs \`${task}\` as a written-in step, whatever the settings file says`,
    },
  ];
}

/**
 * The gate-runner evidence a hook contributes, when the pair is declared.
 * @param hook - The hook file
 * @param query - The pair being reported
 * @returns Zero or one piece of evidence
 */
function runnerEvidence(
  hook: HookFile,
  query: ExecutorQuery
): ExecutorEvidence[] {
  if (!query.declared || !hook.gateRunnerMoments.includes(query.moment)) {
    return [];
  }
  return [
    {
      kind: "gate-runner",
      file: hook.file,
      detail: `${hook.file} runs the gate runner at ${query.moment}, which reads this declaration`,
    },
  ];
}

/**
 * One hook's contribution to one (gate, moment) pair.
 * @param hook - The hook file
 * @param query - The pair being reported
 * @returns Evidence from this hook alone
 */
function evidenceFrom(
  hook: HookFile,
  query: ExecutorQuery
): ExecutorEvidence[] {
  const runner = runnerEvidence(hook, query);
  if (!hook.moments.includes(query.moment)) return runner;
  if (!hook.builtinGates.includes(query.gateId)) {
    return [...runner, ...unmarkedEvidence(hook, query.task)];
  }
  return [
    ...runner,
    {
      kind: "hook-builtin",
      file: hook.file,
      detail: `${hook.file} carries a built-in ${query.gateId} step that runs unless the declaration covers it`,
    },
  ];
}

/**
 * Every executor proved for one gate at one moment.
 * @param evidence - Hook evidence for the project
 * @param query - The pair being reported
 * @returns Executors, sorted by file then kind
 */
export function executorsFor(
  evidence: HookEvidence,
  query: ExecutorQuery
): ExecutorEvidence[] {
  const found = evidence.files.flatMap(hook => evidenceFrom(hook, query));
  return [...found].sort(
    (left, right) =>
      left.file.localeCompare(right.file) || left.kind.localeCompare(right.kind)
  );
}

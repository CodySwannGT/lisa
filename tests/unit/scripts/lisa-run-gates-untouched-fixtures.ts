/**
 * Fixtures for the gate runner leaving out a part a change does not touch
 * (CodySwannGT/lisa#4988).
 *
 * The runner is told what the change touches through one injected function,
 * exactly as it is told how to start a command, so these cases state the
 * change instead of staging one in a repository.
 * @module tests/unit/scripts/lisa-run-gates-untouched-fixtures
 */
import { runGates } from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import { COMMIT, RUNNER, sink } from "./lisa-run-gates-fixtures.js";
import {
  type ArgvContext,
  type ArgvExecutor,
  type PartOutcome,
  type PartsGateRun,
} from "./lisa-run-gates-parts-fixtures.js";

/** What the runner is told about the change it was started for. */
export interface StatedChange {
  /** Repository-relative paths; `null` when the change is not known. */
  readonly paths: unknown;
  /** What to tell the operator; `null` to say nothing. */
  readonly note: string | null;
}

/** A part's row, with the mark a part the change does not touch carries. */
export type UntouchedOutcome = PartOutcome & { readonly untouched?: boolean };

/** What `runGates` takes. */
type RunOptions = Parameters<typeof runGates>[0];

/** The pass cache the runner takes, as `runGates` declares it. */
export type PassCache = RunOptions["cache"];

/**
 * What the runner believes its `change` function answers.
 *
 * A stated change is cast to this on purpose: some cases hand the runner an
 * answer that is not one, to hold that it reads the answer rather than trusts
 * the type.
 */
type DeclaredChange = ReturnType<NonNullable<RunOptions["change"]>>;

/** One run, what it printed, and what it started. */
export interface UntouchedRun {
  readonly result: PartsGateRun & { readonly results: UntouchedOutcome[] };
  /** The operator-facing lines, in order. */
  readonly lines: string[];
  /** The lines joined, for a search across the whole report. */
  readonly transcript: string;
  /** The folder of every part whose command was started, in order. */
  readonly started: string[];
  /** How many times the runner asked what the change touches. */
  readonly asked: number;
}

/**
 * A change that touches the given paths.
 * @param paths - Repository-relative paths
 * @returns The change, with a line for the operator
 */
export function touching(paths: readonly string[]): StatedChange {
  return { note: `This commit changes ${paths.length} path(s).`, paths };
}

/** A change nobody could work out. */
export const NOT_KNOWN: StatedChange = {
  note: "Every part runs at commit: nothing is staged.",
  paths: null,
};

/**
 * Run a gates block with a stated change.
 * @param options - Run inputs
 * @param options.gates - The gates block
 * @param options.root - The repository root
 * @param options.change - What the change touches, or a function that says
 *   so; omitted to leave the runner's own default in place
 * @param options.moment - The moment to run; commit by default
 * @param options.execArgv - The part executor; every part passes by default
 * @param options.cache - A pass cache to hand the runner
 * @returns The run, what it printed and what it started
 */
export function runWithChange(options: {
  readonly gates: Record<string, unknown>;
  readonly root: string;
  readonly change?: StatedChange | (() => StatedChange);
  readonly moment?: string;
  readonly execArgv?: ArgvExecutor;
  readonly cache?: PassCache;
}): UntouchedRun {
  const { lines, out } = sink();
  const started: string[] = [];
  const counter = { asked: 0 };
  const stated = options.change;
  const result = runGates({
    cache: options.cache ?? null,
    ...(stated === undefined
      ? {}
      : {
          change: (): DeclaredChange => {
            counter.asked += 1;
            const answer = typeof stated === "function" ? stated() : stated;
            return answer as DeclaredChange;
          },
        }),
    exec: () => 0,
    execArgv: (argv: readonly string[], context: ArgvContext) => {
      started.push(context.gate.scope ?? "");
      return options.execArgv?.(argv, context) ?? 0;
    },
    gates: options.gates,
    moment: options.moment ?? COMMIT,
    out,
    priorKills: [],
    recordKill: () => true,
    root: options.root,
    runner: RUNNER,
  }) as UntouchedRun["result"];
  return {
    asked: counter.asked,
    lines,
    result,
    started,
    transcript: lines.join("\n"),
  };
}

/**
 * The row for one part, by the folder it covers.
 * @param run - A run
 * @param scope - The folder
 * @returns The part's row
 */
export function rowFor(run: UntouchedRun, scope: string): UntouchedOutcome {
  const row = run.result.results.find(entry => entry.scope === scope);
  if (row === undefined) throw new Error(`no part is reported for ${scope}`);
  return row;
}

/**
 * The line the runner printed for one part.
 * @param run - A run
 * @param name - The part as the runner names it, e.g. `x-lint in web`
 * @returns The first line carrying that name
 */
export function lineFor(run: UntouchedRun, name: string): string {
  const line = run.lines.find(candidate => candidate.includes(`${name} `));
  if (line === undefined) throw new Error(`no line names ${name}`);
  return line;
}

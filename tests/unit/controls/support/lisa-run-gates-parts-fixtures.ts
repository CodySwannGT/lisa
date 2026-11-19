/**
 * Fixtures shared by the test files for a gate's parts in the gate runner.
 *
 * A part is checked by an argument list started in the part's own folder, so
 * every case here needs a repository on disk with folders in it. The executor
 * is still injected wherever a case is about the verdict rather than about
 * starting a process.
 * @module tests/unit/controls/support/lisa-run-gates-parts-fixtures
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runGates } from "../../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import {
  COMMIT,
  type GateOutcome,
  type GateRun,
  RUNNER,
  sink,
} from "../../scripts/lisa-run-gates-fixtures.js";

/** A gate this project invented, checked by a different command per folder. */
export const LINT = "x-lint";

/** The two folders most cases use. */
export const API = "api";
export const WEB = "web";

/** Argument lists that are never started: the executor is a stub. */
export const API_ARGV = ["go", "vet", "./..."];
export const WEB_ARGV = ["npm", "run", "lint"];

/** One part of a gate, as a project declares it. */
export interface DeclaredPart {
  readonly scope: string;
  readonly command: readonly string[];
  readonly proof?: { readonly failure_shape?: readonly string[] };
}

/** What a part's executor answers with. */
export type ArgvAnswer =
  | number
  | null
  | {
      readonly code: number | null;
      readonly output: string | null;
      readonly signal?: string;
      readonly notStarted?: string;
    };

/** What the runner hands a part's executor beside the argument list. */
export interface ArgvContext {
  readonly cwd: string;
  readonly gate: { readonly id: string; readonly scope?: string };
}

/** A part's executor, as `runGates` accepts it. */
export type ArgvExecutor = (
  argv: readonly string[],
  context: ArgvContext
) => ArgvAnswer;

/** One part's row in a run, with the two keys only a part carries. */
export type PartOutcome = GateOutcome & {
  readonly scope?: string;
  readonly argv?: string[] | null;
};

/** A whole run, with every row typed as a part's row. */
export type PartsGateRun = {
  readonly [Key in keyof GateRun]: GateRun[Key] extends GateOutcome[]
    ? PartOutcome[]
    : GateRun[Key];
};

/** A repository on disk, removed by `cleanup`. */
export interface PartsRepository {
  /** The repository root, with every link in its own path resolved. */
  readonly root: string;
  /** Remove the repository. */
  readonly cleanup: () => void;
}

/**
 * Build a throwaway repository holding the given folders.
 * @param folders - Folders to create, written from the repository root
 * @returns The repository and how to remove it
 */
export function partsRepository(
  folders: readonly string[] = [API, WEB]
): PartsRepository {
  // Resolved once here, because the system's temporary folder is itself a
  // link on some machines and every assertion below compares real folders.
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "lisa-parts-")));
  for (const folder of folders) {
    mkdirSync(path.join(root, folder), { recursive: true });
  }
  return {
    root,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
  };
}

/**
 * A gates block declaring one gate with parts at commit.
 * @param parts - The gate's parts
 * @param level - The gate's level at commit
 * @param id - The gate id
 * @returns The gates block
 */
export function partGates(
  parts: readonly DeclaredPart[],
  level = "required",
  id = LINT
): Record<string, unknown> {
  return { [id]: { [COMMIT]: level, parts } };
}

/** What one run of a gates block with parts produced. */
export interface PartsRun {
  readonly result: PartsGateRun;
  /** The operator-facing lines, in order. */
  readonly lines: string[];
  /** The lines joined, for a search across the whole report. */
  readonly transcript: string;
}

/**
 * Run a gates block at commit with an injected part executor.
 * @param options - Run inputs
 * @param options.gates - The gates block
 * @param options.root - The repository root
 * @param options.execArgv - The part executor
 * @param options.exec - The executor for a gate with no parts
 * @param options.touching - The paths the change touches; left out, the
 *   change is not known and every part runs
 * @returns The run and what it printed
 */
export function runParts(options: {
  readonly gates: Record<string, unknown>;
  readonly root: string;
  readonly execArgv: ArgvExecutor;
  readonly exec?: (command: string) => number | null;
  readonly touching?: readonly string[];
}): PartsRun {
  const { lines, out } = sink();
  const { touching } = options;
  const result = runGates({
    ...(touching === undefined
      ? {}
      : { change: () => ({ note: null, paths: [...touching] }) }),
    exec: options.exec ?? (() => 0),
    execArgv: options.execArgv,
    gates: options.gates,
    moment: COMMIT,
    out,
    priorKills: [],
    recordKill: () => true,
    root: options.root,
    runner: RUNNER,
  }) as PartsRun["result"];
  return { lines, result, transcript: lines.join("\n") };
}

/**
 * The row for one part, by the folder it covers.
 * @param run - A run
 * @param scope - The folder
 * @returns The part's row
 */
export function partRow(run: PartsRun, scope: string): PartOutcome {
  const row = run.result.results.find(entry => entry.scope === scope);
  if (row === undefined) throw new Error(`no part ran for ${scope}`);
  return row;
}

/**
 * The line the runner printed for one part.
 * @param run - A run
 * @param name - The part's name as the runner prints it, e.g. `x-lint in api`
 * @returns The first line carrying that name
 */
export function partLine(run: PartsRun, name: string): string {
  const line = run.lines.find(candidate => candidate.includes(`${name} `));
  if (line === undefined) throw new Error(`no line names ${name}`);
  return line;
}

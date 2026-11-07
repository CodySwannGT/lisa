// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** What one cleanup sweep did. */
export interface SweepResult {
  readonly removed: string[];
  readonly killed: number[];
  readonly errors: string[];
  readonly dryRun: boolean;
  readonly durationMs: number;
}

/** Options for {@link sweep}; every one has a default. */
export interface SweepOptions {
  readonly root?: string;
  readonly maxAgeHours?: number;
  readonly now?: number;
  readonly dryRun?: boolean;
  readonly orphans?: false | Record<string, unknown>;
}

export const LISA_OWNED_TEMP_PREFIXES: readonly string[];
export const LISA_PROTECTED_TEMP_NAMES: readonly string[];
export const LISA_PROTECTED_TEMP_PREFIXES: readonly string[];
export const SWEPT_ENV: "LISA_CLEANUP_SWEPT";
export const DEFAULT_MAX_AGE_HOURS: number;

/** Whether a top-level temp name is Lisa-owned and sweepable. */
export function isLisaOwnedTempName(name: string): boolean;

/** Remove stale Lisa temp entries from the top level of `root`. */
export function sweepTemp(options: {
  root: string;
  maxAgeHours: number;
  now: number;
  dryRun: boolean;
}): Promise<{ removed: string[]; errors: string[] }>;

/** Run the whole sweep: stale temp entries, then orphaned test processes. */
export function sweep(options?: SweepOptions): Promise<SweepResult>;

/** The one summary line a sweep prints. */
export function formatSummary(result: SweepResult): string;

/** Parse CLI flags; throws on an unknown flag or an invalid age. */
export function parseSweepArgs(argv: readonly string[]): {
  dryRun: boolean;
  json: boolean;
  maxAgeHours: number;
};

/** CLI entry point; resolves to the exit code. */
export function main(
  argv?: readonly string[],
  seams?: {
    sweepOptions?: SweepOptions;
    write?: (line: string) => void;
  }
): Promise<number>;

/** Sweep once from a synchronous caller, never failing it. */
export function runStartOfRunSweep(seams?: {
  env?: Record<string, string | undefined>;
  spawn?: (...args: never[]) => unknown;
  log?: (line: string) => void;
}): void;

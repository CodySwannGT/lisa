// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** The run that owns a test process. */
export interface RunOwner {
  readonly pid: number;
  readonly start: string;
}

/** One row of the current user's process table. */
export interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly owner: RunOwner | null;
}

export const OWNER_ENV: "LISA_TEST_RUN_OWNER";
export const UNKNOWN_START: "0";
export const DEFAULT_GRACE_MS: number;

export function formatOwnerMarker(
  pid: number,
  start: string | undefined
): string;
export function parseOwnerMarker(value: unknown): RunOwner | null;
export function parseDarwinProcessTable(stdout: string): ProcessRow[];
export function parseDarwinStartTimes(stdout: string): Map<number, string>;
export function parseLinuxStat(
  stat: string
): { ppid: number; start: string } | null;
export function listProcesses(options?: {
  platform?: string;
  procRoot?: string;
}): ProcessRow[];
export function processStartTimes(
  pids: readonly number[],
  options?: { platform?: string; procRoot?: string }
): Map<number, string>;
/** The `<pid>:<start>` marker value a test run started by `pid` exports. */
export function ownerMarkerFor(pid?: number): string;
export function isAlive(pid: number): boolean;
export function selectOrphans(
  rows: readonly ProcessRow[],
  seams: {
    selfPid: number;
    isAlive: (pid: number) => boolean;
    startTimesOf: (pids: number[]) => Map<number, string>;
  }
): number[];
/** Kill every orphaned test process: SIGTERM, a short grace, then SIGKILL. */
export function sweepOrphans(options?: {
  selfPid?: number;
  listProcesses?: () => readonly ProcessRow[];
  isAlive?: (pid: number) => boolean;
  startTimesOf?: (pids: number[]) => Map<number, string>;
  kill?: (pid: number, signal: string) => void;
  sleep?: (ms: number) => Promise<unknown>;
  graceMs?: number;
  dryRun?: boolean;
}): Promise<{ killed: number[]; errors: string[] }>;

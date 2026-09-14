import { type RunLoadClass } from "./reusable-workflow-load-failure.mjs";
export interface ScannedRun {
  readonly id: number;
  readonly path: string;
  readonly createdAt: string;
  readonly referencedCount: number;
  readonly jobCount: number;
  readonly conclusion: string | null;
}
export interface RunPage {
  readonly runs: readonly ScannedRun[];
  readonly hasMore: boolean;
}
export interface ScanRequest {
  readonly fetchPage: (page: number) => Promise<RunPage>;
  readonly windowStart: string;
  readonly inPopulation: (path: string) => boolean;
  readonly maxPages: number;
}
export interface ScanFinding {
  readonly id: number;
  readonly path: string;
  readonly verdict: RunLoadClass;
}
export interface ScanResult {
  readonly loadFailures: readonly ScanFinding[];
  readonly inspected: number;
  readonly covered: boolean;
  readonly reason: string;
}
export declare function scanForLoadFailures(
  request: ScanRequest
): Promise<ScanResult>;

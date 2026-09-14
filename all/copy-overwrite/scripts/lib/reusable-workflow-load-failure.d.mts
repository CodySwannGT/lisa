// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

export type RunLoadClass =
  | "load-failure"
  | "dead-runner"
  | "resolved"
  | "out-of-population"
  | "skipped"
  | "inconclusive"
  | "in-flight";
export interface RunLoadFacts {
  readonly inPopulation: boolean;
  readonly referencedCount: number;
  readonly jobCount: number;
  readonly conclusion: string | null;
}
export declare function callerDeclaresReusableWorkflow(source: string): boolean;
export declare function classifyRunLoad(facts: RunLoadFacts): RunLoadClass;
export interface WindowScan {
  readonly oldestSeen: string | null;
  readonly windowStart: string;
  readonly exhausted: boolean;
}
export interface WindowVerdict {
  readonly covered: boolean;
  readonly reason: string;
}
export declare function windowCoverage(scan: WindowScan): WindowVerdict;

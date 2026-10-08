import type { CommandEvidence } from "./maestro-command-evidence.js";

/** Shape of a single step inside a workflow job's `steps:` list. */
export interface WorkflowStep {
  id?: string;
  name?: string;
  run?: string;
  uses?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
}

/** Root shape of the parsed reusable workflow. */
export interface ReusableWorkflow {
  on: {
    workflow_call?: {
      inputs?: Record<string, { default?: unknown; type?: string }>;
    };
  };
  jobs: Record<string, { steps?: WorkflowStep[] }>;
}

/** Outcome of executing the suite driver against a fixture. */
export interface StepResult {
  status: number;
  attempts: number;
  output: string;
  ledger: string | null;
  summary: string;
  debugRoots: string[];
}

/** Outcome of executing the retry-budget gate against a ledger. */
export interface GateResult {
  status: number;
  output: string;
  summary: string;
  outputs: string;
}

/** How the stubbed runner behaves once the suite has failed. */
export type RetryMode =
  | "retry-passes"
  | "retry-fails"
  | "retry-executes-nothing"
  | "retry-no-device"
  | "retry-no-report"
  | "retry-no-device-conflict"
  | "retry-launcher-missing"
  | "retry-foreign-success"
  | "retry-foreign-name-success"
  | "retry-kills-driver";

/** Knobs for one suite-driver execution. */
export interface RunOptions {
  commandEvidence?: CommandEvidence;
  debugLayout?: "legacy" | "modern";
  wrongTarget?: boolean;
  staleSuiteEvidence?: boolean;
  evidenceOnlyFirstRetry?: boolean;
  interruptNextRetry?: boolean;
  recoverNextRetry?: boolean;
  flowName?: string;
  rawHeaderName?: string;
  nestedEnvName?: string;
  nameOnlyReport?: boolean;
  flowNameCollision?: boolean;
  shardDirectory?: boolean;
  report?: string;
  platform?: "android" | "ios";
  deadlineSeconds?: number | null;
  missingDuration?: boolean;
  clockAdvanceSeconds?: number;
  mode?: RetryMode;
  /** Flow basenames the fixture report marks as failed. */
  failing?: readonly string[];
  /** Flow basenames whose file carries the retry tag. */
  tagged?: readonly string[];
  /** Value of the `android_flow_retry_tag` input. */
  tag?: string;
  attempts?: string;
  ratePercent?: string;
  /** Emit the failing test cases last rather than first. */
  reverseOrder?: boolean;
  /** Emit every failing test case twice. */
  repeatFailing?: boolean;
  /** Make the first suite attempt succeed. */
  suitePasses?: boolean;
}

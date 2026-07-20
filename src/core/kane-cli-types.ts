/** Stable Lisa types for the optional TestMu Kane CLI boundary. */

/** Stable Lisa outcome classes exposed to factory workflows. */
export type KaneOutcome =
  | "passed"
  | "product_failed"
  | "tool_failed"
  | "timed_out";

/** Mutation levels shared with Lisa's product-use policy. */
export type KaneMutationLevel = "forbidden" | "read-only" | "full";

/** One provider-neutral Kane run request. */
export interface KaneRunRequest {
  readonly projectRoot: string;
  readonly environment: string;
  readonly mutation: KaneMutationLevel;
  readonly objective: string;
  readonly url?: string;
  readonly maxSteps?: number;
}

/** Minimal validated terminal record from Kane agent mode. */
export interface KaneTerminalEvent {
  readonly type: "run_end";
  readonly status: "passed" | "failed";
  readonly summary?: string;
  readonly one_liner?: string;
  readonly reason?: string;
  readonly duration?: number;
  readonly credits?: number;
  readonly result_code?: number;
  readonly final_state?: Readonly<Record<string, unknown>>;
  readonly session_dir?: string;
  readonly run_dir?: string;
  readonly test_url?: string;
  readonly evidence_pack?: string;
}

/** Stable result returned to Lisa factory workflows. */
export interface KaneRunResult {
  readonly outcome: KaneOutcome;
  readonly exitCode: number;
  readonly terminal?: KaneTerminalEvent;
  readonly progressCount: number;
  readonly parseWarnings: readonly string[];
  readonly confirmedProductBug: boolean;
  readonly evidencePack?: string;
  readonly stderr: string;
}

/** Captured child-process result. */
export interface KaneCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Injectable process runner used by adapter and doctor tests. */
export type KaneCommandRunner = (
  executable: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly timeoutMs: number;
    readonly env: NodeJS.ProcessEnv;
  }
) => Promise<KaneCommandResult>;

/** Readiness result used by `lisa doctor`. */
export interface KaneReadiness {
  readonly status: "disabled" | "ready" | "warn" | "fail";
  readonly detail: string;
}

/** Injectable local-browser availability probe used by doctor tests. */
export type ChromeAvailabilityProbe = () => boolean;

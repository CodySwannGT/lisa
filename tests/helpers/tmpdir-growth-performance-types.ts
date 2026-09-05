/** Typed evidence records emitted by the real Darwin measurement harness. */

/** One deterministic prefix-count row from a measurement report. */
export interface TmpdirPrefixCount {
  readonly prefix: string;
  readonly count: number;
}

/** Namespace ownership counters carried by every report. */
export interface TmpdirOwnershipReport {
  readonly total: number;
  readonly owned: number;
  readonly live: number;
  readonly unowned: number;
  readonly created: number;
  readonly removed: number;
  readonly unreclaimed: number;
  readonly newlyUnowned: number;
}

/** Complete public command report fields required by the performance proof. */
export interface TmpdirGrowthReportRecord {
  readonly total: number;
  readonly delta: number | null;
  readonly created: number;
  readonly removed: number;
  readonly unreclaimed: number;
  readonly elapsedMs: number | null;
  readonly rateEntriesPerDay: number | null;
  readonly topPrefixes: readonly TmpdirPrefixCount[];
  readonly namespace: TmpdirOwnershipReport;
  readonly violations: readonly string[];
}

/** Exact real root identity assigned to one measured trial. */
export interface TmpdirGrowthRootIdentity {
  readonly rootIndex: number;
  readonly canonicalPath: string;
  readonly dev: number;
  readonly ino: number;
}

/** Rolling artifact facts retained without embedding 100k entry names. */
export interface TmpdirGrowthArtifactRecord {
  readonly path: string;
  readonly snapshotCount: number;
  readonly latestEntryCount: number;
  readonly report: TmpdirGrowthReportRecord;
}

/** One measured command trial with report, artifact, and transport evidence. */
export interface TmpdirGrowthTrial {
  readonly root: TmpdirGrowthRootIdentity;
  readonly trial: number;
  readonly commandElapsedMs: number;
  readonly budgetMs: number;
  readonly count: number;
  readonly created: number;
  readonly removed: number;
  readonly unreclaimed: number;
  readonly reportElapsedMs: number | null;
  readonly rateEntriesPerDay: number | null;
  readonly topPrefixes: readonly TmpdirPrefixCount[];
  readonly ownership: TmpdirOwnershipReport;
  readonly violations: readonly string[];
  readonly artifact: TmpdirGrowthArtifactRecord;
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Host, calibration, schedule, and real command measurements. */
export interface TmpdirGrowthPerformanceTrace {
  readonly schema: "lisa-tmpdir-growth-performance-v1";
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly cpuCount: number;
  readonly totalMemoryBytes: number;
  readonly loadAverageBefore: readonly number[];
  readonly loadAverageAfter: readonly number[];
  readonly hostname: string;
  readonly release: string;
  readonly cpuModel: string;
  readonly entryCount: number;
  readonly budgetMs: number;
  readonly calibrationMs: readonly number[];
  readonly fixtureCreationExcluded: true;
  readonly timeoutBehavior: "not-established";
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly warmup: TmpdirGrowthTrial;
  readonly measuredRootSchedule: readonly number[];
  readonly trials: readonly TmpdirGrowthTrial[];
}

/** Exact production batching facts captured through the real-ps forwarder. */
export interface DarwinBirthBatchingTrace {
  readonly inputCount: number;
  readonly observedCount: number;
  readonly batchSizes: readonly number[];
  readonly liveOwnerBirth: string;
}

/** Real over-cap refusal and rolling-artifact preservation facts. */
export interface TmpdirGrowthOverCapTrace {
  readonly entryCount: number;
  readonly budgetMs: number;
  readonly commandElapsedMs: number;
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly validArtifactBytesPreserved: boolean;
  readonly timeoutBehavior: "not-established";
}

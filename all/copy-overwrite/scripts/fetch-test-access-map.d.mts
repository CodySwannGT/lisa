// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

export interface MapArtifact {
  readonly name: string;
  readonly baseSha: string;
  readonly runId: string;
  readonly createdAt: string;
}
export interface FetchDeps {
  readonly run: (command: string, args: readonly string[]) => string;
  readonly now: () => Date;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}
export declare function parseArgs(argv: readonly string[]): {
  readonly base: string | undefined;
  readonly repo: string | undefined;
  readonly out: string;
};
export declare function parseArtifacts(output: string): readonly MapArtifact[];
export interface RunChoice {
  readonly runId: string;
  readonly baseSha: string;
  readonly distance: number;
  readonly artifacts: readonly MapArtifact[];
}
export declare function rankRuns(
  artifacts: readonly MapArtifact[],
  sha: string,
  run: FetchDeps["run"]
): readonly RunChoice[];
export declare function selectRun(
  artifacts: readonly MapArtifact[],
  sha: string,
  run: FetchDeps["run"]
): RunChoice | undefined;
export declare function runRefusal(
  info:
    | {
        readonly conclusion?: unknown;
        readonly headSha?: unknown;
        readonly headRepository?: unknown;
      }
    | null
    | undefined,
  repo: string
): string | undefined;
export declare function piecesRefusal(
  metas: readonly Readonly<Record<string, unknown>>[],
  run: {
    readonly runId: string;
    readonly baseSha: string;
    readonly headSha: string;
  }
): string | undefined;
export declare function mergeMaps(
  documents: readonly {
    readonly meta?: Readonly<Record<string, unknown>>;
    readonly map?: Readonly<Record<string, readonly string[]>>;
  }[]
): {
  readonly map: Readonly<Record<string, readonly string[]>>;
  readonly metas: readonly Readonly<Record<string, unknown>>[];
};
export declare function mergedTriggers(
  metas: readonly Readonly<Record<string, unknown>>[]
): readonly string[];
export declare function repositoryFromRemote(url: string): string | undefined;
export declare function formatAge(milliseconds: number): string;
export declare function main(argv: readonly string[], deps: FetchDeps): number;

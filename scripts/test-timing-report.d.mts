export interface FileTiming {
  readonly file: string;
  readonly seconds: number;
  readonly tests: number;
}
export interface ScopeSummary {
  readonly files: number;
  readonly tests: number;
  readonly seconds: number;
  readonly top: readonly {
    readonly file: string;
    readonly seconds: number;
    readonly share: number;
  }[];
  readonly concentration: Readonly<Record<string, number>>;
  readonly all: readonly FileTiming[];
}
export interface ReportIo {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
  readonly download?: (runId: string, into: string) => void;
}
export declare function collectTimings(directory: string): Readonly<
  Record<string, readonly FileTiming[]>
> & {
  readonly unit: readonly FileTiming[];
  readonly integration: readonly FileTiming[];
};
export declare function summarize(
  files: readonly FileTiming[],
  top: number
): ScopeSummary;
export declare function formatReport(
  summaries: Readonly<Record<string, ScopeSummary>>
): string;
export declare function parseArgs(
  argv: readonly string[]
):
  | { dir?: string; run?: string; top: number; json: boolean }
  | { error: string };
export declare function main(argv: readonly string[], io: ReportIo): number;

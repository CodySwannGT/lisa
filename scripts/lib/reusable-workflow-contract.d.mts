export interface ReusableCallerJob {
  readonly reusableFile: string;
  readonly ref: string;
  readonly owner: string | null;
  readonly repo: string | null;
  readonly withKeys: readonly string[];
}

export function parseReusableReference(usesValue: string): {
  readonly file: string;
  readonly ref: string;
  readonly owner: string | null;
  readonly repo: string | null;
} | null;
export function extractCallerJobs(
  content: string
): readonly ReusableCallerJob[];
export interface UnparsedLisaCallerLine {
  /** 1-based line number within the file. */
  readonly line: number;
  /** The line's text, trimmed. */
  readonly text: string;
}

export function findUnparsedLisaCallerLines(
  content: string
): readonly UnparsedLisaCallerLine[];
export function extractDeclaredInputs(
  content: string
): readonly string[] | null;
export function diffStaleKeys(
  used: readonly string[],
  declared: readonly string[]
): readonly string[];

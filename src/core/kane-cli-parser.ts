/** Fail-closed parser for Kane's agent-mode JSONL stream. */
import type {
  KaneCommandResult,
  KaneOutcome,
  KaneRunResult,
  KaneTerminalEvent,
} from "./kane-cli-types.js";

/** Safely parsed markers from one progress-stream line. */
interface ParsedLine {
  readonly terminal?: KaneTerminalEvent;
  readonly progress: boolean;
  readonly warning?: string;
}

/**
 * Return a property object only when its value is defined.
 * @param key - Output property name
 * @param value - Optional property value
 * @returns Empty or single-property record
 */
function defined<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

/**
 * Read an optional string from an untrusted record.
 * @param record - Untrusted event record
 * @param key - Property name
 * @returns String value or undefined
 */
function optionalString(
  record: Readonly<Record<string, unknown>>,
  key: string
): string | undefined {
  return typeof record[key] === "string" ? record[key] : undefined;
}

/**
 * Read an optional finite number from an untrusted record.
 * @param record - Untrusted event record
 * @param key - Property name
 * @returns Finite number or undefined
 */
function optionalNumber(
  record: Readonly<Record<string, unknown>>,
  key: string
): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * Narrow an unknown value into Lisa's terminal subset.
 * @param value - Parsed JSONL value
 * @returns Terminal event or undefined
 */
function parseTerminalEvent(value: unknown): KaneTerminalEvent | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    record.type !== "run_end" ||
    (record.status !== "passed" && record.status !== "failed")
  ) {
    return undefined;
  }
  const finalState = record.final_state;
  const validFinalState =
    finalState !== null &&
    typeof finalState === "object" &&
    !Array.isArray(finalState)
      ? (finalState as Readonly<Record<string, unknown>>)
      : undefined;
  return {
    type: "run_end",
    status: record.status,
    ...defined("summary", optionalString(record, "summary")),
    ...defined("one_liner", optionalString(record, "one_liner")),
    ...defined("reason", optionalString(record, "reason")),
    ...defined("duration", optionalNumber(record, "duration")),
    ...defined("credits", optionalNumber(record, "credits")),
    ...defined("result_code", optionalNumber(record, "result_code")),
    ...defined("final_state", validFinalState),
    ...defined("session_dir", optionalString(record, "session_dir")),
    ...defined("run_dir", optionalString(record, "run_dir")),
    ...defined("test_url", optionalString(record, "test_url")),
    ...defined("evidence_pack", optionalString(record, "evidence_pack")),
  } as KaneTerminalEvent;
}

/**
 * Parse one JSONL line without trusting progress events.
 * @param rawLine - Raw stdout line
 * @param index - Zero-based line index
 * @returns Parsed terminal/progress/warning markers
 */
function parseLine(rawLine: string, index: number): ParsedLine {
  const line = rawLine.trim();
  if (line.length === 0) return { progress: false };
  try {
    const parsed = JSON.parse(line) as unknown;
    const record =
      parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    return {
      ...defined("terminal", parseTerminalEvent(parsed)),
      progress:
        typeof record?.step === "number" ||
        record?.type === "step_start" ||
        record?.type === "step_end",
    };
  } catch {
    return {
      progress: false,
      warning: `stdout line ${String(index + 1)} was not JSON`,
    };
  }
}

/**
 * Extract a local evidence-pack path from Kane stderr.
 * @param stderr - Captured standard error
 * @returns Evidence path or undefined
 */
function parseEvidencePackHint(stderr: string): string | undefined {
  return /(?:evidence(?:[_ -]pack)?|pack)(?: path)?[:=]\s*["']?([^\s"']+\.(?:evidence|zip))/iu.exec(
    stderr
  )?.[1];
}

/**
 * Classify process and terminal state without conflating tooling and product.
 * @param exitCode - Kane process exit code
 * @param terminal - Validated terminal event
 * @returns Stable Lisa outcome
 */
function classifyOutcome(
  exitCode: number,
  terminal: KaneTerminalEvent | undefined
): KaneOutcome {
  if (exitCode === 3) return "timed_out";
  if ((exitCode !== 0 && exitCode !== 1) || terminal === undefined) {
    return "tool_failed";
  }
  if (exitCode === 1 || terminal.status === "failed") return "product_failed";
  return "passed";
}

/**
 * Convert captured Kane output into Lisa's stable result contract.
 * @param command - Captured process result
 * @returns Normalized provider result
 */
export function parseKaneResult(command: KaneCommandResult): KaneRunResult {
  const lines = command.stdout.split(/\r?\n/u).map(parseLine);
  const terminal = lines
    .map(line => line.terminal)
    .filter((event): event is KaneTerminalEvent => event !== undefined)
    .at(-1);
  const evidencePack =
    terminal?.evidence_pack ?? parseEvidencePackHint(command.stderr);
  return {
    outcome: classifyOutcome(command.exitCode, terminal),
    exitCode: command.exitCode,
    ...defined("terminal", terminal),
    progressCount: lines.filter(line => line.progress).length,
    parseWarnings: lines
      .map(line => line.warning)
      .filter((warning): warning is string => warning !== undefined),
    confirmedProductBug: terminal?.result_code === 740,
    ...defined("evidencePack", evidencePack),
    stderr: command.stderr,
  } as KaneRunResult;
}

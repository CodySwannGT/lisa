/**
 * Surface why a packaged-apply controller run failed.
 *
 * The native driver runs inside a container and records its own assertion in
 * `/lisa-proof.json` (copied out as `native-proof.json`); the controller adds
 * `failure.json`. Neither reaches the job log on its own: the controller's
 * stderr only says `docker start --attach` failed. Without this, a broken
 * fixture pin looked like an opaque container crash (CodySwannGT/lisa#4822).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_TAIL_LINES = 40;

/**
 * Keep only the last lines of a captured stream.
 * @param {unknown} text - Captured output; non-strings render as empty.
 * @param {number} lines - Maximum trailing lines to keep.
 * @returns {string} Trailing lines, without a final newline.
 */
export function tail(text, lines = DEFAULT_TAIL_LINES) {
  if (typeof text !== "string" || text.length === 0) return "";
  const rows = text.split("\n");
  while (rows.length > 0 && rows.at(-1) === "") rows.pop();
  return rows.slice(-lines).join("\n");
}

/**
 * Render one labelled block, or nothing when there is no content.
 * @param {string} label - Heading for the block.
 * @param {unknown} text - Block content.
 * @param {number} lines - Maximum trailing lines.
 * @returns {string[]} Zero or more output lines.
 */
function block(label, text, lines) {
  const body = tail(text, lines);
  return body ? [`${label} (last ${lines} lines):`, body] : [];
}

/**
 * Render a recorded failure (native proof or controller failure.json).
 * @param {string} label - Which recorder produced it.
 * @param {{message?: string, stack?: string|null, stdout?: string|null, stderr?: string|null}|null|undefined} failure - Recorded failure.
 * @param {number} lines - Maximum trailing lines per stream.
 * @returns {string[]} Zero or more output lines.
 */
function recorded(label, failure, lines) {
  if (!failure) return [];
  return [
    `${label}: ${failure.message ?? "(no message)"}`,
    ...block(`${label} stack`, failure.stack, lines),
    ...block(`${label} stderr`, failure.stderr, lines),
    ...block(`${label} stdout`, failure.stdout, lines),
  ];
}

/**
 * Format everything known about a failed controller run into one message.
 * Pure: callers supply what they captured and read.
 * @param {object} input - Captured run facts.
 * @param {string} input.name - Scenario name.
 * @param {number|null} input.status - Controller exit status.
 * @param {string} [input.stdout] - Controller stdout.
 * @param {string} [input.stderr] - Controller stderr.
 * @param {object|null} [input.native] - Parsed native-proof.json, if any.
 * @param {object|null} [input.failureRecord] - Parsed failure.json, if any.
 * @param {number} [input.lines] - Maximum trailing lines per stream.
 * @returns {string} Multi-line diagnostic, real cause first.
 */
export function formatControllerFailure({
  name,
  status,
  stdout,
  stderr,
  native = null,
  failureRecord = null,
  lines = DEFAULT_TAIL_LINES,
}) {
  const apply = native?.apply;
  const applyFailed = apply && apply.status !== 0;
  return [
    `Packaged-apply scenario "${name}": controller exited ${status}.`,
    ...recorded("Native proof failure", native?.failure, lines),
    ...(applyFailed
      ? [
          `Native lisa apply exited ${apply.status}.`,
          ...block("Native apply stderr", apply.stderr, lines),
          ...block("Native apply stdout", apply.stdout, lines),
        ]
      : []),
    ...recorded("Controller failure.json", failureRecord, lines),
    ...block("Controller stderr", stderr, lines),
    ...block("Controller stdout", stdout, lines),
    ...(native || failureRecord
      ? []
      : ["No native-proof.json or failure.json was written."]),
  ].join("\n");
}

/**
 * Read a JSON proof file the controller may or may not have written.
 * @param {string} file - Candidate JSON file.
 * @returns {object|null} Parsed value, or null when absent or unreadable.
 */
export function readOptionalJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Read the scenario directory and format the failure diagnostic.
 * @param {{name: string, directory: string, status: number|null, stdout?: string, stderr?: string}} run - Captured run facts.
 * @returns {string} Multi-line diagnostic.
 */
export function describeControllerFailure({ directory, ...run }) {
  return formatControllerFailure({
    ...run,
    native: readOptionalJson(path.join(directory, "native-proof.json")),
    failureRecord: readOptionalJson(path.join(directory, "failure.json")),
  });
}

#!/usr/bin/env node
/**
 * Dependency-free run outcome recorder for registered Lisa automation loops.
 *
 * The file is local scheduler state, not project knowledge: one bounded JSONL
 * file per loop under `.lisa/automations/runs/`.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { assertDenominatorReported } from "./intake-prework-denominator.mjs";

export const AUTOMATION_RUN_OUTCOMES = [
  "nothing-needed",
  "candidate-proposed",
  "change-proved",
  "approval-requested",
  "recovery-required",
  "policy-obsolete",
];

export const DEFAULT_AUTOMATION_RUN_HISTORY_MAX_ENTRIES = 50;

/**
 * @typedef {{
 *   readonly ts: string
 *   readonly loop_id: string
 *   readonly outcome: string
 *   readonly summary: string
 *   readonly runbook: string
 *   readonly refs: readonly string[]
 *   readonly run_id: string
 * }} AutomationRunRecord
 *
 * @typedef {{
 *   readonly projectRoot?: string
 *   readonly loopId: string
 *   readonly outcome: string
 *   readonly summary: string
 *   readonly runbook: string
 *   readonly refs?: readonly string[]
 *   readonly runId?: string
 *   readonly ts?: string | Date
 *   readonly maxEntries?: number
 *   readonly extras?: Readonly<Record<string, unknown>>
 * }} RecordAutomationRunInput
 */

/**
 * Record one automation-loop outcome, suppressing duplicate re-appends for the
 * same `run_id` and trimming the file to the configured history bound.
 *
 * @param {RecordAutomationRunInput} input
 * @returns {Promise<{ readonly path: string, readonly record: AutomationRunRecord, readonly records: readonly AutomationRunRecord[], readonly appended: boolean, readonly skippedCorruptLines: number, readonly maxEntries: number }>}
 */
export async function recordAutomationRun(input) {
  // Write path only. Stored rows are re-validated on read through
  // `validateStoredRecord`, and a history written before this contract existed
  // must stay readable — so the denominator gate lives here, where a NEW row is
  // minted, and never on the read path.
  assertDenominatorReported({
    loopId: input.loopId,
    outcome: input.outcome,
    denominator: input.extras?.denominator,
  });
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const maxEntries =
    input.maxEntries ??
    (await resolveAutomationRunHistoryMaxEntries(projectRoot));
  const record = buildAutomationRunRecord(input);
  const filePath = automationRunRecordPath(projectRoot, record.loop_id);
  const readResult = await readAutomationRunRecords(filePath);

  if (readResult.records.some(existing => existing.run_id === record.run_id)) {
    return {
      path: filePath,
      record,
      records: readResult.records,
      appended: false,
      skippedCorruptLines: readResult.skippedCorruptLines,
      maxEntries,
    };
  }

  const nextRecords = [...readResult.records, record].slice(-maxEntries);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeJsonlAtomically(filePath, nextRecords);

  return {
    path: filePath,
    record,
    records: nextRecords,
    appended: true,
    skippedCorruptLines: readResult.skippedCorruptLines,
    maxEntries,
  };
}

/**
 * @param {string} projectRoot
 * @returns {Promise<number>}
 */
export async function resolveAutomationRunHistoryMaxEntries(projectRoot) {
  const globalConfig = await readJsonIfPresent(
    path.join(projectRoot, ".lisa.config.json")
  );
  const localConfig = await readJsonIfPresent(
    path.join(projectRoot, ".lisa.config.local.json")
  );
  const configured =
    localConfig?.automations?.runHistory?.maxEntries ??
    globalConfig?.automations?.runHistory?.maxEntries;

  if (Number.isInteger(configured) && configured > 0) {
    return configured;
  }

  return DEFAULT_AUTOMATION_RUN_HISTORY_MAX_ENTRIES;
}

/**
 * @param {string} projectRoot
 * @param {string} loopId
 * @returns {string}
 */
export function automationRunRecordPath(projectRoot, loopId) {
  return path.join(
    path.resolve(projectRoot),
    ".lisa",
    "automations",
    "runs",
    `${normalizeLoopId(loopId)}.jsonl`
  );
}

/**
 * @param {string} filePath
 * @returns {Promise<{ readonly records: readonly AutomationRunRecord[], readonly skippedCorruptLines: number }>}
 */
export async function readAutomationRunRecords(filePath) {
  let content = "";
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { records: [], skippedCorruptLines: 0 };
    }
    throw error;
  }

  const records = [];
  let skippedCorruptLines = 0;
  for (const line of content.split(/\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line);
      records.push(validateStoredRecord(parsed));
    } catch {
      skippedCorruptLines += 1;
    }
  }

  return { records, skippedCorruptLines };
}

/**
 * @param {RecordAutomationRunInput} input
 * @returns {AutomationRunRecord}
 */
function buildAutomationRunRecord(input) {
  const loopId = normalizeLoopId(input.loopId);
  const summary = String(input.summary ?? "").trim();
  const runbook = String(input.runbook ?? "").trim();
  const refs = Array.isArray(input.refs)
    ? input.refs.map(ref => String(ref))
    : [];
  const ts =
    input.ts instanceof Date
      ? input.ts.toISOString()
      : input.ts
        ? new Date(input.ts).toISOString()
        : new Date().toISOString();
  const runId = String(input.runId ?? `${loopId}:${ts}`).trim();

  if (!AUTOMATION_RUN_OUTCOMES.includes(input.outcome)) {
    throw new Error(
      `Invalid automation run outcome "${input.outcome}". Valid outcomes: ${AUTOMATION_RUN_OUTCOMES.join(", ")}.`
    );
  }
  if (!summary) {
    throw new Error("Automation run summary is required.");
  }
  if (!runbook) {
    throw new Error("Automation runbook path is required.");
  }
  if (!runId) {
    throw new Error("Automation run_id is required.");
  }

  // Unknown keys are preserved rather than dropped. `recordAutomationRun`
  // rewrites the WHOLE history file on every append, and stored records are
  // re-validated through this function on read — so dropping an unrecognised
  // key here does not merely omit it from the new row, it erases it from every
  // row that already had it. The loss is invisible: the write succeeds, the
  // file stays valid JSONL, and the reader returns records that look complete.
  // Consumers get a false all-clear instead of an error (#2524).
  //
  // Validated fields are spread LAST so a corrupt or hostile stored row cannot
  // override `outcome`, `run_id`, or any other checked value with an extra key
  // of the same name.
  const extras =
    input.extras &&
    typeof input.extras === "object" &&
    !Array.isArray(input.extras)
      ? input.extras
      : {};

  return {
    ...extras,
    ts,
    loop_id: loopId,
    outcome: input.outcome,
    summary,
    runbook,
    refs,
    run_id: runId,
  };
}

/** Keys this module validates explicitly; everything else is passed through. */
const KNOWN_RECORD_KEYS = new Set([
  "ts",
  "loop_id",
  "outcome",
  "summary",
  "runbook",
  "refs",
  "run_id",
]);

/**
 * @param {unknown} value
 * @returns {AutomationRunRecord}
 */
function validateStoredRecord(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Automation run record must be an object.");
  }
  return buildAutomationRunRecord({
    ts: String(value.ts ?? ""),
    loopId: String(value.loop_id ?? ""),
    outcome: String(value.outcome ?? ""),
    summary: String(value.summary ?? ""),
    runbook: String(value.runbook ?? ""),
    refs: Array.isArray(value.refs) ? value.refs.map(ref => String(ref)) : [],
    runId: String(value.run_id ?? ""),
    // Carry every unrecognised key forward. Without this, re-validating a
    // stored record on read silently strips it, and the next append writes the
    // stripped history back over the file (#2524).
    extras: Object.fromEntries(
      Object.entries(value).filter(([key]) => !KNOWN_RECORD_KEYS.has(key))
    ),
  });
}

/**
 * @param {string} loopId
 * @returns {string}
 */
function normalizeLoopId(loopId) {
  const normalized = String(loopId ?? "").trim();
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(normalized)) {
    throw new Error(
      "Automation loop_id must be a non-empty slug containing only letters, numbers, dots, underscores, and hyphens."
    );
  }
  return normalized;
}

/**
 * @param {string} filePath
 * @returns {Promise<unknown | undefined>}
 */
async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

/**
 * @param {string} filePath
 * @param {readonly AutomationRunRecord[]} records
 */
async function writeJsonlAtomically(filePath, records) {
  const content = `${records.map(record => JSON.stringify(record)).join("\n")}\n`;
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, filePath);
}

const CLI_USAGE = `Usage: node automation-run-record.mjs \\
  --loop-id <slug> --outcome <${AUTOMATION_RUN_OUTCOMES.join("|")}> \\
  --summary "<operator-readable one-liner>" --runbook <path> \\
  [--ref <url>]... [--run-id <id>] [--project-root <dir>] \\
  [--denominator '<json from buildIntakeDenominator()>']

--denominator is REQUIRED for a "nothing-needed" run on a build-intake loop: a
dry lane that does not say which lanes it looked in cannot be checked.`;

/**
 * Translate a repeatable-flag argv into a {@link RecordAutomationRunInput}.
 *
 * Every flag takes a following value; `--ref` may repeat and accumulates into
 * `refs`, and `--denominator` carries the swept-lane JSON into `extras`.
 * Unknown flags and value-less flags throw so a typo never silently records the
 * wrong thing.
 *
 * @param {readonly string[]} argv
 * @returns {RecordAutomationRunInput}
 */
function parseAutomationRunRecordArgv(argv) {
  /** @type {Record<string, string>} */
  const single = {};
  /** @type {string[]} */
  const refs = [];
  /** @type {Record<string, unknown>} */
  const extras = {};
  const flags = {
    "--loop-id": "loopId",
    "--outcome": "outcome",
    "--summary": "summary",
    "--runbook": "runbook",
    "--run-id": "runId",
    "--project-root": "projectRoot",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const eq = token.indexOf("=");
    const flag = eq === -1 ? token : token.slice(0, eq);
    const inlineValue = eq === -1 ? undefined : token.slice(eq + 1);
    const takeValue = () => {
      if (inlineValue !== undefined) {
        return inlineValue;
      }
      index += 1;
      if (index >= argv.length) {
        throw new Error(`Missing value for ${flag}.`);
      }
      return argv[index];
    };

    if (flag === "--ref") {
      refs.push(takeValue());
      continue;
    }
    if (flag === "--denominator") {
      extras.denominator = parseDenominatorFlag(takeValue());
      continue;
    }
    const key = flags[flag];
    if (!key) {
      throw new Error(`Unknown flag "${flag}".`);
    }
    single[key] = takeValue();
  }

  return { ...single, refs, extras };
}

/**
 * @param {string} value
 * @returns {unknown}
 */
function parseDenominatorFlag(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(
      "--denominator must be JSON produced by buildIntakeDenominator()."
    );
  }
}

/**
 * Argv-driven CLI wrapper so registered loop skills can record an outcome with
 * one portable `node …/automation-run-record.mjs --outcome …` call. Delegates
 * validation to {@link recordAutomationRun}; surfaces its errors verbatim.
 *
 * @param {readonly string[]} argv
 * @returns {Promise<number>} process exit code
 */
export async function runAutomationRunRecordCli(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${CLI_USAGE}\n`);
    return 0;
  }
  let input;
  try {
    input = parseAutomationRunRecordArgv(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${CLI_USAGE}\n`);
    return 2;
  }
  try {
    const result = await recordAutomationRun(input);
    process.stdout.write(
      `${JSON.stringify({
        path: result.path,
        appended: result.appended,
        outcome: result.record.outcome,
        loop_id: result.record.loop_id,
        run_id: result.record.run_id,
      })}\n`
    );
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

// CLI entrypoint.
/**
 * True when `moduleUrl` names the module node was asked to run.
 *
 * Both sides are realpath'd. The previous spelling compared `import.meta.url`
 * against a `file://` string built from `process.argv[1]`, which pits a real
 * path against whatever the caller typed — so reached through a symlinked
 * checkout, a git worktree, or a `/tmp` path on macOS the two disagreed, the
 * body never ran, and the process exited 0 having done nothing. Every
 * Lisa-driven agent runs in a worktree, so that is the routine path, not an
 * exotic one.
 *
 * Written out rather than imported: this ships inside a plugin payload, which
 * has no `./lib/` to resolve against. Same rule and same reasoning as
 * `scripts/lib/invoked-as-script.mjs`.
 *
 * Realpathing BOTH sides matters under `--preserve-symlinks-main`, which tells
 * node not to resolve the main entry: normalizing only `argv[1]` then compares
 * a real path against a symlinked one and answers false for an entry point that
 * WAS invoked directly. Any resolution error returns false — node loaded the
 * entry from that path moments earlier, so a path that will not resolve now is
 * not the path this module came through.
 * @param {string} moduleUrl - The caller's own `import.meta.url`.
 * @param {string | undefined} [argv1] - Entry path; defaults to `process.argv[1]`.
 * @returns {boolean} Whether the caller should run its CLI body.
 */
export function invokedAsScript(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (invokedAsScript(import.meta.url)) {
  runAutomationRunRecordCli(process.argv.slice(2)).then(
    code => {
      process.exitCode = code;
    },
    error => {
      process.stderr.write(`${error?.message ?? error}\n`);
      process.exitCode = 1;
    }
  );
}

#!/usr/bin/env node
/**
 * Shared Claude runtime adapter for `/lisa:automation-status`.
 *
 * Claude exposes scheduler state through `/schedule`, but the exact listing
 * surface can vary between structured metadata and human-readable listings.
 * This adapter accepts either shape, normalizes command/cadence/status data
 * into the shared automation-status contract, and degrades explicitly when
 * Claude does not expose last-run or failure metadata.
 */

import { compareAutomationFleet } from "./automation-status-contract-drift.mjs";
import {
  assignToAutomationGroup,
  createAutomationGroupBins,
  renderAutomationGroups,
} from "./automation-status-expected-fleet.mjs";
import {
  resolveAutomationRunDisplay,
  resolveRecoveryEscalation,
} from "./automation-status-run-history.mjs";

const CLAUDE_RUNTIME_LABEL = "Claude /schedule";
const CLAUDE_ACTIVE_STATUSES = new Set([
  "ACTIVE",
  "ENABLED",
  "RUNNING",
  "SCHEDULED",
]);
const RUN_FAILURE_PATTERN =
  /\b(failed|failure|errored|error|exception|crash(?:ed)?)\b/i;
const NEGATED_FAILURE_PATTERN =
  /\b(no|without)\s+(?:recent\s+)?(?:fail(?:ure|ed)|errors?|exceptions?)\b/i;

/**
 * @typedef {import("./automation-status-expected-fleet.mjs").resolveExpectedAutomationFleet extends (...args: any[]) => infer T ? T : never} ExpectedFleet
 *
 * @typedef {{
 *   readonly automationId: string
 *   readonly status?: string
 *   readonly observedCadence?: string
 *   readonly observedRRule?: string
 *   readonly observedCommand?: string
 *   readonly lastRunAt?: string | null
 *   readonly lastRunSummary?: string | null
 *   readonly lastRunFailed?: boolean | null
 *   readonly rawObserved?: string
 * }} ObservedClaudeAutomation
 */

/**
 * Inspect the current repo's Claude schedule fleet and map it to the shared
 * automation-status report contract.
 *
 * @param {{
 *   readonly expectedFleet: ExpectedFleet
 *   readonly scheduleListing?: string | readonly unknown[] | Record<string, unknown> | null
 *   readonly projectRoot?: string
 *   readonly now?: string | Date
 * }} input
 * @returns {Promise<{
 *   readonly runtime: string
 *   readonly generatedAt: string
 *   readonly groups: readonly {
 *     readonly id: string
 *     readonly title: string
 *     readonly items: readonly {
 *       readonly id: string
 *       readonly status: "HEALTHY" | "MISSING" | "UNSUPPORTED" | "DRIFTED" | "STALE" | "FAILING"
 *       readonly summary: string
 *       readonly expectedCadence?: string
 *       readonly expectedCommand?: string
 *       readonly observed?: string
 *       readonly runbook?: string
 *       readonly lastOutcome?: { readonly ts: string, readonly outcome: string, readonly summary: string }
 *       readonly outcomeHistory?: readonly string[]
 *       readonly olderRecordCount?: number
 *       readonly remediation?: string
 *     }[]
 *   }[]
 *   readonly observedAutomations: readonly ObservedClaudeAutomation[]
 * }>}
 */
export async function inspectClaudeAutomationFleet(input) {
  const expectedFleet = input.expectedFleet;
  const now = normalizeDate(input.now);
  const projectRoot = input.projectRoot ?? process.cwd();
  const observedAutomations = listClaudeAutomations({
    scheduleListing: input.scheduleListing,
    automationPrefix: expectedFleet.automationPrefix,
  });

  const runDisplays = await resolveFleetRunDisplays(projectRoot, expectedFleet);

  const expectedGroups = createAutomationGroupBins();

  const comparisons = compareAutomationFleet({
    expectedAutomations: expectedFleet.expected,
    observedAutomations,
  });

  for (const [index, expected] of expectedFleet.expected.entries()) {
    const comparison = comparisons[index];
    assignToAutomationGroup(
      expectedGroups,
      expected.group,
      createObservedStatusItem({
        expected,
        comparison,
        now,
        runDisplay: runDisplays.get(expected.id),
      })
    );
  }

  for (const unsupported of expectedFleet.unsupported) {
    const runDisplay = runDisplays.get(unsupported.id);
    assignToAutomationGroup(expectedGroups, unsupported.group, {
      id: unsupported.automationId,
      status: "UNSUPPORTED",
      summary: unsupported.reason,
      expectedCadence: unsupported.expectedCadence,
      observed: "No automation is expected for this repo/runtime combination.",
      runbook: runDisplay?.runbook,
      lastOutcome: runDisplay?.lastOutcome,
      outcomeHistory: runDisplay?.outcomeHistory,
      olderRecordCount: runDisplay?.olderRecordCount,
    });
  }

  return {
    runtime: `${CLAUDE_RUNTIME_LABEL} listing`,
    generatedAt: now.toISOString(),
    groups: renderAutomationGroups(expectedGroups),
    observedAutomations,
  };
}

/**
 * Read repo-scoped Claude `/schedule` entries from either structured metadata
 * or a human-readable listing string.
 *
 * @param {{
 *   readonly scheduleListing?: string | readonly unknown[] | Record<string, unknown> | null
 *   readonly automationPrefix: string
 * }} input
 * @returns {readonly ObservedClaudeAutomation[]}
 */
export function listClaudeAutomations(input) {
  return coerceClaudeScheduleEntries(input.scheduleListing)
    .map(entry => normalizeClaudeScheduleEntry(entry))
    .filter(Boolean)
    .filter(entry => entry.automationId.startsWith(input.automationPrefix))
    .toSorted((left, right) =>
      left.automationId.localeCompare(right.automationId)
    );
}

/**
 * Normalize a Claude `/schedule` command line back into the Lisa slash-command
 * surface expected by the shared drift classifier.
 *
 * @param {string | undefined} command
 * @returns {string | undefined}
 */
export function deriveClaudeObservedCommand(command) {
  if (!command) {
    return undefined;
  }

  const trimmed = command.trim();
  const scheduleWrapped = trimmed.match(
    /^\/schedule\s+(?:"[^"]+"|'[^']+'|`[^`]+`|\S+)\s+(.+)$/
  );
  if (scheduleWrapped?.[1]) {
    return scheduleWrapped[1].trim();
  }

  const commandLabel = trimmed.match(/^Command:\s*(.+)$/im);
  if (commandLabel?.[1]) {
    return deriveClaudeObservedCommand(commandLabel[1]);
  }

  if (trimmed.startsWith("/lisa:") || trimmed.startsWith("/lisa-")) {
    return trimmed;
  }

  return undefined;
}

/**
 * Extract the cadence argument from a Claude `/schedule` command string.
 * Supports quoted (double-quote, single-quote, backtick) and unquoted cadence
 * values, returning the first matched capture group via {@link firstString}.
 *
 * @param {string | undefined} command - The command string to parse
 * @returns {string | undefined} The extracted cadence, or undefined if not found
 */
function extractClaudeScheduleCadence(command) {
  if (!command) {
    return undefined;
  }

  const scheduleLine = command
    .trim()
    .match(/^\/schedule\s+(?:"([^"]+)"|'([^']+)'|`([^`]+)`|(\S+))/m);

  return firstString(
    scheduleLine?.[1],
    scheduleLine?.[2],
    scheduleLine?.[3],
    scheduleLine?.[4]
  );
}

/**
 * Read the read-only run-history display for every expected and unsupported
 * loop up front, keyed by the loop's short id, so the per-entry item builder
 * stays synchronous.
 *
 * @param {string} projectRoot
 * @param {ExpectedFleet} expectedFleet
 * @returns {Promise<Map<string, import("./automation-status-run-history.mjs").AutomationRunDisplay>>}
 */
async function resolveFleetRunDisplays(projectRoot, expectedFleet) {
  const entries = [...expectedFleet.expected, ...expectedFleet.unsupported];
  const displays = await Promise.all(
    entries.map(entry =>
      resolveAutomationRunDisplay({
        projectRoot,
        loopId: entry.id,
        runbookPath: entry.runbookPath,
      })
    )
  );
  return new Map(entries.map((entry, index) => [entry.id, displays[index]]));
}

function createObservedStatusItem(input) {
  const expected = input.expected;
  const comparison = input.comparison;
  const observed = comparison.observedAutomation;
  const runDisplay = input.runDisplay;
  const runSignal = classifyAutomationRunSignal({
    expected,
    observedAutomation: observed,
    now: input.now,
  });
  // Three or more consecutive recorded recovery-required runs flip the loop to
  // FAILING even when the /schedule entry looks fine — the fleet-health signal
  // the scheduler surface cannot see. It wins over the scheduler run-signal.
  const escalation = resolveRecoveryEscalation(runDisplay);

  const observedDetails = [comparison.observed];
  if (observed?.status) {
    observedDetails.push(`Scheduler status: ${observed.status}`);
  }
  if (observed?.lastRunAt) {
    observedDetails.push(`Last run: ${observed.lastRunAt}`);
  } else if (observed) {
    observedDetails.push(
      "Last-run metadata unavailable from Claude /schedule."
    );
  }
  if (observed?.lastRunSummary) {
    observedDetails.push(`Latest summary: ${observed.lastRunSummary}`);
  } else if (observed?.lastRunFailed == null) {
    observedDetails.push("Failure metadata unavailable from Claude /schedule.");
  }

  const status =
    escalation?.status ??
    runSignal?.status ??
    /** @type {"HEALTHY" | "MISSING" | "DRIFTED"} */ (comparison.status);

  return {
    id: expected.automationId,
    status,
    summary: escalation
      ? escalation.summary
      : composeAutomationSummary({
          comparison,
          runSignal,
        }),
    expectedCadence: expected.expectedCadence,
    expectedCommand: expected.expectedCommand,
    observed: observedDetails.join(" "),
    runbook: runDisplay?.runbook,
    lastOutcome: runDisplay?.lastOutcome,
    outcomeHistory: runDisplay?.outcomeHistory,
    olderRecordCount: runDisplay?.olderRecordCount,
    remediation:
      escalation?.remediation ??
      runSignal?.remediation ??
      comparison.remediation,
  };
}

function composeAutomationSummary(input) {
  const comparisonSummary = input.comparison.summary;
  if (!input.runSignal) {
    return comparisonSummary;
  }
  if (input.comparison.status === "HEALTHY") {
    return input.runSignal.summary;
  }
  return `${input.runSignal.summary}; ${comparisonSummary}`;
}

function classifyAutomationRunSignal(input) {
  const observed = input.observedAutomation;
  if (!observed) {
    return null;
  }

  if (
    observed.status &&
    !CLAUDE_ACTIVE_STATUSES.has(observed.status.toUpperCase())
  ) {
    return {
      status: "FAILING",
      summary: `scheduler entry is ${observed.status.toLowerCase()}`,
      remediation: "Inspect `/schedule` and re-enable the routine if needed.",
    };
  }

  if (observed.lastRunFailed === true) {
    return {
      status: "FAILING",
      summary: "latest recorded run failed",
      remediation:
        "Inspect the latest Claude routine output, fix the failing job, then allow the next scheduled run to proceed.",
    };
  }

  if (!observed.lastRunAt) {
    return null;
  }

  const cadenceMs =
    rruleToIntervalMs(observed.observedRRule) ??
    cadenceLabelToIntervalMs(
      observed.observedCadence ?? input.expected.expectedCadence
    );
  if (!cadenceMs) {
    return null;
  }

  const lastRunAt = Date.parse(observed.lastRunAt);
  if (Number.isNaN(lastRunAt)) {
    return null;
  }

  const staleAfterMs = cadenceMs * 3;
  if (input.now.getTime() - lastRunAt > staleAfterMs) {
    return {
      status: "STALE",
      summary: "last recorded run is stale for the expected cadence",
      remediation:
        "Inspect why the Claude routine has not run recently, then refresh it from `/lisa:setup-automations` or the `/schedule` surface.",
    };
  }

  return null;
}

function coerceClaudeScheduleEntries(scheduleListing) {
  if (!scheduleListing) {
    return [];
  }

  if (typeof scheduleListing === "string") {
    const parsedJson = tryParseJson(scheduleListing);
    if (parsedJson) {
      return coerceClaudeScheduleEntries(parsedJson);
    }
    return splitClaudeScheduleListing(scheduleListing);
  }

  if (Array.isArray(scheduleListing)) {
    return scheduleListing;
  }

  if (typeof scheduleListing === "object") {
    const nested =
      scheduleListing.entries ??
      scheduleListing.tasks ??
      scheduleListing.routines ??
      scheduleListing.items ??
      scheduleListing.data;
    if (Array.isArray(nested)) {
      return nested;
    }
    return [scheduleListing];
  }

  return [];
}

function splitClaudeScheduleListing(listing) {
  return listing
    .split(/\n\s*\n/g)
    .map(block => block.trim())
    .filter(Boolean);
}

function normalizeClaudeScheduleEntry(entry) {
  if (typeof entry === "string") {
    return normalizeClaudeScheduleTextEntry(entry);
  }

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const automationId = firstString(
    entry.automationId,
    entry.id,
    entry.name,
    entry.title
  );
  if (!automationId) {
    return null;
  }

  const commandSource = firstString(
    entry.command,
    entry.prompt,
    entry.run,
    entry.task
  );
  const cadenceSource = firstString(
    entry.cadence,
    entry.schedule,
    entry.rrule,
    entry.interval
  );
  const lastRunAt = normalizeTimestamp(
    firstString(
      entry.lastRunAt,
      entry.last_run_at,
      entry.lastRun,
      entry.last_run,
      entry.latestRunAt
    )
  );
  const lastRunSummary = firstString(
    entry.lastRunSummary,
    entry.last_run_summary,
    entry.lastResult,
    entry.last_result,
    entry.latestResult,
    entry.latest_result
  );
  const lastRunFailed = deriveRunFailure({
    failed: entry.lastRunFailed ?? entry.last_run_failed,
    summary: lastRunSummary,
    details: firstString(entry.lastError, entry.last_error),
  });

  return {
    automationId,
    status: firstString(entry.status, entry.state),
    observedCadence: humanizeClaudeCadence(cadenceSource),
    observedRRule: normalizeClaudeRRule(cadenceSource),
    observedCommand: deriveClaudeObservedCommand(commandSource),
    lastRunAt,
    lastRunSummary: lastRunSummary ?? null,
    lastRunFailed,
    rawObserved: stringifyObserved(entry),
  };
}

function normalizeClaudeScheduleTextEntry(block) {
  const automationId =
    extractField(block, /^(?:ID|Name|Routine|Task):\s*(.+)$/im) ??
    block.match(/\blisa-auto-[a-z0-9-]+\b/i)?.[0];
  if (!automationId) {
    return null;
  }

  const cadenceSource =
    extractField(block, /^(?:Cadence|Schedule):\s*(.+)$/im) ??
    extractClaudeScheduleCadence(block);
  const commandSource =
    extractField(block, /^(?:Command|Prompt):\s*(.+)$/im) ??
    extractField(
      block,
      /^\/schedule\s+(?:"[^"]+"|'[^']+'|`[^`]+`|\S+)\s+(.+)$/im
    );
  const lastRunSummary = extractField(
    block,
    /^(?:Last result|Latest result|Result|Outcome):\s*(.+)$/im
  );

  return {
    automationId,
    status: extractField(block, /^(?:Status|State):\s*(.+)$/im),
    observedCadence: humanizeClaudeCadence(cadenceSource),
    observedRRule: normalizeClaudeRRule(cadenceSource),
    observedCommand: deriveClaudeObservedCommand(commandSource),
    lastRunAt: normalizeTimestamp(
      extractField(block, /^(?:Last run|Latest run|Last executed):\s*(.+)$/im)
    ),
    lastRunSummary: lastRunSummary ?? null,
    lastRunFailed: deriveRunFailure({
      summary: lastRunSummary,
    }),
    rawObserved: block.replace(/\s+/g, " ").trim(),
  };
}

function normalizeClaudeRRule(value) {
  if (!value) {
    return undefined;
  }
  if (value.startsWith("FREQ=")) {
    return value;
  }

  const cadence = value.toLowerCase();
  if (
    cadence === "hourly" ||
    cadence === "every 60 minutes" ||
    cadence === "every hour"
  ) {
    return "FREQ=HOURLY;INTERVAL=1";
  }
  if (cadence === "every 10 minutes") {
    return "FREQ=MINUTELY;INTERVAL=10";
  }
  if (
    cadence === "once a day" ||
    cadence === "every day" ||
    cadence === "daily"
  ) {
    return "FREQ=DAILY;INTERVAL=1";
  }
  if (
    cadence === "once a week" ||
    cadence === "every week" ||
    cadence === "weekly"
  ) {
    return "FREQ=WEEKLY;INTERVAL=1";
  }

  const everyMinutes = cadence.match(/every (\d+) minutes?/);
  if (everyMinutes?.[1]) {
    return `FREQ=MINUTELY;INTERVAL=${everyMinutes[1]}`;
  }

  const everyHours = cadence.match(/every (\d+) hours?/);
  if (everyHours?.[1]) {
    return `FREQ=HOURLY;INTERVAL=${everyHours[1]}`;
  }

  const everyDays = cadence.match(/every (\d+) days?/);
  if (everyDays?.[1]) {
    return `FREQ=DAILY;INTERVAL=${everyDays[1]}`;
  }

  const everyWeeks = cadence.match(/every (\d+) weeks?/);
  if (everyWeeks?.[1]) {
    return `FREQ=WEEKLY;INTERVAL=${everyWeeks[1]}`;
  }

  return undefined;
}

function humanizeClaudeCadence(value) {
  if (!value) {
    return undefined;
  }
  if (value.startsWith("FREQ=")) {
    return humanizeRRule(value);
  }

  const normalized = value
    .replace(/^Schedule:\s*/i, "")
    .trim()
    .toLowerCase();
  if (normalized === "hourly") {
    return "every 60 minutes";
  }
  if (normalized === "daily") {
    return "once a day";
  }
  if (normalized === "every day") {
    return "once a day";
  }
  if (normalized === "weekly" || normalized === "every week") {
    return "once a week";
  }
  return normalized;
}

function humanizeRRule(rrule) {
  if (rrule === "FREQ=HOURLY;INTERVAL=1") {
    return "every 60 minutes";
  }
  if (rrule === "FREQ=MINUTELY;INTERVAL=10") {
    return "every 10 minutes";
  }
  if (rrule === "FREQ=DAILY;INTERVAL=1") {
    return "once a day";
  }

  const minutely = rrule.match(/^FREQ=MINUTELY;INTERVAL=(\d+)$/);
  if (minutely?.[1]) {
    return `every ${minutely[1]} minutes`;
  }

  const hourly = rrule.match(/^FREQ=HOURLY;INTERVAL=(\d+)$/);
  if (hourly?.[1]) {
    return `every ${Number(hourly[1]) * 60} minutes`;
  }

  const daily = rrule.match(/^FREQ=DAILY;INTERVAL=(\d+)$/);
  if (daily?.[1]) {
    return Number(daily[1]) === 1 ? "once a day" : `every ${daily[1]} days`;
  }

  const weekly = rrule.match(/^FREQ=WEEKLY;INTERVAL=(\d+)$/);
  if (weekly?.[1]) {
    return Number(weekly[1]) === 1 ? "once a week" : `every ${weekly[1]} weeks`;
  }

  return rrule;
}

function cadenceLabelToIntervalMs(label) {
  if (!label) {
    return null;
  }

  const everyMinutes = label.match(/^every (\d+) minutes$/);
  if (everyMinutes?.[1]) {
    return Number(everyMinutes[1]) * 60_000;
  }

  const oncePerDay = new Set(["once a day", "daily"]);
  if (oncePerDay.has(label)) {
    return 24 * 60 * 60_000;
  }

  const oncePerWeek = new Set(["once a week", "weekly"]);
  if (oncePerWeek.has(label)) {
    return 7 * 24 * 60 * 60_000;
  }

  return null;
}

function rruleToIntervalMs(rrule) {
  if (!rrule) {
    return null;
  }

  const minutely = rrule.match(/^FREQ=MINUTELY;INTERVAL=(\d+)$/);
  if (minutely?.[1]) {
    return Number(minutely[1]) * 60_000;
  }

  const hourly = rrule.match(/^FREQ=HOURLY;INTERVAL=(\d+)$/);
  if (hourly?.[1]) {
    return Number(hourly[1]) * 60 * 60_000;
  }

  const daily = rrule.match(/^FREQ=DAILY;INTERVAL=(\d+)$/);
  if (daily?.[1]) {
    return Number(daily[1]) * 24 * 60 * 60_000;
  }

  return null;
}

function deriveRunFailure(input) {
  if (typeof input.failed === "boolean") {
    return input.failed;
  }

  const signal = [input.summary, input.details].filter(Boolean).join("\n");
  if (!signal) {
    return null;
  }

  return (
    RUN_FAILURE_PATTERN.test(signal) && !NEGATED_FAILURE_PATTERN.test(signal)
  );
}

function normalizeTimestamp(value) {
  if (!value) {
    return null;
  }

  const isoMatch = value.match(
    /20\d{2}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)?/
  );
  if (isoMatch?.[0]) {
    const isoValue = isoMatch[0].replace(" ", "T");
    return Number.isNaN(Date.parse(isoValue)) ? null : isoValue;
  }

  return null;
}

function stringifyObserved(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractField(value, pattern) {
  const match = value.match(pattern);
  return match?.[1]?.trim();
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeDate(value) {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string") {
    return new Date(value);
  }
  return new Date();
}

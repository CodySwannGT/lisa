#!/usr/bin/env node
/**
 * Shared Codex runtime adapter for `/lisa:automation-status`.
 *
 * This adapter inspects the local Codex automation backing store read-only:
 * the per-automation `automation.toml` contract plus the automation memory file
 * used by recurring runs. It scopes the scan to the current repo's expected
 * Lisa automation prefix, derives normalized command/cadence metadata, and
 * overlays available recency/failure signals onto the shared fleet report
 * contract.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

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

const CODEx_RUNTIME_LABEL = "Codex automations";
const RUN_TIMESTAMP_PATTERN = /20\d{2}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/;
const RUN_FAILURE_PATTERN =
  /\b(failed|failure|errored|error|exception|crash(?:ed)?)\b/i;
const NEGATED_FAILURE_PATTERN =
  /\b(no|without)\s+(?:recent\s+)?(?:fail(?:ure|ed)|errors?|exceptions?)\b/i;
const execFileAsync = promisify(execFile);

/**
 * Git location env vars that, when inherited, override the `-C <dir>` flag and
 * cwd. When this adapter runs inside a Git hook (e.g. pre-push) these are
 * exported by Git, so a `git -C <cwd> rev-parse` would answer about the hook's
 * repository instead of the inspected automation cwd — misreporting every
 * healthy automation as FAILING. They must be scrubbed so `-C`/cwd governs.
 */
const GIT_LOCATION_ENV_VARS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_PREFIX",
];

/**
 * Process-spawn failures that are transient under heavy fork load (the OS could
 * not start the child, not git reporting a result). Retrying these avoids
 * misclassifying a healthy cwd as a `git_error` when the machine is saturated.
 */
const TRANSIENT_SPAWN_ERROR_CODES = new Set([
  "EAGAIN",
  "ENOMEM",
  "EMFILE",
  "ENFILE",
  "ETXTBSY",
]);

/**
 * Build a git-safe environment: the ambient process env minus the location
 * overrides so a `-C <dir>` invocation targets the intended directory.
 *
 * @returns {NodeJS.ProcessEnv}
 */
function gitEnvWithoutLocationOverrides() {
  const env = { ...process.env };
  for (const key of GIT_LOCATION_ENV_VARS) {
    delete env[key];
  }
  return env;
}

/**
 * Run `git` against an explicit directory, immune to inherited Git location env
 * vars, with a bounded retry on transient process-spawn failures. A git process
 * that actually ran — success or non-zero exit — is surfaced unchanged on the
 * first attempt; only failures to launch the child at all are retried.
 *
 * @param {readonly string[]} args git arguments
 * @param {import("node:child_process").ExecFileOptions} [options]
 * @param {number} [attempts] maximum attempts (default 4)
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
async function execGitWithRetry(args, options, attempts = 4) {
  const mergedOptions = { ...options, env: gitEnvWithoutLocationOverrides() };
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await execFileAsync("git", args, mergedOptions);
    } catch (error) {
      const transient = TRANSIENT_SPAWN_ERROR_CODES.has(error?.code);
      if (!transient || attempt >= attempts) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 2 ** attempt * 25));
    }
  }
}

/**
 * @typedef {import("./automation-status-expected-fleet.mjs").resolveExpectedAutomationFleet extends (...args: any[]) => infer T ? T : never} ExpectedFleet
 *
 * @typedef {{
 *   readonly automationId: string
 *   readonly status?: string
 *   readonly prompt?: string
 *   readonly observedCadence?: string
 *   readonly observedRRule?: string
 *   readonly observedCommand?: string
 *   readonly cwd?: string | null
 *   readonly cwdHealth?: {
 *     readonly status: "ok" | "missing" | "not_directory" | "not_git_work_tree" | "bare_git_repository" | "git_error"
 *     readonly summary: string
 *   }
 *   readonly createdAt?: number | null
 *   readonly updatedAt?: number | null
 *   readonly lastRunAt?: string | null
 *   readonly lastRunSummary?: string | null
 *   readonly lastRunFailed?: boolean
 * }} ObservedCodexAutomation
 */

/**
 * Inspect the current repo's Codex automation fleet and map it to the shared
 * automation-status report contract.
 *
 * @param {{
 *   readonly expectedFleet: ExpectedFleet
 *   readonly automationsDir?: string
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
 *   readonly observedAutomations: readonly ObservedCodexAutomation[]
 * }>}
 */
export async function inspectCodexAutomationFleet(input) {
  const expectedFleet = input.expectedFleet;
  const now = normalizeDate(input.now);
  const projectRoot = input.projectRoot ?? process.cwd();
  const observedAutomations = await listCodexAutomations({
    automationsDir: input.automationsDir,
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
    runtime: `${CODEx_RUNTIME_LABEL} (backing-store metadata)`,
    generatedAt: now.toISOString(),
    groups: renderAutomationGroups(expectedGroups),
    observedAutomations,
  };
}

/**
 * Read every Codex automation whose id matches the current repo's Lisa prefix.
 *
 * @param {{
 *   readonly automationsDir?: string
 *   readonly automationPrefix: string
 * }} input
 * @returns {Promise<readonly ObservedCodexAutomation[]>}
 */
export async function listCodexAutomations(input) {
  const automationsDir =
    input.automationsDir ?? resolveDefaultCodexAutomationsDir();
  const dirEntries = await fs.readdir(automationsDir, {
    withFileTypes: true,
  });

  const automationDirs = dirEntries
    .filter(
      entry =>
        entry.isDirectory() && entry.name.startsWith(input.automationPrefix)
    )
    .map(entry => path.join(automationsDir, entry.name))
    .sort((left, right) => left.localeCompare(right));

  const automations = await Promise.all(
    automationDirs.map(dir => readCodexAutomation(dir))
  );

  return automations.filter(Boolean);
}

/**
 * Normalize a Lisa Codex automation prompt back into the slash-command surface
 * expected by the shared drift classifier.
 *
 * @param {string | undefined} prompt
 * @returns {string | undefined}
 */
export function deriveCodexObservedCommand(prompt) {
  if (!prompt) {
    return undefined;
  }

  // The "with arguments" clause is optional: no-argument loops (monitor, the
  // gardener) register without one. Requiring it made every such loop derive an
  // undefined command and report DRIFTED forever, un-fixable by re-running setup.
  const lisaSkillMatch = prompt.match(
    /Use the Lisa ([a-z0-9:-]+) skill(?: with arguments `([^`]*)`)?/i
  );
  if (lisaSkillMatch?.[1]) {
    return `/lisa:${lisaSkillMatch[1]} ${lisaSkillMatch[2] ?? ""}`.trim();
  }

  const aliasSkillMatch = prompt.match(
    /Use the `\$([a-z0-9:-]+)` skill(?: with arguments `([^`]*)`)?/i
  );
  if (aliasSkillMatch?.[1]) {
    return `${canonicalizeCodexSkillAlias(aliasSkillMatch[1])} ${aliasSkillMatch[2] ?? ""}`.trim();
  }

  // A registration whose prompt carries the literal Lisa command on its own
  // line — the shape `/lisa:setup-automations` bakes so a command that is not a
  // plain skill name (`/lisa:learnings:audit`) round-trips exactly. Mirrors the
  // Claude adapter, which has always accepted a bare `/lisa:` command. Codex
  // stores prompts as single-line TOML, so a line break arrives either real or
  // as the two-character escape `\n`; both delimit a line here.
  const literalCommand = prompt
    .split(/\r?\n|\\n/)
    .map(segment => segment.trim())
    .find(segment => /^\/lisa[:-]\S/.test(segment));

  return literalCommand;
}

function canonicalizeCodexSkillAlias(alias) {
  if (alias.startsWith("lisa-")) {
    return `/lisa:${alias.slice("lisa-".length)}`;
  }
  return `/${alias}`;
}

/**
 * Parse the latest run metadata from an automation memory file.
 *
 * @param {string | undefined} memoryContent
 * @returns {{
 *   readonly lastRunAt: string | null
 *   readonly lastRunSummary: string | null
 *   readonly lastRunFailed: boolean
 * }}
 */
export function parseCodexAutomationMemory(memoryContent) {
  if (!memoryContent) {
    return {
      lastRunAt: null,
      lastRunSummary: null,
      lastRunFailed: false,
    };
  }

  const lines = memoryContent.split(/\r?\n/);
  const latestBlock = findLatestAutomationMemoryBlock(lines);
  const summaryLine =
    latestBlock.lines
      .find(line => line.startsWith("- "))
      ?.replace(/^- /, "")
      .trim() ?? null;

  const latestBlockText = latestBlock.lines.join("\n");
  const lastRunFailed =
    RUN_FAILURE_PATTERN.test(latestBlockText) &&
    !NEGATED_FAILURE_PATTERN.test(latestBlockText);

  return {
    lastRunAt: latestBlock.timestamp,
    lastRunSummary: summaryLine,
    lastRunFailed,
  };
}

function findLatestAutomationMemoryBlock(lines) {
  const timestampLines = lines
    .map((line, index) => ({
      index,
      timestamp: line.match(RUN_TIMESTAMP_PATTERN)?.[0] ?? null,
    }))
    .filter(entry => entry.timestamp);

  if (timestampLines.length === 0) {
    return {
      timestamp: null,
      lines,
    };
  }

  const latest = timestampLines.at(-1);
  const next = timestampLines.find(entry => entry.index > latest.index);

  return {
    timestamp: latest.timestamp,
    lines: lines.slice(latest.index, next?.index),
  };
}

async function readCodexAutomation(automationDir) {
  const tomlPath = path.join(automationDir, "automation.toml");
  const memoryPath = path.join(automationDir, "memory.md");
  const tomlContent = await fs.readFile(tomlPath, "utf8");
  const automation = parseAutomationToml(tomlContent);
  const memoryContent = await fs.readFile(memoryPath, "utf8").catch(() => "");
  const memory = parseCodexAutomationMemory(memoryContent);
  const cwd = Array.isArray(automation.cwds) ? automation.cwds[0] : null;
  const normalizedCwd = typeof cwd === "string" ? cwd : null;
  const cwdHealth = await inspectAutomationCwd(normalizedCwd);

  return {
    automationId:
      stringOrUndefined(automation.id) ?? path.basename(automationDir),
    status: stringOrUndefined(automation.status),
    prompt: stringOrUndefined(automation.prompt),
    observedCadence: humanizeAutomationCadence(
      stringOrUndefined(automation.rrule)
    ),
    observedRRule: stringOrUndefined(automation.rrule),
    observedCommand: deriveCodexObservedCommand(
      stringOrUndefined(automation.prompt)
    ),
    cwd: normalizedCwd,
    cwdHealth,
    createdAt: numberOrNull(automation.created_at),
    updatedAt: numberOrNull(automation.updated_at),
    ...memory,
  };
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
  // FAILING even when the scheduler entry looks fine — the fleet-health signal
  // the raw backing store cannot see. It wins over the scheduler run-signal.
  const escalation = resolveRecoveryEscalation(runDisplay);

  const observedDetails = [comparison.observed];
  if (observed?.status) {
    observedDetails.push(`Scheduler status: ${observed.status}`);
  }
  if (observed?.cwdHealth) {
    observedDetails.push(`Cwd: ${observed.cwdHealth.summary}`);
  }
  if (observed?.lastRunAt) {
    observedDetails.push(`Last run: ${observed.lastRunAt}`);
  } else if (observed) {
    observedDetails.push("Last run metadata unavailable.");
  }
  if (observed?.lastRunSummary) {
    observedDetails.push(`Latest summary: ${observed.lastRunSummary}`);
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

  if (observed.status && observed.status !== "ACTIVE") {
    return {
      status: "FAILING",
      summary: `scheduler entry is ${observed.status.toLowerCase()}`,
      remediation: "Resume or re-enable the automation in Codex.",
    };
  }

  if (observed.cwdHealth && observed.cwdHealth.status !== "ok") {
    return {
      status: "FAILING",
      summary: `scheduler cwd is invalid: ${observed.cwdHealth.summary}`,
      remediation:
        "Recreate the automation with `/lisa:setup-automations` so it uses a durable non-bare project checkout, then verify the cwd before the next run.",
    };
  }

  if (observed.lastRunFailed) {
    return {
      status: "FAILING",
      summary: "latest recorded run failed",
      remediation:
        "Inspect the latest automation run output and fix the failing job before re-running setup.",
    };
  }

  if (!observed.lastRunAt) {
    return null;
  }

  const cadenceMs =
    rruleToIntervalMs(observed.observedRRule) ??
    cadenceLabelToIntervalMs(input.expected.expectedCadence);
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
      summary: `last recorded run is stale for the expected cadence`,
      remediation:
        "Inspect why the automation has not run recently, then resume normal scheduling or recreate it with `/lisa:setup-automations`.",
    };
  }

  return null;
}

async function inspectAutomationCwd(cwd) {
  if (!cwd) {
    return {
      status: "missing",
      summary: "no cwd configured",
    };
  }

  const stat = await fs.stat(cwd).catch(error => {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  });

  if (!stat) {
    return {
      status: "missing",
      summary: `${cwd} does not exist`,
    };
  }

  if (!stat.isDirectory()) {
    return {
      status: "not_directory",
      summary: `${cwd} is not a directory`,
    };
  }

  try {
    const { stdout } = await execGitWithRetry(
      ["-C", cwd, "rev-parse", "--is-inside-work-tree", "--is-bare-repository"],
      { timeout: 5000 }
    );
    const [insideWorkTree, bareRepository] = stdout.trim().split(/\r?\n/);

    if (insideWorkTree !== "true") {
      return {
        status: "not_git_work_tree",
        summary: `${cwd} is not inside a Git work tree`,
      };
    }

    if (bareRepository === "true") {
      return {
        status: "bare_git_repository",
        summary: `${cwd} is configured as a bare Git repository`,
      };
    }

    return {
      status: "ok",
      summary: `${cwd} is a valid Git work tree`,
    };
  } catch (error) {
    return {
      status: "git_error",
      summary: `git could not inspect ${cwd}: ${String(error?.message ?? error)}`,
    };
  }
}

function resolveDefaultCodexAutomationsDir() {
  return path.join(
    process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"),
    "automations"
  );
}

function humanizeAutomationCadence(rrule) {
  if (!rrule) {
    return undefined;
  }
  if (rrule === "FREQ=HOURLY;INTERVAL=1") {
    return "every 60 minutes";
  }
  if (rrule === "FREQ=MINUTELY;INTERVAL=10") {
    return "every 10 minutes";
  }
  if (rrule === "FREQ=DAILY;INTERVAL=1") {
    return "once a day";
  }

  const everyMinutes = rrule.match(/^FREQ=MINUTELY;INTERVAL=(\d+)$/);
  if (everyMinutes?.[1]) {
    return `every ${everyMinutes[1]} minutes`;
  }

  const everyHours = rrule.match(/^FREQ=HOURLY;INTERVAL=(\d+)$/);
  if (everyHours?.[1]) {
    return `every ${Number(everyHours[1]) * 60} minutes`;
  }

  const everyDays = rrule.match(/^FREQ=DAILY;INTERVAL=(\d+)$/);
  if (everyDays?.[1]) {
    return Number(everyDays[1]) === 1
      ? "once a day"
      : `every ${everyDays[1]} days`;
  }

  const everyWeeks = rrule.match(/^FREQ=WEEKLY;INTERVAL=(\d+)$/);
  if (everyWeeks?.[1]) {
    return Number(everyWeeks[1]) === 1
      ? "once a week"
      : `every ${everyWeeks[1]} weeks`;
  }

  return rrule;
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

  const weekly = rrule.match(/^FREQ=WEEKLY;INTERVAL=(\d+)$/);
  if (weekly?.[1]) {
    return Number(weekly[1]) * 7 * 24 * 60 * 60_000;
  }

  return null;
}

function cadenceLabelToIntervalMs(label) {
  if (!label) {
    return null;
  }

  const everyMinutes = label.match(/^every (\d+) minutes$/);
  if (everyMinutes?.[1]) {
    return Number(everyMinutes[1]) * 60_000;
  }

  if (label === "once a day") {
    return 24 * 60 * 60_000;
  }

  if (label === "once a week") {
    return 7 * 24 * 60 * 60_000;
  }

  return null;
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

function stringOrUndefined(value) {
  return typeof value === "string" ? value : undefined;
}

function numberOrNull(value) {
  return typeof value === "number" ? value : null;
}

function parseAutomationToml(tomlContent) {
  return tomlContent
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"))
    .reduce((parsed, line) => {
      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) {
        return parsed;
      }

      const key = line.slice(0, separatorIndex).trim();
      const rawValue = line.slice(separatorIndex + 1).trim();

      return {
        ...parsed,
        [key]: parseTomlValue(rawValue),
      };
    }, {});
}

function parseTomlValue(rawValue) {
  if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
    return rawValue.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }

  if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
    const inner = rawValue.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return inner
      .split(",")
      .map(value => parseTomlValue(value.trim()))
      .filter(value => value !== undefined);
  }

  if (/^-?\d+$/.test(rawValue)) {
    return Number(rawValue);
  }

  if (rawValue === "true") {
    return true;
  }

  if (rawValue === "false") {
    return false;
  }

  return rawValue;
}

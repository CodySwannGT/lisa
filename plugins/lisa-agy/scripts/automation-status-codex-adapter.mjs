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
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
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
const MAX_SCHEDULER_ENTRIES = 1_000;
const MAX_MATCHING_AUTOMATIONS = 100;
const MAX_AUTOMATION_TOML_BYTES = 256 * 1024;
const MAX_AUTOMATION_MEMORY_BYTES = 512 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
const UNSAFE_SCHEDULER_FILE = "Unsafe Codex scheduler file";

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
      await delay(2 ** attempt * 25, undefined, {
        signal: options?.signal,
      });
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
 *   readonly signal?: AbortSignal
 * }} input
 * @returns {Promise<readonly ObservedCodexAutomation[]>}
 */
export async function listCodexAutomations(input) {
  input.signal?.throwIfAborted();
  const requestedRoot =
    input.automationsDir ?? resolveDefaultCodexAutomationsDir();
  const automationsRoot = await fs.realpath(requestedRoot);
  input.signal?.throwIfAborted();
  const automationDirs = await listConfinedAutomationDirectories(
    automationsRoot,
    input.automationPrefix,
    input.signal
  );
  return await readCodexAutomations(automationDirs, input.signal);
}

/**
 * Enumerate a bounded number of direct, regular scheduler directories.
 * @param {string} automationsRoot Canonical scheduler root.
 * @param {string} automationPrefix Expected repository automation prefix.
 * @param {AbortSignal | undefined} signal Probe cancellation signal.
 * @returns {Promise<readonly string[]>} Canonical matching directories.
 */
async function listConfinedAutomationDirectories(
  automationsRoot,
  automationPrefix,
  signal
) {
  const directory = await fs.opendir(automationsRoot);
  try {
    const names = await readBoundedDirectoryNames(
      directory,
      automationPrefix,
      signal
    );
    const directories = await Promise.all(
      names.map(name => confinedAutomationDirectory(automationsRoot, name))
    );
    signal?.throwIfAborted();
    return directories.toSorted((left, right) => left.localeCompare(right));
  } finally {
    await closeDirectory(directory);
  }
}

/**
 * Close a scheduler directory while tolerating runtimes that auto-close it
 * after async iteration.
 * @param {import("node:fs").Dir} directory Open scheduler directory handle.
 * @returns {Promise<void>}
 */
async function closeDirectory(directory) {
  try {
    await directory.close();
  } catch (error) {
    if (error?.code !== "ERR_DIR_CLOSED") throw error;
  }
}

/**
 * Consume directory entries with total and prefix-match bounds.
 * @param {import("node:fs").Dir} directory Open scheduler directory handle.
 * @param {string} automationPrefix Expected repository automation prefix.
 * @param {AbortSignal | undefined} signal Probe cancellation signal.
 * @param {number} [entryCount] Entries consumed so far.
 * @param {readonly string[]} [matchingNames] Matching directory names.
 * @returns {Promise<readonly string[]>} Bounded matching names.
 */
async function readBoundedDirectoryNames(
  directory,
  automationPrefix,
  signal,
  entryCount = 0,
  matchingNames = []
) {
  signal?.throwIfAborted();
  if (entryCount >= MAX_SCHEDULER_ENTRIES) {
    const overflow = await directory.read();
    if (overflow !== null) {
      throw new Error("Codex scheduler enumeration exceeds entry limit");
    }
    return matchingNames;
  }
  const entry = await directory.read();
  signal?.throwIfAborted();
  if (entry === null) return matchingNames;
  const matches =
    entry.isDirectory() && entry.name.startsWith(automationPrefix);
  const nextNames = matches ? [...matchingNames, entry.name] : matchingNames;
  if (nextNames.length > MAX_MATCHING_AUTOMATIONS) {
    throw new Error("Codex scheduler automation count exceeds limit");
  }
  return await readBoundedDirectoryNames(
    directory,
    automationPrefix,
    signal,
    entryCount + 1,
    nextNames
  );
}

/**
 * Verify one direct scheduler entry remains a confined real directory.
 * @param {string} automationsRoot Canonical scheduler root.
 * @param {string} name Direct entry name.
 * @returns {Promise<string>} Canonical automation directory.
 */
async function confinedAutomationDirectory(automationsRoot, name) {
  const candidate = path.join(automationsRoot, name);
  const stat = await fs.lstat(candidate);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Unsafe Codex scheduler directory");
  }
  const actual = await fs.realpath(candidate);
  if (!actual.startsWith(`${automationsRoot}${path.sep}`)) {
    throw new Error("Codex scheduler directory escapes root");
  }
  return actual;
}

/**
 * Read scheduler entries sequentially to bound simultaneously open files.
 * @param {readonly string[]} automationDirs Canonical automation directories.
 * @param {AbortSignal | undefined} signal Probe cancellation signal.
 * @param {number} [index] Next directory index.
 * @param {readonly ObservedCodexAutomation[]} [results] Completed observations.
 * @returns {Promise<readonly ObservedCodexAutomation[]>} Observations.
 */
async function readCodexAutomations(
  automationDirs,
  signal,
  index = 0,
  results = []
) {
  signal?.throwIfAborted();
  if (index >= automationDirs.length) return results;
  const observation = await readCodexAutomation(automationDirs[index], signal);
  return await readCodexAutomations(automationDirs, signal, index + 1, [
    ...results,
    observation,
  ]);
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

/**
 * Read one stable bounded file without following a scheduler symlink or FIFO.
 * @param {string} automationDir Canonical automation directory.
 * @param {string} filename Direct scheduler filename.
 * @param {number} maximumBytes Maximum allowed bytes.
 * @param {AbortSignal | undefined} signal Probe cancellation signal.
 * @param {boolean} [optional] Whether a missing file resolves to undefined.
 * @returns {Promise<string | undefined>} Strict UTF-8 contents.
 */
async function readConfinedSchedulerText(
  automationDir,
  filename,
  maximumBytes,
  signal,
  optional = false
) {
  signal?.throwIfAborted();
  const target = path.join(automationDir, filename);
  const before = await fs.lstat(target).catch(error => {
    if (optional && error?.code === "ENOENT") return null;
    throw error;
  });
  if (before === null) return undefined;
  assertBoundedSchedulerFile(before, maximumBytes);
  const actual = await fs.realpath(target);
  if (!actual.startsWith(`${automationDir}${path.sep}`)) {
    throw new Error("Codex scheduler file escapes automation directory");
  }
  const handle = await fs.open(
    target,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK
  );
  try {
    const opened = await handle.stat();
    assertBoundedSchedulerFile(opened, maximumBytes);
    if (opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error("Codex scheduler file changed during inspection");
    }
    const bytes = await readBoundedSchedulerFile(handle, maximumBytes, signal);
    const after = await handle.stat();
    if (after.size !== opened.size || bytes.length !== after.size) {
      throw new Error("Codex scheduler file changed during read");
    }
    signal?.throwIfAborted();
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    await handle.close();
  }
}

/**
 * Reject non-regular and oversized scheduler files before opening them.
 * @param {import("node:fs").Stats} stat Scheduler file metadata.
 * @param {number} maximumBytes Maximum allowed bytes.
 * @returns {void}
 */
function assertBoundedSchedulerFile(stat, maximumBytes) {
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(UNSAFE_SCHEDULER_FILE);
  }
  if (stat.size > maximumBytes) {
    throw new Error("Codex scheduler file exceeds size limit");
  }
}

/**
 * Read at most maximum plus one bytes from an already confined file handle.
 * @param {import("node:fs/promises").FileHandle} handle Open file handle.
 * @param {number} maximumBytes Maximum allowed bytes.
 * @param {AbortSignal | undefined} signal Probe cancellation signal.
 * @param {number} [offset] Current file offset.
 * @returns {Promise<Buffer>} Bounded bytes.
 */
async function readBoundedSchedulerFile(
  handle,
  maximumBytes,
  signal,
  offset = 0
) {
  signal?.throwIfAborted();
  const remaining = maximumBytes + 1 - offset;
  if (remaining <= 0) {
    throw new Error("Codex scheduler file exceeds size limit");
  }
  const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remaining));
  const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
  signal?.throwIfAborted();
  if (bytesRead === 0) return Buffer.alloc(0);
  const current = chunk.subarray(0, bytesRead);
  const tail = await readBoundedSchedulerFile(
    handle,
    maximumBytes,
    signal,
    offset + bytesRead
  );
  return Buffer.concat([current, tail], bytesRead + tail.length);
}

/**
 * Read one confined Codex automation contract and optional memory.
 * @param {string} automationDir Canonical automation directory.
 * @param {AbortSignal | undefined} signal Probe cancellation signal.
 * @returns {Promise<ObservedCodexAutomation>} Normalized observation.
 */
async function readCodexAutomation(automationDir, signal) {
  const tomlContent = await readConfinedSchedulerText(
    automationDir,
    "automation.toml",
    MAX_AUTOMATION_TOML_BYTES,
    signal
  );
  const automation = parseAutomationToml(tomlContent);
  const memoryContent =
    (await readConfinedSchedulerText(
      automationDir,
      "memory.md",
      MAX_AUTOMATION_MEMORY_BYTES,
      signal,
      true
    )) ?? "";
  const memory = parseCodexAutomationMemory(memoryContent);
  const cwd = Array.isArray(automation.cwds) ? automation.cwds[0] : null;
  const normalizedCwd = typeof cwd === "string" ? cwd : null;
  const cwdHealth = await inspectAutomationCwd(normalizedCwd, signal);

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

async function inspectAutomationCwd(cwd, signal) {
  signal?.throwIfAborted();
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
  signal?.throwIfAborted();

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
      { timeout: 5000, signal }
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
    signal?.throwIfAborted();
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

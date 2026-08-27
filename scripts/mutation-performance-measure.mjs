#!/usr/bin/env node
/**
 * Neutral mutation-performance evidence harness for CodySwannGT/lisa#3304.
 *
 * Stage 1 observes the existing public runner. It never changes production
 * workflow wiring, mutation selection, thresholds, timeout accounting,
 * concurrency, or cache trust. Hosted evidence is deliberately labelled
 * `measurement-only`; choosing an optimization is a later, evidence-gated
 * step.
 * @module scripts/mutation-performance-measure
 */
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import {
  chmodSync,
  cpSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, cpus, tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

export const MEASUREMENT_SCHEMA_VERSION = "lisa.mutation-measurement/v1";
export const BASELINE_DRAWS = Object.freeze([1, 2, 3]);
export const MEASURED_STACKS = Object.freeze(["vitest", "jest"]);
export const EXPECTED_STACKS = Object.freeze([
  "typescript",
  "nestjs",
  "cdk",
  "npm-package",
  "harper-fabric",
  "phaser",
  "expo",
  "rails",
]);
export const ARM_DEADLINE_MS = 20 * 60 * 1000;
export const MEASUREMENT_JOB_MINUTES = 50;
export const PREPARE_JOB_MINUTES = 30;
export const AGGREGATE_JOB_MINUTES = 10;
export const MAX_PARALLEL = 2;
export const HARD_BILLED_CEILING_MINUTES =
  MEASURED_STACKS.length * BASELINE_DRAWS.length * MEASUREMENT_JOB_MINUTES +
  PREPARE_JOB_MINUTES +
  AGGREGATE_JOB_MINUTES;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MEASUREMENT_ONLY = "measurement-only";
const COLD_MODE = "cold";
const WARM_MODE = "warm-local";
const PACKAGE_JSON = "package.json";
const RUNNER_PATH = "scripts/lisa-mutation.mjs";
const STRYKER_CONFIG = "stryker.conf.json";
const HOST_MANIFEST = "host-manifest.json";
const SUMMARY_JSON = "summary.json";
const PHASE_EVENTS = "phase-events.json";
const STRYKER_REPORT = "stryker-report.json";
const EFFECTIVE_CONFIG = "effective-stryker.conf.json";
const INCREMENTAL_DEFAULT = "reports/stryker-incremental.json";
const SOURCE_PATH = "src/grade.ts";
const TEST_PATH = "tests/grade.test.ts";
const execFileAsync = promisify(execFile);
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const FINAL_STATUSES = Object.freeze([
  "Killed",
  "Survived",
  "NoCoverage",
  "Timeout",
  "Ignored",
  "CompileError",
  "RuntimeError",
  "Pending",
]);
const PHASE_NAMES = Object.freeze([
  "install",
  "runner_setup",
  "instrumentation",
  "dry_run",
  "plan",
  "mutation",
  "reporting",
  "teardown",
]);
const TOP_LEVEL_KEYS = Object.freeze([
  "schema_version",
  "conclusion",
  "identity",
  "protocol",
  "selection",
  "phases_ms",
  "resources",
  "results",
  "cache",
  "cleanup",
  "digests",
]);

/** Return a SHA-256 digest for a string or buffer. */
export const sha256 = value => createHash("sha256").update(value).digest("hex");

/** Return the digest of a regular, non-symlink file. */
export function sha256File(file) {
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`evidence path is not a regular file: ${file}`);
  }
  return sha256(readFileSync(file));
}

/** Stable JSON: recursively sorted object keys, array order retained. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalJson(child)])
    );
  }
  return value;
}

const position = point =>
  `${Number(point?.line ?? 0)}:${Number(point?.column ?? 0)}`;

/**
 * Canonical mutant identity independent of Stryker's ephemeral numeric ID.
 */
export function canonicalMutantIdentity(mutant, fileName = mutant.fileName) {
  const file = String(fileName ?? mutant.file ?? "");
  const mutator = String(mutant.mutatorName ?? mutant.mutator ?? "");
  const start = position(mutant.location?.start ?? mutant.start);
  const end = position(mutant.location?.end ?? mutant.end);
  const replacement = String(mutant.replacement ?? "");
  return [file, mutator, start, end, sha256(replacement)].join("\u0000");
}

/** Produce the closed-schema mutant identity object. */
export function mutantIdentity(mutant, fileName) {
  const [file, mutator, start, end, replacement_sha256] =
    canonicalMutantIdentity(mutant, fileName).split("\u0000");
  return { file, mutator, start, end, replacement_sha256 };
}

/**
 * Add only measurement reporters to a temporary throwaway-host config.
 */
export function overlayMeasurementReporters(source, reporterPath, reportPath) {
  const reporters = [
    ...new Set([
      ...(Array.isArray(source.reporters)
        ? source.reporters.filter(
            name => name !== "html" && name !== "progress"
          )
        : []),
      "json",
      "lisa-measurement",
    ]),
  ];
  return {
    ...structuredClone(source),
    reporters,
    jsonReporter: { fileName: reportPath },
    appendPlugins: [
      ...(Array.isArray(source.appendPlugins) ? source.appendPlugins : []),
      reporterPath,
    ],
  };
}

/** Resolve an artifact path beneath its root and refuse links/escapes. */
export function resolveArtifactPath(root, relative) {
  if (!relative || path.isAbsolute(relative)) {
    throw new Error("artifact path is outside its root");
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  if (
    resolved !== resolvedRoot &&
    !resolved.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error("artifact path is outside its root");
  }
  const parent = path.dirname(resolved);
  if (
    existsSync(parent) &&
    !realpathSync(parent).startsWith(realpathSync(resolvedRoot))
  ) {
    throw new Error("artifact parent resolves outside its root");
  }
  if (existsSync(resolved) && lstatSync(resolved).isSymbolicLink()) {
    throw new Error("artifact path must not be a symlink");
  }
  return resolved;
}

/** Hash raw evidence without recursively including the digest file itself. */
export function createDigestManifest(root, relativePaths) {
  const unique = [...new Set(relativePaths)].sort();
  if (unique.includes("evidence-digests.json")) {
    throw new Error("digest manifest must not include itself");
  }
  if (unique.length > 32) throw new Error("too many evidence files");
  return Object.fromEntries(
    unique.map(relative => [
      relative,
      sha256File(resolveArtifactPath(root, relative)),
    ])
  );
}

const exactKeys = (value, expected, label, reasons) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    reasons.push(`${label} must be an object`);
    return false;
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    reasons.push(`${label} has missing or unknown fields`);
    return false;
  }
  return true;
};

const finiteNonnegative = value =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const uniqueBy = (rows, key) => new Set(rows.map(key)).size === rows.length;

const scoreWithoutTimeouts = statuses => {
  const denominator =
    statuses.Killed +
    statuses.Timeout +
    statuses.Survived +
    statuses.NoCoverage;
  return denominator === 0 ? Number.NaN : (statuses.Killed / denominator) * 100;
};

/**
 * Fail-closed semantic validator used before any draw is accepted.
 * The committed JSON schema is the exchange contract; these cross-field checks
 * cover invariants JSON Schema cannot express.
 */
export function validateMeasurement(value) {
  const reasons = [];
  if (!exactKeys(value, TOP_LEVEL_KEYS, "measurement", reasons)) {
    return { valid: false, reasons };
  }
  if (value.schema_version !== MEASUREMENT_SCHEMA_VERSION)
    reasons.push("wrong schema version");
  if (value.conclusion !== MEASUREMENT_ONLY) reasons.push("wrong conclusion");

  const identityKeys = [
    "subject_sha",
    "tree_sha",
    "package_sha256",
    "package_version",
    "stack",
    "runner_family",
    "fixture_schema",
    "fixture_sha256",
    "host_base_sha",
    "host_head_sha",
    "run_id",
    "job_id",
    "run_attempt",
    "ubuntu_image",
    "node_version",
    "bun_version",
    "npm_version",
    "stryker_version",
    "runner_version",
    "lock_sha256",
    "package_json_sha256",
    "runner_sha256",
    "raw_config_sha256",
    "effective_config_sha256",
    "gate_sha256",
    "workflow_sha256",
    "source_sha256",
    "test_sha256",
  ];
  if (exactKeys(value.identity, identityKeys, "identity", reasons)) {
    for (const key of [
      "subject_sha",
      "tree_sha",
      "host_base_sha",
      "host_head_sha",
    ])
      if (!SHA40.test(value.identity[key]))
        reasons.push(`identity.${key} is not a 40-hex SHA`);
    for (const key of identityKeys.filter(key => key.endsWith("sha256")))
      if (!SHA256.test(value.identity[key]))
        reasons.push(`identity.${key} is not SHA-256`);
    if (
      !MEASURED_STACKS.includes(value.identity.stack) ||
      value.identity.runner_family !== value.identity.stack
    )
      reasons.push("stack and runner family disagree");
  }

  const protocolKeys = [
    "role",
    "draw",
    "mode",
    "started_at",
    "finished_at",
    "invalid_reasons",
    "cold_parent_summary_sha256",
    "cold_parent_incremental_sha256",
  ];
  if (exactKeys(value.protocol, protocolKeys, "protocol", reasons)) {
    if (!BASELINE_DRAWS.includes(value.protocol.draw))
      reasons.push("draw is outside 1..3");
    if (value.protocol.invalid_reasons?.length)
      reasons.push("draw declares invalid reasons");
    if (![COLD_MODE, WARM_MODE].includes(value.protocol.mode))
      reasons.push("unknown protocol mode");
    const warm = value.protocol.mode === WARM_MODE;
    for (const key of [
      "cold_parent_summary_sha256",
      "cold_parent_incremental_sha256",
    ]) {
      const child = value.protocol[key];
      if (warm ? !SHA256.test(child ?? "") : child !== null)
        reasons.push(`${key} does not match protocol mode`);
    }
  }

  const selectionKeys = [
    "merge_base",
    "head",
    "changed_paths",
    "mutate_files",
    "tests",
    "mutants",
  ];
  if (exactKeys(value.selection, selectionKeys, "selection", reasons)) {
    if (value.selection.head !== value.identity?.host_head_sha)
      reasons.push("selection head differs from host head");
    if (value.selection.merge_base !== value.identity?.host_base_sha)
      reasons.push("selection base differs from host base");
    if (
      !value.selection.changed_paths?.length ||
      !value.selection.mutate_files?.length
    )
      reasons.push("selection is empty");
    if (
      !value.selection.tests?.length ||
      !uniqueBy(
        value.selection.tests,
        row => `${row.file}\0${row.name}\0${row.location}`
      )
    )
      reasons.push("tests are empty or duplicated");
    if (
      !value.selection.mutants?.length ||
      !uniqueBy(
        value.selection.mutants,
        row =>
          `${row.file}\0${row.mutator}\0${row.start}\0${row.end}\0${row.replacement_sha256}`
      )
    )
      reasons.push("mutants are empty or duplicated");
  }

  const phaseKeys = [...PHASE_NAMES, "end_to_end", "clock_tolerance"];
  if (exactKeys(value.phases_ms, phaseKeys, "phases_ms", reasons)) {
    if (!phaseKeys.every(key => finiteNonnegative(value.phases_ms[key])))
      reasons.push("phase values must be finite and nonnegative");
    const sum = PHASE_NAMES.reduce(
      (total, key) => total + value.phases_ms[key],
      0
    );
    if (
      Math.abs(sum - value.phases_ms.end_to_end) >
      value.phases_ms.clock_tolerance
    )
      reasons.push("phase sum differs from end-to-end");
  }

  const resourceKeys = [
    "detected_cpus",
    "peak_cpu_pct",
    "median_cpu_pct",
    "peak_rss_bytes",
    "peak_process_count",
    "sample_count",
  ];
  if (exactKeys(value.resources, resourceKeys, "resources", reasons)) {
    if (
      !Number.isInteger(value.resources.sample_count) ||
      value.resources.sample_count < 2
    )
      reasons.push("insufficient resource samples");
    if (
      !Number.isInteger(value.resources.peak_process_count) ||
      value.resources.peak_process_count < 1
    )
      reasons.push("invalid process count");
  }

  const resultKeys = [
    "statuses",
    "expected_total",
    "observed_total",
    "thresholds",
    "reported_score",
    "timeout_recomputed_score",
    "exit_code",
    "signal",
    "verdict",
    "named_survivors",
  ];
  if (exactKeys(value.results, resultKeys, "results", reasons)) {
    if (
      exactKeys(value.results.statuses, FINAL_STATUSES, "statuses", reasons)
    ) {
      if (value.results.statuses.Pending !== 0)
        reasons.push("Pending is not a final status");
      const total = FINAL_STATUSES.reduce(
        (count, status) => count + value.results.statuses[status],
        0
      );
      if (
        total !== value.results.expected_total ||
        total !== value.results.observed_total ||
        total !== value.selection?.mutants?.length
      )
        reasons.push("mutant totals do not reconcile");
      const honest = scoreWithoutTimeouts(value.results.statuses);
      if (
        Number.isFinite(honest) &&
        Math.abs(honest - value.results.timeout_recomputed_score) > 0.01
      )
        reasons.push("timeout-recomputed score disagrees");
    }
    if (value.results.signal !== null) reasons.push("signaled arm is invalid");
    const thresholdRed =
      value.results.timeout_recomputed_score < value.results.thresholds?.break;
    if ((thresholdRed ? "threshold-red" : "passed") !== value.results.verdict)
      reasons.push("threshold verdict disagrees");
    if (
      thresholdRed
        ? value.results.exit_code === 0
        : value.results.exit_code !== 0
    )
      reasons.push("exit code disagrees with threshold verdict");
  }

  const cacheKeys = [
    "incremental_configured",
    "before_exists",
    "before_sha256",
    "after_exists",
    "after_sha256",
    "cold_parent_identity",
    "disposition",
    "remote_read",
    "remote_write",
  ];
  if (exactKeys(value.cache, cacheKeys, "cache", reasons)) {
    if (value.cache.remote_read || value.cache.remote_write)
      reasons.push("remote cache is forbidden in Stage 1");
    if (
      value.protocol?.mode === COLD_MODE &&
      (value.cache.before_exists || value.cache.before_sha256 !== null)
    )
      reasons.push("cold draw had incremental residue");
    if (
      value.protocol?.mode === WARM_MODE &&
      (!value.cache.before_exists ||
        !SHA256.test(value.cache.cold_parent_identity ?? ""))
    )
      reasons.push("warm draw is not bound to its cold parent");
  }

  const cleanupKeys = [
    "root_pid",
    "root_birth_tick",
    "signal_forwarded",
    "kill_reason",
    "descendant_survivors",
    "sandbox_entries_before",
    "sandbox_entries_after",
    "sampler_healthy",
  ];
  if (exactKeys(value.cleanup, cleanupKeys, "cleanup", reasons)) {
    if (!value.cleanup.sampler_healthy) reasons.push("sampler died");
    if (value.cleanup.descendant_survivors !== 0)
      reasons.push("descendant survived cleanup");
    if (value.cleanup.sandbox_entries_after !== 0)
      reasons.push("sandbox residue remains");
    if (value.cleanup.kill_reason !== null)
      reasons.push("harness killed the arm");
  }

  const digestKeys = [
    "phase_events_sha256",
    "process_samples_sha256",
    "selection_sha256",
    "stryker_report_sha256",
    "runner_log_sha256",
    "host_manifest_sha256",
  ];
  if (exactKeys(value.digests, digestKeys, "digests", reasons)) {
    for (const key of digestKeys)
      if (!SHA256.test(value.digests[key]))
        reasons.push(`digests.${key} is not SHA-256`);
  }
  return { valid: reasons.length === 0, reasons };
}

const median = values => {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length / 2)];
};

/** Aggregate exactly three comparable cold draws per measured runner family. */
export function aggregateMeasurements(rows) {
  const cold = rows.filter(row => row.protocol?.mode === COLD_MODE);
  const seen = new Set();
  const byStack = {};
  for (const row of cold) {
    const validation = validateMeasurement(row);
    if (!validation.valid)
      throw new Error(`invalid draw: ${validation.reasons.join("; ")}`);
    const key = `${row.identity.stack}:${row.protocol.draw}`;
    if (seen.has(key)) throw new Error(`duplicate stack/draw evidence: ${key}`);
    seen.add(key);
    const stackRows = byStack[row.identity.stack] ?? [];
    stackRows.push(row);
    byStack[row.identity.stack] = stackRows;
  }
  for (const stack of MEASURED_STACKS) {
    const stackRows = byStack[stack] ?? [];
    if (stackRows.length !== BASELINE_DRAWS.length)
      throw new Error(`${stack} needs three valid cold draws`);
    const subjects = new Set(stackRows.map(row => row.identity.subject_sha));
    const selections = new Set(
      stackRows.map(row => sha256(JSON.stringify(canonicalJson(row.selection))))
    );
    const outcomes = new Set(
      stackRows.map(row => JSON.stringify(row.results.statuses))
    );
    if (subjects.size !== 1 || selections.size !== 1 || outcomes.size !== 1)
      throw new Error(`${stack} draws are not comparable`);
  }
  return {
    schema_version: "lisa.mutation-measurement-aggregate/v1",
    conclusion: MEASUREMENT_ONLY,
    dominance_established: false,
    improvement_established: false,
    hard_billed_ceiling_minutes: HARD_BILLED_CEILING_MINUTES,
    stacks: Object.fromEntries(
      MEASURED_STACKS.map(stack => [
        stack,
        {
          draws: BASELINE_DRAWS.length,
          phase_medians_ms: Object.fromEntries(
            [...PHASE_NAMES, "end_to_end"].map(phase => [
              phase,
              median(byStack[stack].map(row => row.phases_ms[phase])),
            ])
          ),
        },
      ])
    ),
  };
}

/** Validate the prepare manifest before expensive measurement jobs start. */
export function verifyPreparedManifest(manifest) {
  const reasons = [];
  if (manifest?.schema_version !== "lisa.mutation-prepared-hosts/v1")
    reasons.push("wrong prepare schema");
  if (!SHA40.test(manifest?.subject_sha ?? ""))
    reasons.push("invalid subject SHA");
  if (
    !Array.isArray(manifest?.stacks) ||
    manifest.stacks.map(row => row.stack).join("\0") !==
      EXPECTED_STACKS.join("\0")
  )
    reasons.push("stack roster differs");
  for (const row of manifest?.stacks ?? []) {
    if (!row.second_apply_idempotent)
      reasons.push(`${row.stack} second apply changed governed bytes`);
    if (row.stack === "rails" ? row.stryker_present : !row.stryker_present)
      reasons.push(`${row.stack} mutation engine parity differs`);
    if (!SHA256.test(row.governed_digest ?? ""))
      reasons.push(`${row.stack} governed digest missing`);
  }
  return { valid: reasons.length === 0, reasons };
}

const copyFixture = (name, destination) => {
  cpSync(
    path.join(ROOT, "tests/fixtures/mutation-performance", name),
    destination,
    {
      recursive: true,
      errorOnExist: false,
    }
  );
};

const readJson = file => JSON.parse(readFileSync(file, "utf8"));

const writeJson = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
};

const seedStack = (stack, host) => {
  mkdirSync(host, { recursive: true });
  if (stack === "rails") {
    copyFixture("rails", host);
    chmodSync(path.join(host, "bin/rails"), 0o755);
    return;
  }
  copyFixture(stack === "expo" ? "jest" : "vitest", host);
  const manifestPath = path.join(host, PACKAGE_JSON);
  const manifest = readJson(manifestPath);
  manifest.name = `lisa-mutation-measurement-${stack}`;
  if (stack === "nestjs") writeJson(path.join(host, "nest-cli.json"), {});
  if (stack === "cdk")
    writeJson(path.join(host, "cdk.json"), { app: "node src/grade.ts" });
  if (stack === "npm-package") {
    manifest.private = false;
    manifest.exports = "./src/grade.ts";
  }
  if (stack === "harper-fabric") {
    mkdirSync(path.join(host, "harper-app"), { recursive: true });
    writeFileSync(
      path.join(host, "harper-app/config.yaml"),
      "graphqlSchema: schema.graphql\njsResource: ../src\nstatic: ../public\n"
    );
    writeFileSync(
      path.join(host, "harper-app/schema.graphql"),
      "type Query { health: String! }\n"
    );
  }
  if (stack === "phaser") {
    manifest.dependencies = { ...manifest.dependencies, phaser: "^3.90.0" };
  }
  writeJson(manifestPath, manifest);
};

const git = async (host, args) =>
  commandOutput("git", ["-c", "commit.gpgsign=false", ...args], { cwd: host });

const initializeGit = async host => {
  await git(host, ["init", "--initial-branch=main"]);
  await git(host, ["config", "user.email", "measurement@example.invalid"]);
  await git(host, ["config", "user.name", "Lisa measurement"]);
  await git(host, ["add", "-A"]);
  await git(host, ["commit", "-m", "fixture: initial detector seed"]);
};

const applyExactPackage = async ({ entry, host, fakeBin, marker }) => {
  await execFileAsync(
    process.execPath,
    [entry, "apply", host, "--yes", "--no-update-check", "--harness=cursor"],
    {
      cwd: host,
      env: {
        ...process.env,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
        LISA_MEASURE_GH_MARKER: marker,
        LISA_BOOTSTRAP: "1",
        CI: "1",
      },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }
  );
};

const GOVERNED_PATHS = Object.freeze([
  PACKAGE_JSON,
  ".github/workflows/ci.yml",
  RUNNER_PATH,
  "scripts/lisa-mutation.sh",
  STRYKER_CONFIG,
  "mutation.gate.json",
  "mutation.gate.yml",
]);

const governedSnapshot = host =>
  Object.fromEntries(
    GOVERNED_PATHS.filter(relative =>
      existsSync(path.join(host, relative))
    ).map(relative => [relative, sha256File(path.join(host, relative))])
  );

const governedDigest = snapshot =>
  sha256(JSON.stringify(canonicalJson(snapshot)));

const expectedDirectType = stack => stack;

const expectedExpandedTypes = stack => {
  if (stack === "rails") return ["rails"];
  if (stack === "typescript") return ["typescript"];
  return ["typescript", stack];
};

const detectTypes = async (detectionEntry, host) => {
  const { DetectorRegistry } = await import(pathToFileURL(detectionEntry).href);
  const registry = new DetectorRegistry();
  const direct = await registry.detectAll(host);
  return { direct, expanded: registry.expandAndOrderTypes(direct) };
};

const removeMeasurementResidue = host => {
  for (const relative of [
    "node_modules",
    "reports",
    ".stryker-tmp",
    "coverage",
    "dist",
  ]) {
    rmSync(path.join(host, relative), { recursive: true, force: true });
  }
};

const wait = milliseconds =>
  new Promise(resolve => setTimeout(resolve, milliseconds));

const parseProcStat = pid => {
  const body = readFileSync(`/proc/${pid}/stat`, "utf8");
  const match = body.match(/^(\d+) \((.*)\) (\S) (.*)$/u);
  if (!match) throw new Error(`unparseable /proc stat for ${pid}`);
  const fields = match[4].split(" ");
  return {
    pid: Number(match[1]),
    comm: match[2],
    ppid: Number(fields[0]),
    cpu_ticks: Number(fields[10]) + Number(fields[11]),
    start_tick: fields[18],
    rss_bytes: Math.max(0, Number(fields[20])) * 4096,
  };
};

const allProcRows = () => {
  if (process.platform !== "linux" || !existsSync("/proc")) {
    throw new Error(
      "mutation measurement process sampling requires ubuntu/Linux /proc"
    );
  }
  const rows = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/u.test(entry)) continue;
    try {
      rows.push(parseProcStat(Number(entry)));
    } catch {
      /* process exited */
    }
  }
  return rows;
};

const descendantsOf = (rootPid, all) => {
  const selected = new Map();
  let frontier = [{ pid: rootPid, depth: 0 }];
  const byParent = new Map();
  for (const row of all)
    (byParent.get(row.ppid) ?? byParent.set(row.ppid, []).get(row.ppid)).push(
      row
    );
  const byPid = new Map(all.map(row => [row.pid, row]));
  while (frontier.length) {
    const next = [];
    for (const item of frontier) {
      const row = byPid.get(item.pid);
      if (row && !selected.has(row.pid))
        selected.set(row.pid, { ...row, depth: item.depth });
      for (const child of byParent.get(item.pid) ?? []) {
        if (!selected.has(child.pid))
          next.push({ pid: child.pid, depth: item.depth + 1 });
      }
    }
    frontier = next;
  }
  return [...selected.values()];
};

const liveTracked = tracked => {
  const live = [];
  for (const saved of tracked.values()) {
    try {
      const current = parseProcStat(saved.pid);
      if (current.start_tick === saved.start_tick)
        live.push({ ...current, depth: saved.depth });
    } catch {
      /* exited */
    }
  }
  return live;
};

const signalTracked = (rows, signal) => {
  for (const row of [...rows].sort((left, right) => right.depth - left.depth)) {
    try {
      process.kill(row.pid, signal);
    } catch {
      /* exited */
    }
  }
};

/**
 * Run the public mutation entrypoint asynchronously while sampling and reaping
 * only its PID-birth-bound process tree.
 */
export async function runObservedCommand({
  cwd,
  args,
  output,
  env = {},
  deadlineMs = ARM_DEADLINE_MS,
}) {
  if (process.platform !== "linux")
    throw new Error("hosted measurement must run on ubuntu/Linux");
  mkdirSync(output, { recursive: true });
  const logPath = path.join(output, "runner.log");
  const samplesPath = path.join(output, "process-samples.jsonl");
  const log = createWriteStream(logPath, { flags: "wx", mode: 0o600 });
  const started = Date.now();
  const child = spawn(process.execPath, args, {
    cwd,
    detached: true,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const tracked = new Map();
  const samples = [];
  let samplerHealthy = true;
  let samplerError = null;
  let killReason = null;
  let signalForwarded = null;
  let previous = new Map();
  const clockTicks = Number(await commandOutput("getconf", ["CLK_TCK"]));
  const capture = () => {
    try {
      const rows = descendantsOf(child.pid, allProcRows());
      if (rows.length > 64)
        throw new Error("process tree exceeded 64 descendants");
      for (const row of rows) tracked.set(row.pid, row);
      const now = Date.now();
      const elapsed = Math.max(
        1,
        now - (samples.at(-1)?.timestamp_ms ?? started)
      );
      const processes = rows.map(row => {
        const prior = previous.get(row.pid);
        const ticks =
          prior?.start_tick === row.start_tick
            ? Math.max(0, row.cpu_ticks - prior.cpu_ticks)
            : 0;
        return {
          pid: row.pid,
          ppid: row.ppid,
          start_tick: row.start_tick,
          comm: row.comm,
          cpu_pct: (ticks / clockTicks / (elapsed / 1000)) * 100,
          rss_bytes: row.rss_bytes,
        };
      });
      previous = new Map(rows.map(row => [row.pid, row]));
      if (processes.length)
        samples.push({
          timestamp_ms: now,
          elapsed_ms: now - started,
          processes,
        });
      if (samples.length > 2400)
        throw new Error("process sampler exceeded its row bound");
    } catch (error) {
      samplerHealthy = false;
      samplerError = error;
    }
  };
  capture();
  const interval = setInterval(capture, 1000);
  const forward = signal => {
    signalForwarded = signal;
    try {
      process.kill(-child.pid, signal);
    } catch {
      /* exited */
    }
  };
  const signalHandlers = Object.fromEntries(
    ["SIGINT", "SIGTERM", "SIGHUP"].map(signal => [
      signal,
      () => forward(signal),
    ])
  );
  for (const [signal, handler] of Object.entries(signalHandlers))
    process.once(signal, handler);
  const deadline = setTimeout(() => {
    killReason = "harness-deadline";
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* exited */
    }
  }, deadlineMs);
  let exitCode = null;
  let exitSignal = null;
  try {
    ({ code: exitCode, signal: exitSignal } = await new Promise(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal }));
      }
    ));
  } finally {
    clearInterval(interval);
    clearTimeout(deadline);
    for (const [signal, handler] of Object.entries(signalHandlers))
      process.removeListener(signal, handler);
    capture();
    const stillLive = liveTracked(tracked);
    if (stillLive.length) {
      signalTracked(stillLive, "SIGTERM");
      await wait(5000);
      signalTracked(liveTracked(tracked), "SIGKILL");
      await wait(100);
    }
    await new Promise(resolve => log.end(resolve));
  }
  const survivors = liveTracked(tracked);
  const processRows = samples.flatMap(sample => sample.processes);
  writeFileSync(
    samplesPath,
    `${samples.map(sample => JSON.stringify(sample)).join("\n")}\n`,
    { flag: "wx", mode: 0o600 }
  );
  if (samplerError) {
    writeFileSync(
      path.join(output, "sampler-error.txt"),
      `${String(samplerError)}\n`,
      { mode: 0o600 }
    );
  }
  const cpuTotals = samples.map(sample =>
    sample.processes.reduce((total, row) => total + row.cpu_pct, 0)
  );
  const rssTotals = samples.map(sample =>
    sample.processes.reduce((total, row) => total + row.rss_bytes, 0)
  );
  const counts = samples.map(sample => sample.processes.length);
  const root = tracked.get(child.pid);
  return {
    started_at_ms: started,
    finished_at_ms: Date.now(),
    exit_code: exitCode,
    signal: exitSignal,
    resources: {
      detected_cpus: availableParallelism?.() ?? cpus().length,
      peak_cpu_pct: Math.max(0, ...cpuTotals),
      median_cpu_pct: cpuTotals.length ? median(cpuTotals) : 0,
      peak_rss_bytes: Math.max(0, ...rssTotals),
      peak_process_count: Math.max(0, ...counts),
      sample_count: samples.length,
    },
    cleanup: {
      root_pid: child.pid,
      root_birth_tick: root?.start_tick ?? "missing",
      signal_forwarded: signalForwarded,
      kill_reason: killReason,
      descendant_survivors: survivors.length,
      sampler_healthy: samplerHealthy,
    },
    log_path: logPath,
    samples_path: samplesPath,
    tracked_process_rows: processRows.length,
  };
}

const prepareMeasuredHistory = async host => {
  await commandOutput("bun", ["install", "--ignore-scripts"], {
    cwd: host,
    env: { ...process.env, CI: "1" },
    timeout: 12 * 60 * 1000,
  });
  removeMeasurementResidue(host);
  await git(host, ["add", "-A"]);
  const pending = await git(host, ["status", "--porcelain"]);
  if (pending)
    await git(host, ["commit", "-m", "fixture: lock exact measurement inputs"]);
  const base = await git(host, ["rev-parse", "HEAD"]);
  const source = path.join(host, SOURCE_PATH);
  writeFileSync(
    source,
    `${readFileSync(source, "utf8").trimEnd()}\n// measurement head selects this governed source\n`
  );
  await git(host, ["add", SOURCE_PATH]);
  await git(host, [
    "commit",
    "-m",
    "fixture: select the mutation-eligible source",
  ]);
  return { base, head: await git(host, ["rev-parse", "HEAD"]) };
};

/** Materialize and twice-apply exact packed hosts for the hosted protocol. */
export async function prepareHosts(options) {
  const subjectSha = String(options.subject_sha ?? "");
  if (!SHA40.test(subjectSha))
    throw new Error("subject SHA must be exactly 40 lowercase hex characters");
  const liveHead = await commandOutput("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
  });
  if (liveHead !== subjectSha)
    throw new Error(
      `checked-out head ${liveHead} differs from subject ${subjectSha}`
    );
  const output = path.resolve(String(options.output));
  if (output === ROOT || output.startsWith(`${ROOT}${path.sep}`))
    throw new Error("prepared hosts must live outside the repository");
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });

  const tarball = path.resolve(String(options.tarball));
  if (!existsSync(tarball) || !lstatSync(tarball).isFile())
    throw new Error("exact package tarball is missing");
  const packageSha = sha256File(tarball);
  const toolRoot = path.join(output, "tool");
  mkdirSync(toolRoot, { recursive: true });
  await commandOutput(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--prefix",
      toolRoot,
      tarball,
    ],
    {
      cwd: output,
      timeout: 8 * 60 * 1000,
    }
  );
  const installedRoot = path.join(toolRoot, "node_modules/@codyswann/lisa");
  const entry = path.join(installedRoot, "dist/index.js");
  const detectionEntry = path.join(installedRoot, "dist/detection/index.js");
  if (!existsSync(entry) || !existsSync(detectionEntry))
    throw new Error("packed Lisa entrypoints are missing");
  const installedManifest = readJson(path.join(installedRoot, PACKAGE_JSON));

  const fakeBin = path.join(output, "fake-bin");
  mkdirSync(fakeBin, { recursive: true });
  const marker = path.join(output, "gh-called");
  const fakeGh = path.join(fakeBin, "gh");
  writeFileSync(fakeGh, '#!/bin/sh\n: > "$LISA_MEASURE_GH_MARKER"\nexit 99\n', {
    mode: 0o700,
  });

  const working = path.join(output, "working");
  const archives = path.join(output, "hosts");
  mkdirSync(working, { recursive: true });
  mkdirSync(archives, { recursive: true });
  const rows = [];
  for (const stack of EXPECTED_STACKS) {
    const host = path.join(working, stack);
    seedStack(stack, host);
    await initializeGit(host);
    const detected = await detectTypes(detectionEntry, host);
    if (!detected.direct.includes(expectedDirectType(stack))) {
      throw new Error(
        `${stack} detector did not fire: ${detected.direct.join(", ")}`
      );
    }
    if (
      JSON.stringify(detected.expanded) !==
      JSON.stringify(expectedExpandedTypes(stack))
    ) {
      throw new Error(
        `${stack} expanded detection differs: ${detected.expanded.join(", ")}`
      );
    }
    await applyExactPackage({ entry, host, fakeBin, marker });
    const first = governedSnapshot(host);
    await git(host, ["add", "-A"]);
    await git(host, ["commit", "-m", "fixture: apply exact packed Lisa"]);
    await applyExactPackage({ entry, host, fakeBin, marker });
    const second = governedSnapshot(host);
    const idempotent = JSON.stringify(first) === JSON.stringify(second);
    if (!idempotent)
      throw new Error(
        `${stack} changed governed mutation bytes on second apply`
      );

    const strykerPresent = existsSync(path.join(host, STRYKER_CONFIG));
    if (stack === "rails" ? strykerPresent : !strykerPresent)
      throw new Error(`${stack} received the wrong mutation engine`);
    let history = null;
    if (stack === "typescript" || stack === "expo") {
      history = await prepareMeasuredHistory(host);
      const archiveStack = stack === "expo" ? "jest" : "vitest";
      const archive = path.join(archives, `${archiveStack}.tar.gz`);
      await commandOutput("tar", ["-czf", archive, "-C", working, stack], {
        cwd: output,
      });
    }
    rows.push({
      stack,
      detected_types: detected.expanded,
      second_apply_idempotent: idempotent,
      stryker_present: strykerPresent,
      governed_digest: governedDigest(second),
      canonical_runner_sha256:
        second[RUNNER_PATH] ?? second["scripts/lisa-mutation.sh"],
      host_base_sha: history?.base ?? null,
      host_head_sha: history?.head ?? null,
    });
  }
  if (existsSync(marker))
    throw new Error(
      "packed apply attempted to invoke GitHub repository tooling"
    );
  const manifest = {
    schema_version: "lisa.mutation-prepared-hosts/v1",
    subject_sha: subjectSha,
    tree_sha: await commandOutput("git", ["rev-parse", "HEAD^{tree}"], {
      cwd: ROOT,
    }),
    package_version: installedManifest.version,
    package_sha256: packageSha,
    fixture_schema: "fixture/v1",
    fixture_sha256: sha256(
      JSON.stringify(
        canonicalJson(
          rows.map(({ stack, detected_types, governed_digest }) => ({
            stack,
            detected_types,
            governed_digest,
          }))
        )
      )
    ),
    stacks: rows,
  };
  const verdict = verifyPreparedManifest(manifest);
  if (!verdict.valid) throw new Error(verdict.reasons.join("; "));
  atomicJson(path.join(output, HOST_MANIFEST), manifest);
  rmSync(working, { recursive: true, force: true });
  rmSync(toolRoot, { recursive: true, force: true });
  rmSync(fakeBin, { recursive: true, force: true });
  return manifest;
}

const listSandboxEntries = host => {
  const root = path.join(host, ".stryker-tmp");
  return existsSync(root) ? readdirSync(root).length : 0;
};

const elapsed = (later, earlier) =>
  Math.max(0, Date.parse(later) - Date.parse(earlier));

const versionOf = (host, packageName) =>
  readJson(path.join(host, "node_modules", packageName, PACKAGE_JSON)).version;

const relativeHostPath = (host, file) => {
  const relative = path.relative(host, file);
  return relative.startsWith("..")
    ? String(file)
    : relative.replaceAll(path.sep, "/");
};

const reportMutants = report =>
  Object.entries(report.files ?? {}).flatMap(([file, detail]) =>
    (detail.mutants ?? []).map(mutant => ({ file, mutant }))
  );

const statusTally = mutants => {
  const statuses = Object.fromEntries(
    FINAL_STATUSES.map(status => [status, 0])
  );
  for (const { mutant } of mutants) {
    if (!Object.hasOwn(statuses, mutant.status))
      throw new Error(`unknown mutant status: ${mutant.status}`);
    statuses[mutant.status] += 1;
  }
  return statuses;
};

const scoreReportedByStryker = statuses => {
  const denominator =
    statuses.Killed +
    statuses.Timeout +
    statuses.Survived +
    statuses.NoCoverage;
  return denominator === 0
    ? Number.NaN
    : ((statuses.Killed + statuses.Timeout) / denominator) * 100;
};

const phaseBreakdown = ({ installMs, observed, events }) => {
  const runnerStarted = new Date(observed.started_at_ms).toISOString();
  const runnerFinished = new Date(observed.finished_at_ms).toISOString();
  const dry = Number(events.dry_run_ms);
  const runnerSetup = elapsed(events.started_at, runnerStarted);
  const instrumentation = Math.max(
    0,
    elapsed(events.dry_run_at, events.started_at) - dry
  );
  const plan = elapsed(events.plan_ready_at, events.dry_run_at);
  const mutation = elapsed(events.report_ready_at, events.plan_ready_at);
  const reporting = elapsed(events.finished_at, events.report_ready_at);
  const teardown = elapsed(runnerFinished, events.finished_at);
  const phases = {
    install: installMs,
    runner_setup: runnerSetup,
    instrumentation,
    dry_run: dry,
    plan,
    mutation,
    reporting,
    teardown,
  };
  return {
    ...phases,
    end_to_end: Object.values(phases).reduce(
      (total, value) => total + value,
      0
    ),
    clock_tolerance: 0,
  };
};

const assertArtifactBounds = root => {
  const limits = {
    "runner.log": 64 * 1024 * 1024,
    "stryker-report.json": 64 * 1024 * 1024,
    "process-samples.jsonl": 64 * 1024 * 1024,
  };
  let total = 0;
  for (const entry of readdirSync(root)) {
    const file = resolveArtifactPath(root, entry);
    const info = lstatSync(file);
    if (!info.isFile())
      throw new Error(`artifact entry is not a regular file: ${entry}`);
    total += info.size;
    if (limits[entry] !== undefined && info.size > limits[entry])
      throw new Error(`${entry} exceeds its evidence bound`);
  }
  if (total > 128 * 1024 * 1024)
    throw new Error("draw evidence exceeds 128 MiB");
};

const selectionFrom = async ({ host, report, events, base, head }) => {
  const changed = (
    await commandOutput("git", ["diff", "--name-only", `${base}..${head}`], {
      cwd: host,
    })
  )
    .split("\n")
    .filter(Boolean)
    .sort();
  const mutants = reportMutants(report);
  return {
    merge_base: base,
    head,
    changed_paths: changed,
    mutate_files: [...new Set(mutants.map(row => row.file))].sort(),
    tests: (events.tests ?? [])
      .map(test => ({
        file: relativeHostPath(host, test.file),
        name: String(test.name),
        location: String(test.location),
      }))
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right))
      ),
    mutants: mutants
      .map(({ file, mutant }) => mutantIdentity(mutant, file))
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right))
      ),
  };
};

const writeDrawEvidence = async ({
  armOutput,
  host,
  stack,
  draw,
  role,
  subjectSha,
  manifest,
  stackManifest,
  rawConfig,
  effectiveConfig,
  installMs,
  journeyStarted,
  observed,
  cacheBefore,
  cacheAfter,
  coldParent,
}) => {
  const phasePath = path.join(armOutput, PHASE_EVENTS);
  const reportPath = path.join(armOutput, STRYKER_REPORT);
  if (!existsSync(phasePath) || !existsSync(reportPath))
    throw new Error("runner omitted required phase or JSON report evidence");
  const events = readJson(phasePath);
  const report = readJson(reportPath);
  const selection = await selectionFrom({
    host,
    report,
    events,
    base: stackManifest.host_base_sha,
    head: stackManifest.host_head_sha,
  });
  atomicJson(path.join(armOutput, "selection.json"), selection);
  atomicJson(path.join(armOutput, EFFECTIVE_CONFIG), effectiveConfig);
  atomicJson(path.join(armOutput, "raw-stryker.conf.json"), rawConfig);
  atomicJson(path.join(armOutput, HOST_MANIFEST), manifest);

  const mutants = reportMutants(report);
  const statuses = statusTally(mutants);
  const reportedScore = scoreReportedByStryker(statuses);
  const honestScore = scoreWithoutTimeouts(statuses);
  if (!Number.isFinite(reportedScore) || !Number.isFinite(honestScore))
    throw new Error("mutation score is not measurable");
  const thresholds = report.thresholds ?? effectiveConfig.thresholds;
  const verdict = honestScore < thresholds.break ? "threshold-red" : "passed";
  const incrementalConfigured = effectiveConfig.incremental === true;
  const mode = coldParent ? WARM_MODE : COLD_MODE;
  const runnerPackage =
    stack === "vitest"
      ? "@stryker-mutator/vitest-runner"
      : "@stryker-mutator/jest-runner";
  const lockFile = existsSync(path.join(host, "bun.lock"))
    ? "bun.lock"
    : "package-lock.json";
  const rawFiles = [
    PHASE_EVENTS,
    "process-samples.jsonl",
    "selection.json",
    EFFECTIVE_CONFIG,
    "raw-stryker.conf.json",
    STRYKER_REPORT,
    "runner.log",
    HOST_MANIFEST,
  ];
  const rawDigests = createDigestManifest(armOutput, rawFiles);
  const summary = {
    schema_version: MEASUREMENT_SCHEMA_VERSION,
    conclusion: MEASUREMENT_ONLY,
    identity: {
      subject_sha: subjectSha,
      tree_sha: manifest.tree_sha,
      package_sha256: manifest.package_sha256,
      package_version: manifest.package_version,
      stack,
      runner_family: stack,
      fixture_schema: manifest.fixture_schema,
      fixture_sha256: manifest.fixture_sha256,
      host_base_sha: stackManifest.host_base_sha,
      host_head_sha: stackManifest.host_head_sha,
      run_id: process.env.GITHUB_RUN_ID ?? "0",
      job_id: process.env.GITHUB_JOB ?? `${stack}-${draw}`,
      run_attempt: Number(process.env.GITHUB_RUN_ATTEMPT ?? 1),
      ubuntu_image: process.env.ImageOS ?? process.platform,
      node_version: process.version.replace(/^v/u, ""),
      bun_version: await commandOutput("bun", ["--version"]),
      npm_version: await commandOutput("npm", ["--version"]),
      stryker_version: versionOf(host, "@stryker-mutator/core"),
      runner_version: versionOf(host, runnerPackage),
      lock_sha256: sha256File(path.join(host, lockFile)),
      package_json_sha256: sha256File(path.join(host, PACKAGE_JSON)),
      runner_sha256: sha256File(path.join(host, RUNNER_PATH)),
      raw_config_sha256: sha256(`${JSON.stringify(rawConfig, null, 2)}\n`),
      effective_config_sha256: sha256File(
        path.join(armOutput, EFFECTIVE_CONFIG)
      ),
      gate_sha256: sha256File(path.join(host, "mutation.gate.json")),
      workflow_sha256: sha256File(
        path.join(ROOT, ".github/workflows/mutation-performance-baseline.yml")
      ),
      source_sha256: sha256File(path.join(host, SOURCE_PATH)),
      test_sha256: sha256File(path.join(host, TEST_PATH)),
    },
    protocol: {
      role,
      draw: Number(draw),
      mode,
      started_at: new Date(journeyStarted).toISOString(),
      finished_at: new Date(observed.finished_at_ms).toISOString(),
      invalid_reasons: [],
      cold_parent_summary_sha256: coldParent?.summary_sha256 ?? null,
      cold_parent_incremental_sha256: coldParent?.incremental_sha256 ?? null,
    },
    selection,
    phases_ms: phaseBreakdown({ installMs, observed, events }),
    resources: observed.resources,
    results: {
      statuses,
      expected_total: Number(events.plan_count),
      observed_total: mutants.length,
      thresholds: {
        high: Number(thresholds.high),
        low: Number(thresholds.low),
        break: Number(thresholds.break),
      },
      reported_score: reportedScore,
      timeout_recomputed_score: honestScore,
      exit_code: observed.exit_code,
      signal: observed.signal,
      verdict,
      named_survivors: mutants
        .filter(({ mutant }) => mutant.status === "Survived")
        .map(({ file, mutant }) => canonicalMutantIdentity(mutant, file)),
    },
    cache: {
      incremental_configured: incrementalConfigured,
      before_exists: cacheBefore !== null,
      before_sha256: cacheBefore,
      after_exists: cacheAfter !== null,
      after_sha256: cacheAfter,
      cold_parent_identity: coldParent?.summary_sha256 ?? null,
      disposition: coldParent ? "diagnostic-local-reuse" : "cold-empty",
      remote_read: false,
      remote_write: false,
    },
    cleanup: {
      root_pid: observed.cleanup.root_pid,
      root_birth_tick: observed.cleanup.root_birth_tick,
      signal_forwarded: observed.cleanup.signal_forwarded,
      kill_reason: observed.cleanup.kill_reason,
      descendant_survivors: observed.cleanup.descendant_survivors,
      sandbox_entries_before: observed.sandbox_before,
      sandbox_entries_after: observed.sandbox_after,
      sampler_healthy: observed.cleanup.sampler_healthy,
    },
    digests: {
      phase_events_sha256: rawDigests[PHASE_EVENTS],
      process_samples_sha256: rawDigests["process-samples.jsonl"],
      selection_sha256: rawDigests["selection.json"],
      stryker_report_sha256: rawDigests[STRYKER_REPORT],
      runner_log_sha256: rawDigests["runner.log"],
      host_manifest_sha256: rawDigests[HOST_MANIFEST],
    },
  };
  const validation = validateMeasurement(summary);
  if (!validation.valid)
    throw new Error(
      `invalid ${mode} evidence: ${validation.reasons.join("; ")}`
    );
  atomicJson(path.join(armOutput, SUMMARY_JSON), summary);
  assertArtifactBounds(armOutput);
  const sums = createDigestManifest(armOutput, [...rawFiles, SUMMARY_JSON]);
  atomicJson(path.join(armOutput, "sha256sums.json"), sums);
  return {
    summary,
    summary_sha256: sha256File(path.join(armOutput, SUMMARY_JSON)),
  };
};

const runArm = async ({
  host,
  armOutput,
  stack,
  draw,
  role,
  subjectSha,
  manifest,
  stackManifest,
  rawConfig,
  installMs,
  journeyStarted,
  coldParent,
}) => {
  mkdirSync(armOutput, { recursive: true });
  const reportPath = path.join(armOutput, STRYKER_REPORT);
  const reporterCopy = path.join(
    host,
    ".lisa-measurement",
    "mutation-performance-reporter.mjs"
  );
  mkdirSync(path.dirname(reporterCopy), { recursive: true });
  cpSync(
    path.join(ROOT, "scripts/lib/mutation-performance-reporter.mjs"),
    reporterCopy
  );
  const effectiveConfig = overlayMeasurementReporters(
    rawConfig,
    reporterCopy,
    reportPath
  );
  writeJson(path.join(host, STRYKER_CONFIG), effectiveConfig);
  const incrementalPath = path.join(
    host,
    effectiveConfig.incrementalFile ?? INCREMENTAL_DEFAULT
  );
  const cacheBefore = existsSync(incrementalPath)
    ? sha256File(incrementalPath)
    : null;
  if (!coldParent && cacheBefore !== null)
    throw new Error("cold draw starts with incremental residue");
  const sandboxBefore = listSandboxEntries(host);
  const observed = await runObservedCommand({
    cwd: host,
    args: [path.join(host, RUNNER_PATH)],
    output: armOutput,
    env: {
      CI: "1",
      MUTATION_SINCE: "HEAD^",
      LISA_MUTATION_PHASE_EVENTS: path.join(armOutput, PHASE_EVENTS),
      NODE_OPTIONS: "--max-old-space-size=6144",
    },
  });
  observed.sandbox_before = sandboxBefore;
  observed.sandbox_after = listSandboxEntries(host);
  const cacheAfter = existsSync(incrementalPath)
    ? sha256File(incrementalPath)
    : null;
  if (effectiveConfig.incremental === true && cacheAfter === null)
    throw new Error("incremental run omitted local evidence");
  return writeDrawEvidence({
    armOutput,
    host,
    stack,
    draw,
    role,
    subjectSha,
    manifest,
    stackManifest,
    rawConfig,
    effectiveConfig,
    installMs,
    journeyStarted,
    observed,
    cacheBefore,
    cacheAfter,
    coldParent,
  });
};

const compareColdWarm = (cold, warm) => {
  const coldSelection = sha256(JSON.stringify(canonicalJson(cold.selection)));
  const warmSelection = sha256(JSON.stringify(canonicalJson(warm.selection)));
  if (coldSelection !== warmSelection)
    throw new Error("warm selection differs from its cold parent");
  if (
    JSON.stringify(cold.results.statuses) !==
    JSON.stringify(warm.results.statuses)
  )
    throw new Error("warm outcomes differ from its cold parent");
  if (cold.results.verdict !== warm.results.verdict)
    throw new Error("warm threshold verdict differs from its cold parent");
  if (
    warm.protocol.cold_parent_summary_sha256 !==
    sha256(`${JSON.stringify(cold, null, 2)}\n`)
  ) {
    throw new Error("warm evidence is not bound to the exact cold summary");
  }
};

/** Extract a fresh prepared host and collect cold plus local-warm evidence. */
export async function runJourney(options) {
  if (process.platform !== "linux")
    throw new Error("hosted measurement must run on ubuntu/Linux");
  const subjectSha = String(options.subject_sha ?? "");
  const stack = String(options.stack ?? "");
  const draw = Number(options.draw);
  const role = String(options.role ?? "baseline");
  if (
    !SHA40.test(subjectSha) ||
    !MEASURED_STACKS.includes(stack) ||
    !BASELINE_DRAWS.includes(draw)
  )
    throw new Error("invalid measurement identity");
  const prepared = path.resolve(String(options.prepared));
  const output = path.resolve(String(options.output));
  if (output === ROOT || output.startsWith(`${ROOT}${path.sep}`))
    throw new Error("draw evidence must live outside the repository");
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  const manifestPath = path.join(prepared, HOST_MANIFEST);
  const manifest = readJson(manifestPath);
  const prepareVerdict = verifyPreparedManifest(manifest);
  if (!prepareVerdict.valid || manifest.subject_sha !== subjectSha)
    throw new Error(
      `prepared-host identity invalid: ${prepareVerdict.reasons.join("; ")}`
    );
  const preparedStack = stack === "vitest" ? "typescript" : "expo";
  const stackManifest = manifest.stacks.find(
    row => row.stack === preparedStack
  );
  if (!stackManifest?.host_base_sha || !stackManifest?.host_head_sha)
    throw new Error("measured host history is absent");
  const journey = mkdtempSync(
    path.join(tmpdir(), `lisa-mutation-${stack}-${draw}-`)
  );
  const archive = path.join(prepared, "hosts", `${stack}.tar.gz`);
  if (!existsSync(archive))
    throw new Error(`prepared ${stack} archive is missing`);
  try {
    await commandOutput("tar", ["-xzf", archive, "-C", journey]);
    const host = path.join(journey, preparedStack);
    if (existsSync(path.join(host, "node_modules")))
      throw new Error(
        "prepared host contains node_modules before cold install"
      );
    if (existsSync(path.join(host, INCREMENTAL_DEFAULT)))
      throw new Error("prepared host contains incremental residue");
    const journeyStarted = Date.now();
    const installStarted = Date.now();
    const install = await execFileAsync(
      "bun",
      ["install", "--frozen-lockfile"],
      {
        cwd: host,
        env: { ...process.env, CI: "1" },
        timeout: 15 * 60 * 1000,
        maxBuffer: 64 * 1024 * 1024,
        encoding: "utf8",
      }
    );
    const installMs = Date.now() - installStarted;
    writeFileSync(
      path.join(output, "install.log"),
      `${install.stdout}${install.stderr}`,
      { mode: 0o600 }
    );
    const rawConfig = readJson(path.join(host, STRYKER_CONFIG));
    const coldResult = await runArm({
      host,
      armOutput: path.join(output, "cold"),
      stack,
      draw,
      role,
      subjectSha,
      manifest,
      stackManifest,
      rawConfig,
      installMs,
      journeyStarted,
      coldParent: null,
    });
    const incrementalPath = path.join(
      host,
      rawConfig.incrementalFile ?? INCREMENTAL_DEFAULT
    );
    const warmResult = await runArm({
      host,
      armOutput: path.join(output, "warm"),
      stack,
      draw,
      role,
      subjectSha,
      manifest,
      stackManifest,
      rawConfig,
      installMs: 0,
      journeyStarted: Date.now(),
      coldParent: {
        summary_sha256: coldResult.summary_sha256,
        incremental_sha256: sha256File(incrementalPath),
      },
    });
    compareColdWarm(coldResult.summary, warmResult.summary);
    atomicJson(path.join(output, "comparison.json"), {
      schema_version: "lisa.mutation-cold-warm-comparison/v1",
      conclusion: MEASUREMENT_ONLY,
      stack,
      draw,
      subject_sha: subjectSha,
      selection_sha256: sha256(
        JSON.stringify(canonicalJson(coldResult.summary.selection))
      ),
      outcomes_sha256: sha256(
        JSON.stringify(coldResult.summary.results.statuses)
      ),
      verdict: coldResult.summary.results.verdict,
      cold_summary_sha256: coldResult.summary_sha256,
      warm_summary_sha256: warmResult.summary_sha256,
    });
    return { cold: coldResult.summary, warm: warmResult.summary };
  } finally {
    rmSync(journey, { recursive: true, force: true });
  }
}

const parseArgs = argv => {
  const [command, ...rest] = argv;
  const options = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--"))
      throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2).replaceAll("-", "_");
    const next = rest[index + 1];
    if (next === undefined || next.startsWith("--")) options[key] = true;
    else {
      options[key] = next;
      index += 1;
    }
  }
  return options;
};

const atomicJson = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  renameSync(temporary, file);
};

const commandOutput = async (command, args, options = {}) => {
  const result = await execFileAsync(command, args, {
    maxBuffer: 32 * 1024 * 1024,
    encoding: "utf8",
    ...options,
  });
  return result.stdout.trim();
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "aggregate") {
    const root = path.resolve(String(options.input));
    const rows = [];
    for (const entry of readdirSync(root, { recursive: true })) {
      if (
        String(entry).split(path.sep).at(-2) === "cold" &&
        String(entry).endsWith(SUMMARY_JSON)
      ) {
        rows.push(
          JSON.parse(readFileSync(path.join(root, String(entry)), "utf8"))
        );
      }
    }
    const aggregate = aggregateMeasurements(rows);
    atomicJson(path.resolve(String(options.output)), aggregate);
    return;
  }
  if (options.command === "verify") {
    const value = JSON.parse(
      readFileSync(path.resolve(String(options.input)), "utf8")
    );
    const verdict = validateMeasurement(value);
    if (!verdict.valid) throw new Error(verdict.reasons.join("; "));
    return;
  }
  if (options.command === "prepare") {
    await prepareHosts(options);
    return;
  }
  if (options.command === "run") {
    await runJourney(options);
    return;
  }
  throw new Error(
    "usage: mutation-performance-measure.mjs <prepare|run|aggregate|verify>"
  );
};

if (invokedAsScript(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(
      `${error instanceof Error ? error.stack : String(error)}\n`
    );
    process.exitCode = 1;
  });
}

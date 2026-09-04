#!/usr/bin/env node
/**
 * Bounded two-snapshot measurement of platform temp-directory growth.
 *
 * A total cannot reveal rate, and a net delta can hide equal creation and
 * removal. This command persists the latest two complete name sets, reports
 * exact created/removed/unreclaimed counts and entries/day, and fails when a
 * newly-created direct CDK/Lisa entry or unowned Lisa namespace child appears.
 * @module scripts/measure-tmpdir-growth
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

export const TMPDIR_GROWTH_SCHEMA_VERSION = 1;
export const TMPDIR_GROUPING_VERSION = "mkdtemp-prefix-v1";
/** Default local evidence path, exported so ignored/untracked policy is testable. */
export const DEFAULT_TMPDIR_GROWTH_ARTIFACT = ".lisa/tmpdir-growth.json";
export const MAX_TMPDIR_ENTRIES = 200_000;
export const MAX_TMPDIR_NAME_BYTES = 1_024;
export const MAX_NAMESPACE_ENTRIES = 120_000;
export const MAX_UNIQUE_PREFIXES = 100_000;
export const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;

const SCRATCH_NAMESPACE = "lisa-scratch";
const OWNER_FILE = ".lisa-scratch-owner.json";
const MAX_OWNER_MARKER_BYTES = 16 * 1024;
const MAX_OWNER_TEXT_BYTES = 256;
const MAX_OWNER_PREFIXES = 64;
const DARWIN_BIRTH_BATCH_SIZE = 256;
const MAX_NAMESPACE_STABILITY_ATTEMPTS = 3;

/** Deterministic code-point ordering, independent of locale. */
const codePointCompare = (left, right) =>
  left === right ? 0 : left < right ? -1 : 1;

/**
 * Canonicalise a direct temp basename by stripping mkdtemp's six-character
 * suffix. `lisa-scratch` is a durable singleton namespace and is preserved.
 * @param {string} name Direct basename
 * @returns {string} Prefix label
 */
export function canonicalizeTmpPrefix(name) {
  if (name === SCRATCH_NAMESPACE) return name;
  return /[A-Za-z0-9]{6}$/u.test(name) ? `${name.slice(0, -6)}*` : name;
}

/**
 * Consume an iterable into a bounded, deterministically sorted name set.
 * @param {Iterable<string>} iterable Entry names
 * @param {number} [limit] Maximum entries
 * @returns {string[]} Sorted names
 */
export function collectBoundedEntryNames(iterable, limit = MAX_TMPDIR_ENTRIES) {
  const names = [];
  for (const name of iterable) {
    if (typeof name !== "string")
      throw new Error("Temp entry name is not text");
    if (Buffer.byteLength(name, "utf8") > MAX_TMPDIR_NAME_BYTES) {
      throw new Error(
        `Temp entry name exceeds ${String(MAX_TMPDIR_NAME_BYTES)} bytes`
      );
    }
    if (names.length >= limit) {
      throw new Error(`Temp scan exceeds bounded entry limit ${String(limit)}`);
    }
    names.push(name);
  }
  return names.sort(codePointCompare);
}

/** Build sorted prefix counts while enforcing a unique-prefix cap. */
function prefixCounts(names) {
  const counts = new Map();
  for (const name of names) {
    const prefix = canonicalizeTmpPrefix(name);
    if (!counts.has(prefix) && counts.size >= MAX_UNIQUE_PREFIXES) {
      throw new Error(
        `Temp scan exceeds unique-prefix limit ${String(MAX_UNIQUE_PREFIXES)}`
      );
    }
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([prefix, count]) => ({ prefix, count }))
    .sort(
      (left, right) =>
        right.count - left.count || codePointCompare(left.prefix, right.prefix)
    );
}

/** Read one platform directory through streaming opendir iteration. */
function scanDirectNames(root, limit) {
  const directory = fs.opendirSync(root);
  try {
    return collectBoundedEntryNames(
      (function* entries() {
        let entry;
        while ((entry = directory.readSync()) !== null) yield entry.name;
      })(),
      limit
    );
  } finally {
    directory.closeSync();
  }
}

/** Cheap pid liveness probe; EPERM still means alive. */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** Run one bounded macOS pid/start-time batch. */
function runDarwinBirthBatch(pids) {
  const result = spawnSync(
    "ps",
    ["-p", pids.join(","), "-o", "pid=", "-o", "lstart="],
    {
      encoding: "utf8",
      killSignal: "SIGKILL",
      maxBuffer: Math.max(4_096, pids.length * 128),
      timeout: 1_000,
    }
  );
  return result.status === 0 && result.signal === null && !result.error
    ? result.stdout
    : undefined;
}

/**
 * Capture one bounded process-birth snapshot for a complete namespace scan.
 * @param {readonly number[]} pids Process ids to inspect
 * @param {{platform?: NodeJS.Platform, runDarwinBatch?: (pids: readonly number[]) => string | undefined}} [options] Deterministic platform seams
 * @returns {ReadonlyMap<number, string | undefined>} Birth lookup
 */
export function processBirthFingerprintSnapshot(pids, options = {}) {
  const unique = [...new Set(pids)]
    .filter(pid => Number.isSafeInteger(pid) && pid > 0)
    .sort((left, right) => left - right);
  const snapshot = new Map(unique.map(pid => [pid, undefined]));
  const platform = options.platform ?? process.platform;
  if (platform === "linux") {
    for (const pid of unique) {
      try {
        const stat = fs.readFileSync(`/proc/${String(pid)}/stat`, "utf8");
        const end = stat.lastIndexOf(")");
        const start = stat
          .slice(end + 2)
          .trim()
          .split(/\s+/u)[19];
        snapshot.set(pid, start === undefined ? undefined : `linux:${start}`);
      } catch {
        snapshot.set(pid, undefined);
      }
    }
    return snapshot;
  }
  if (platform !== "darwin") return snapshot;
  const runBatch = options.runDarwinBatch ?? runDarwinBirthBatch;
  for (
    let offset = 0;
    offset < unique.length;
    offset += DARWIN_BIRTH_BATCH_SIZE
  ) {
    const batch = unique.slice(offset, offset + DARWIN_BIRTH_BATCH_SIZE);
    const output = runBatch(batch);
    if (output === undefined) continue;
    for (const row of output.split("\n")) {
      const match = /^\s*(\d+)\s+(.+?)\s*$/u.exec(row);
      const pid = Number(match?.[1]);
      if (!Number.isSafeInteger(pid) || !snapshot.has(pid)) continue;
      const start = match?.[2]?.replace(/\s+/gu, " ") ?? "";
      if (start !== "") snapshot.set(pid, `darwin:${start}`);
    }
  }
  return snapshot;
}

/** Whether an owner string is non-empty and bounded. */
function isBoundedOwnerText(value) {
  return (
    typeof value === "string" &&
    value !== "" &&
    Buffer.byteLength(value, "utf8") <= MAX_OWNER_TEXT_BYTES
  );
}

/** Whether one parsed identity has bounded canonical and integer fields. */
function isOwnerIdentity(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    isBoundedOwnerText(value.canonicalPath) &&
    path.isAbsolute(value.canonicalPath) &&
    Number.isSafeInteger(value.dev) &&
    Number.isSafeInteger(value.ino)
  );
}

/** Whether one parsed marker has the complete bounded version-one shape. */
function isOwnerShape(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    value.schema === 1 &&
    Number.isSafeInteger(value.pid) &&
    value.pid > 0 &&
    isBoundedOwnerText(value.processBirthFingerprint) &&
    isBoundedOwnerText(value.createdAt) &&
    !Number.isNaN(Date.parse(value.createdAt)) &&
    isBoundedOwnerText(value.suiteLabel) &&
    isBoundedOwnerText(value.token) &&
    Array.isArray(value.registeredPrefixes) &&
    value.registeredPrefixes.length <= MAX_OWNER_PREFIXES &&
    value.registeredPrefixes.every(isBoundedOwnerText) &&
    isOwnerIdentity(value.namespace) &&
    isOwnerIdentity(value.root)
  );
}

/** Whether marker authority matches the physical namespace and root inspected. */
function ownerMatchesPaths(owner, namespace, namespaceStat, root) {
  const rootStat = fs.lstatSync(root);
  return (
    !rootStat.isSymbolicLink() &&
    rootStat.isDirectory() &&
    owner.namespace.canonicalPath === fs.realpathSync(namespace) &&
    owner.namespace.dev === namespaceStat.dev &&
    owner.namespace.ino === namespaceStat.ino &&
    owner.root.canonicalPath === fs.realpathSync(root) &&
    owner.root.dev === rootStat.dev &&
    owner.root.ino === rootStat.ino
  );
}

/** Parse and authority-check an owner marker without mutation. */
function readOwner(root, namespace, namespaceStat) {
  const marker = path.join(root, OWNER_FILE);
  let stat;
  try {
    stat = fs.lstatSync(marker);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.size > MAX_OWNER_MARKER_BYTES
  ) {
    return undefined;
  }
  let value;
  try {
    value = JSON.parse(fs.readFileSync(marker, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
  return isOwnerShape(value) &&
    ownerMatchesPaths(value, namespace, namespaceStat, root)
    ? value
    : undefined;
}

/** Demand that a namespace still names the exact pinned authority. */
function assertNamespaceIdentity(namespace, expected) {
  const observed = fs.lstatSync(namespace);
  const uid = process.getuid?.();
  if (
    observed.isSymbolicLink() ||
    !observed.isDirectory() ||
    (uid !== undefined && observed.uid !== uid) ||
    (observed.mode & 0o777) !== 0o700 ||
    observed.dev !== expected.dev ||
    observed.ino !== expected.ino
  ) {
    throw new Error("lisa-scratch namespace identity changed during scan");
  }
  return observed;
}

/** Whether two already-sorted bounded name sets are byte-for-byte equal. */
function sameNames(left, right) {
  return (
    left.length === right.length &&
    left.every((name, index) => name === right[index])
  );
}

/** Inspect one candidate, distinguishing ordinary absence from other errors. */
function inspectNamespaceCandidate(name, namespace, namespaceStat, probes) {
  const candidate = path.join(namespace, name);
  try {
    const stat = fs.lstatSync(candidate);
    const owner =
      stat.isDirectory() && !stat.isSymbolicLink()
        ? readOwner(candidate, namespace, namespaceStat)
        : undefined;
    const pidAlive =
      owner !== undefined &&
      (probes.isProcessAlive ?? isProcessAlive)(owner.pid);
    return { name, owner, pidAlive };
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

/** Capture one complete stable namespace view or refuse boundedly. */
function stableNamespaceInspection(namespace, namespaceStat, probes) {
  for (
    let attempt = 1;
    attempt <= MAX_NAMESPACE_STABILITY_ATTEMPTS;
    attempt += 1
  ) {
    assertNamespaceIdentity(namespace, namespaceStat);
    const before = scanDirectNames(namespace, MAX_NAMESPACE_ENTRIES);
    probes.afterNamespaceScan?.({
      attempt,
      phase: "before",
      namespace,
      names: before,
    });
    const candidates = before.map(name =>
      inspectNamespaceCandidate(name, namespace, namespaceStat, probes)
    );
    probes.afterNamespaceScan?.({
      attempt,
      phase: "after",
      namespace,
      names: before,
    });
    assertNamespaceIdentity(namespace, namespaceStat);
    const after = scanDirectNames(namespace, MAX_NAMESPACE_ENTRIES);
    assertNamespaceIdentity(namespace, namespaceStat);
    if (
      candidates.every(candidate => candidate !== undefined) &&
      sameNames(before, after)
    ) {
      return candidates;
    }
  }
  throw new Error(
    `lisa-scratch namespace snapshot did not stabilize after ${String(MAX_NAMESPACE_STABILITY_ATTEMPTS)} attempts`
  );
}

/**
 * Bounded read-only classification of `lisa-scratch` direct children.
 * @param {string} root Canonical platform temp root
 * @param {{isProcessAlive?: (pid: number) => boolean, processBirthFingerprintSnapshot?: (pids: readonly number[]) => ReadonlyMap<number, string | undefined>, afterNamespaceScan?: (event: {attempt: number, phase: "before"|"after", namespace: string, names: readonly string[]}) => void}} [probes] Bounded process-authority probes and deterministic churn seam
 */
function inspectNamespace(root, probes = {}) {
  const namespace = path.join(root, SCRATCH_NAMESPACE);
  let namespaceStat;
  try {
    namespaceStat = fs.lstatSync(namespace);
    if (namespaceStat.isSymbolicLink() || !namespaceStat.isDirectory()) {
      throw new Error("lisa-scratch is not an authoritative directory");
    }
    const uid = process.getuid?.();
    if (uid !== undefined && namespaceStat.uid !== uid) {
      throw new Error("lisa-scratch uid does not match the current process");
    }
    if ((namespaceStat.mode & 0o777) !== 0o700) {
      throw new Error("lisa-scratch mode must be 0700");
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        total: 0,
        owned: 0,
        live: 0,
        unowned: 0,
        entries: [],
        suiteLabels: [],
        validOwnerRecords: [],
      };
    }
    throw error;
  }
  const inspected = stableNamespaceInspection(namespace, namespaceStat, probes);
  const births = (
    probes.processBirthFingerprintSnapshot ?? processBirthFingerprintSnapshot
  )(
    inspected.flatMap(entry =>
      entry.owner !== undefined && entry.pidAlive ? [entry.owner.pid] : []
    )
  );
  const entries = inspected.map(({ name, owner, pidAlive }) => {
    const observed =
      owner !== undefined && pidAlive ? births.get(owner.pid) : undefined;
    if (owner !== undefined && pidAlive && observed === undefined) {
      throw new Error(
        `Scratch owner birth authority unavailable for live PID ${String(owner.pid)} (${name})`
      );
    }
    if (
      owner !== undefined &&
      pidAlive &&
      observed !== owner.processBirthFingerprint
    ) {
      throw new Error(
        `Scratch owner birth authority mismatch for live PID ${String(owner.pid)} (${name})`
      );
    }
    const live = owner !== undefined && pidAlive;
    return {
      name,
      owned: owner !== undefined,
      live,
      ...(owner === undefined
        ? {}
        : {
            suiteLabel: owner.suiteLabel,
            pid: owner.pid,
            token: owner.token,
          }),
    };
  });
  const validOwnerRecords = entries
    .filter(entry => entry.owned)
    .map(entry => ({
      name: entry.name,
      pid: entry.pid,
      suiteLabel: entry.suiteLabel,
      token: entry.token,
      live: entry.live,
    }))
    .sort((left, right) => codePointCompare(left.name, right.name));
  const suiteLabels = [
    ...new Set(validOwnerRecords.map(record => record.suiteLabel)),
  ].sort(codePointCompare);
  const owned = entries.filter(entry => entry.owned).length;
  const live = entries.filter(entry => entry.live).length;
  return {
    total: entries.length,
    owned,
    live,
    unowned: entries.length - owned,
    entries,
    suiteLabels,
    validOwnerRecords,
  };
}

/**
 * Build a complete snapshot of one authoritative temp root.
 * @param {string} logicalRoot Root as supplied by the operator
 * @param {number} nowMs Observation epoch milliseconds
 * @param {{isProcessAlive?: (pid: number) => boolean, processBirthFingerprintSnapshot?: (pids: readonly number[]) => ReadonlyMap<number, string | undefined>}} [probes] Bounded process-authority probes
 * @returns {object} Complete snapshot
 */
export function buildTmpdirSnapshot(
  logicalRoot,
  nowMs = Date.now(),
  probes = {}
) {
  const rootStat = fs.lstatSync(logicalRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("Temp root must be a real directory, not a symlink");
  }
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error("Observation time must be a non-negative integer");
  }
  const canonicalRoot = fs.realpathSync(logicalRoot);
  const names = scanDirectNames(canonicalRoot, MAX_TMPDIR_ENTRIES);
  return {
    schemaVersion: TMPDIR_GROWTH_SCHEMA_VERSION,
    groupingVersion: TMPDIR_GROUPING_VERSION,
    logicalRoot: path.resolve(logicalRoot),
    canonicalRoot,
    rootIdentity: { dev: rootStat.dev, ino: rootStat.ino },
    observedAt: new Date(nowMs).toISOString(),
    observedAtMs: nowMs,
    complete: true,
    entryNames: names,
    prefixCounts: prefixCounts(names),
    namespace: inspectNamespace(canonicalRoot, probes),
  };
}

/** Demand two snapshots describe the same compatible root and monotonic time. */
function assertComparable(before, after) {
  if (
    before.schemaVersion !== TMPDIR_GROWTH_SCHEMA_VERSION ||
    before.groupingVersion !== TMPDIR_GROUPING_VERSION ||
    before.complete !== true
  ) {
    throw new Error("Previous temp-growth snapshot is malformed or partial");
  }
  if (
    before.logicalRoot !== after.logicalRoot ||
    before.canonicalRoot !== after.canonicalRoot ||
    before.rootIdentity?.dev !== after.rootIdentity.dev ||
    before.rootIdentity?.ino !== after.rootIdentity.ino
  ) {
    throw new Error("Previous temp-growth snapshot describes a different root");
  }
  if (after.observedAtMs <= before.observedAtMs) {
    throw new Error("Temp-growth snapshots are non-monotonic");
  }
}

/**
 * Compare two complete snapshots without hiding equal creation/removal.
 * @param {object|undefined} before Previous snapshot
 * @param {object} after Current snapshot
 * @returns {object} Deterministic growth report
 */
export function buildGrowthReport(before, after) {
  if (before === undefined) {
    return {
      total: after.entryNames.length,
      delta: null,
      created: 0,
      removed: 0,
      unreclaimed: 0,
      elapsedMs: null,
      rateEntriesPerDay: null,
      topPrefixes: prefixCounts(after.entryNames).slice(0, 10),
      namespace: {
        total: after.namespace.total,
        owned: after.namespace.owned,
        live: after.namespace.live,
        unowned: after.namespace.unowned,
        created: 0,
        removed: 0,
        unreclaimed: after.namespace.unowned,
        newlyUnowned: 0,
      },
      violations: [],
    };
  }
  assertComparable(before, after);
  const beforeNames = new Set(before.entryNames);
  const afterNames = new Set(after.entryNames);
  const createdNames = after.entryNames.filter(name => !beforeNames.has(name));
  const removedNames = before.entryNames.filter(name => !afterNames.has(name));
  const elapsedMs = after.observedAtMs - before.observedAtMs;
  const beforeNamespace = new Map(
    before.namespace.entries.map(entry => [entry.name, entry])
  );
  const afterNamespace = new Map(
    after.namespace.entries.map(entry => [entry.name, entry])
  );
  const namespaceCreated = [...afterNamespace.keys()].filter(
    name => !beforeNamespace.has(name)
  );
  const namespaceRemoved = [...beforeNamespace.keys()].filter(
    name => !afterNamespace.has(name)
  );
  const newlyUnowned = [...afterNamespace.keys()].filter(name => {
    const beforeEntry = beforeNamespace.get(name);
    const afterEntry = afterNamespace.get(name);
    return (
      afterEntry?.owned !== true &&
      (beforeEntry === undefined || beforeEntry.owned === true)
    );
  });
  const violations = [
    ...createdNames
      .filter(name => canonicalizeTmpPrefix(name) === "cdk.out*")
      .map(name => `new direct cdk.out entry: ${name}`),
    ...createdNames
      .filter(name => name !== SCRATCH_NAMESPACE && name.startsWith("lisa-"))
      .map(name => `new direct unowned Lisa entry: ${name}`),
    ...newlyUnowned.map(name => `new unowned lisa-scratch child: ${name}`),
  ].sort(codePointCompare);
  return {
    total: after.entryNames.length,
    delta: after.entryNames.length - before.entryNames.length,
    created: createdNames.length,
    removed: removedNames.length,
    unreclaimed: Math.max(0, createdNames.length - removedNames.length),
    elapsedMs,
    rateEntriesPerDay: Math.round(
      ((createdNames.length - removedNames.length) * 86_400_000) / elapsedMs
    ),
    topPrefixes: prefixCounts(after.entryNames).slice(0, 10),
    namespace: {
      total: after.namespace.total,
      owned: after.namespace.owned,
      live: after.namespace.live,
      unowned: after.namespace.unowned,
      created: namespaceCreated.length,
      removed: namespaceRemoved.length,
      unreclaimed: Math.max(
        0,
        namespaceCreated.length - namespaceRemoved.length
      ),
      newlyUnowned: newlyUnowned.length,
    },
    violations,
  };
}

/** Parse the tiny CLI surface without accepting ambiguous positional input. */
function parseArgs(argv) {
  const options = {
    root: os.tmpdir(),
    artifact: path.resolve(DEFAULT_TMPDIR_GROWTH_ARTIFACT),
    nowMs: Date.now(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--root" && value !== undefined) options.root = value;
    else if (flag === "--artifact" && value !== undefined)
      options.artifact = value;
    else if (flag === "--now-ms" && value !== undefined)
      options.nowMs = Number(value);
    else throw new Error(`Unknown or incomplete argument: ${String(flag)}`);
    index += 1;
  }
  return options;
}

/** Demand the CLI root names the process platform temp root exactly. */
function assertPlatformTempRoot(root) {
  const platformRoot = os.tmpdir();
  const suppliedStat = fs.lstatSync(root);
  const platformStat = fs.lstatSync(platformRoot);
  if (
    suppliedStat.isSymbolicLink() ||
    !suppliedStat.isDirectory() ||
    platformStat.isSymbolicLink() ||
    !platformStat.isDirectory() ||
    path.resolve(root) !== path.resolve(platformRoot) ||
    fs.realpathSync(root) !== fs.realpathSync(platformRoot) ||
    suppliedStat.dev !== platformStat.dev ||
    suppliedStat.ino !== platformStat.ino
  ) {
    throw new Error("--root must equal the current platform temp root");
  }
}

/** Whether a value is a non-negative safe integer. */
function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Whether an object exposes exactly the declared persisted keys. */
function hasExactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    isDeepStrictEqual(
      Object.keys(value).sort(codePointCompare),
      [...keys].sort(codePointCompare)
    )
  );
}

/** Whether a persisted namespace entry has one exact boolean-tagged shape. */
function isPersistedNamespaceEntry(entry) {
  if (
    entry === null ||
    typeof entry !== "object" ||
    typeof entry.name !== "string" ||
    path.basename(entry.name) !== entry.name ||
    entry.name === "." ||
    entry.name === ".." ||
    Buffer.byteLength(entry.name, "utf8") > MAX_TMPDIR_NAME_BYTES ||
    typeof entry.owned !== "boolean" ||
    typeof entry.live !== "boolean" ||
    (entry.live && !entry.owned)
  ) {
    return false;
  }
  if (!entry.owned) {
    return hasExactKeys(entry, ["name", "owned", "live"]);
  }
  return (
    hasExactKeys(entry, [
      "name",
      "owned",
      "live",
      "suiteLabel",
      "pid",
      "token",
    ]) &&
    Number.isSafeInteger(entry.pid) &&
    entry.pid > 0 &&
    isBoundedOwnerText(entry.suiteLabel) &&
    isBoundedOwnerText(entry.token)
  );
}

/** Whether a persisted owner summary has the exact bounded shape. */
function isPersistedOwnerRecord(record) {
  return (
    hasExactKeys(record, ["name", "pid", "suiteLabel", "token", "live"]) &&
    typeof record.name === "string" &&
    path.basename(record.name) === record.name &&
    record.name !== "." &&
    record.name !== ".." &&
    Buffer.byteLength(record.name, "utf8") <= MAX_TMPDIR_NAME_BYTES &&
    Number.isSafeInteger(record.pid) &&
    record.pid > 0 &&
    isBoundedOwnerText(record.suiteLabel) &&
    isBoundedOwnerText(record.token) &&
    typeof record.live === "boolean"
  );
}

/** Owner summaries are a canonical projection of owned namespace entries. */
function ownerRecordsFromEntries(entries) {
  return entries
    .filter(entry => entry.owned)
    .map(entry => ({
      name: entry.name,
      pid: entry.pid,
      suiteLabel: entry.suiteLabel,
      token: entry.token,
      live: entry.live,
    }))
    .sort((left, right) => codePointCompare(left.name, right.name));
}

/** Demand one persisted snapshot has the complete bounded current schema. */
function assertPersistedSnapshot(snapshot) {
  if (
    snapshot === null ||
    typeof snapshot !== "object" ||
    snapshot.schemaVersion !== TMPDIR_GROWTH_SCHEMA_VERSION ||
    snapshot.groupingVersion !== TMPDIR_GROUPING_VERSION ||
    snapshot.complete !== true ||
    typeof snapshot.logicalRoot !== "string" ||
    !path.isAbsolute(snapshot.logicalRoot) ||
    typeof snapshot.canonicalRoot !== "string" ||
    !path.isAbsolute(snapshot.canonicalRoot) ||
    !isCount(snapshot.rootIdentity?.dev) ||
    !isCount(snapshot.rootIdentity?.ino) ||
    !isCount(snapshot.observedAtMs) ||
    snapshot.observedAt !== new Date(snapshot.observedAtMs).toISOString() ||
    !Array.isArray(snapshot.entryNames) ||
    !Array.isArray(snapshot.prefixCounts) ||
    snapshot.prefixCounts.length > MAX_UNIQUE_PREFIXES ||
    !snapshot.prefixCounts.every(
      entry =>
        hasExactKeys(entry, ["prefix", "count"]) &&
        isBoundedOwnerText(entry.prefix) &&
        Number.isSafeInteger(entry.count) &&
        entry.count > 0
    ) ||
    snapshot.namespace === null ||
    typeof snapshot.namespace !== "object" ||
    !Array.isArray(snapshot.namespace.entries) ||
    snapshot.namespace.entries.length > MAX_NAMESPACE_ENTRIES ||
    !Array.isArray(snapshot.namespace.suiteLabels) ||
    !Array.isArray(snapshot.namespace.validOwnerRecords) ||
    !isCount(snapshot.namespace.total) ||
    !isCount(snapshot.namespace.owned) ||
    !isCount(snapshot.namespace.live) ||
    !isCount(snapshot.namespace.unowned)
  ) {
    throw new Error(
      "Temp-growth artifact contains a malformed or partial snapshot"
    );
  }
  if (
    !snapshot.namespace.entries.every(isPersistedNamespaceEntry) ||
    !snapshot.namespace.validOwnerRecords.every(isPersistedOwnerRecord) ||
    !snapshot.namespace.suiteLabels.every(isBoundedOwnerText)
  ) {
    throw new Error(
      "Temp-growth artifact snapshot has malformed ownership fields"
    );
  }
  const normalizedNames = collectBoundedEntryNames(snapshot.entryNames);
  const namespaceNames = collectBoundedEntryNames(
    snapshot.namespace.entries.map(entry => entry.name),
    MAX_NAMESPACE_ENTRIES
  );
  const suiteLabels = collectBoundedEntryNames(
    snapshot.namespace.suiteLabels,
    MAX_NAMESPACE_ENTRIES
  );
  const ownerNames = collectBoundedEntryNames(
    snapshot.namespace.validOwnerRecords.map(record => record.name),
    MAX_NAMESPACE_ENTRIES
  );
  const owned = snapshot.namespace.entries.filter(
    entry => entry.owned === true
  );
  const live = snapshot.namespace.entries.filter(entry => entry.live === true);
  const expectedOwnerRecords = ownerRecordsFromEntries(
    snapshot.namespace.entries
  );
  const expectedSuiteLabels = [
    ...new Set(expectedOwnerRecords.map(record => record.suiteLabel)),
  ].sort(codePointCompare);
  if (
    normalizedNames.length !== new Set(normalizedNames).size ||
    normalizedNames.some(
      (name, index) => name !== snapshot.entryNames[index]
    ) ||
    JSON.stringify(prefixCounts(normalizedNames)) !==
      JSON.stringify(snapshot.prefixCounts) ||
    namespaceNames.length !== new Set(namespaceNames).size ||
    namespaceNames.some(
      (name, index) => name !== snapshot.namespace.entries[index].name
    ) ||
    suiteLabels.length !== new Set(suiteLabels).size ||
    suiteLabels.some(
      (label, index) => label !== snapshot.namespace.suiteLabels[index]
    ) ||
    ownerNames.length !== new Set(ownerNames).size ||
    ownerNames.some(
      (name, index) => name !== snapshot.namespace.validOwnerRecords[index].name
    ) ||
    !isDeepStrictEqual(
      snapshot.namespace.validOwnerRecords,
      expectedOwnerRecords
    ) ||
    !isDeepStrictEqual(snapshot.namespace.suiteLabels, expectedSuiteLabels) ||
    snapshot.namespace.total !== snapshot.namespace.entries.length ||
    snapshot.namespace.owned !== owned.length ||
    snapshot.namespace.live !== live.length ||
    snapshot.namespace.owned + snapshot.namespace.unowned !==
      snapshot.namespace.total ||
    snapshot.namespace.live > snapshot.namespace.owned
  ) {
    throw new Error("Temp-growth artifact snapshot is inconsistent");
  }
}

/** Read and validate a bounded existing artifact. */
function readArtifact(artifactPath) {
  try {
    const stat = fs.lstatSync(artifactPath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error("Temp-growth artifact must be a regular file");
    }
    if (stat.size > MAX_ARTIFACT_BYTES) {
      throw new Error("Temp-growth artifact exceeds its byte bound");
    }
    const parsed = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      parsed.schemaVersion !== TMPDIR_GROWTH_SCHEMA_VERSION ||
      parsed.groupingVersion !== TMPDIR_GROUPING_VERSION ||
      !Array.isArray(parsed.snapshots) ||
      parsed.snapshots.length === 0 ||
      parsed.snapshots.length > 2
    ) {
      throw new Error("Temp-growth artifact is malformed or incompatible");
    }
    parsed.snapshots.forEach(assertPersistedSnapshot);
    const latest = parsed.snapshots.at(-1);
    const previous = parsed.snapshots.at(-2);
    if (
      latest === undefined ||
      !isDeepStrictEqual(parsed.report, buildGrowthReport(previous, latest))
    ) {
      throw new Error(
        "Temp-growth artifact report is malformed or inconsistent"
      );
    }
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

/** Atomic artifact write performed only after a complete compatible scan. */
function writeArtifact(artifactPath, artifact) {
  const content = `${JSON.stringify(artifact, null, 2)}\n`;
  if (Buffer.byteLength(content, "utf8") > MAX_ARTIFACT_BYTES) {
    throw new Error("Complete temp-growth artifact exceeds its byte bound");
  }
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  const temporary = `${artifactPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, artifactPath);
}

/**
 * Run one CLI measurement, returning its documented exit status.
 * @param {readonly string[]} argv CLI arguments
 * @param {{isProcessAlive?: (pid: number) => boolean, processBirthFingerprintSnapshot?: (pids: readonly number[]) => ReadonlyMap<number, string | undefined>}} [probes] Internal process-authority probes
 * @returns {number} Documented process exit status
 */
export function runTmpdirGrowth(argv = process.argv.slice(2), probes = {}) {
  try {
    const options = parseArgs(argv);
    assertPlatformTempRoot(options.root);
    const existing = readArtifact(options.artifact);
    const current = buildTmpdirSnapshot(options.root, options.nowMs, probes);
    const previous = existing?.snapshots.at(-1);
    const report = buildGrowthReport(previous, current);
    const snapshots = [...(existing?.snapshots ?? []), current].slice(-2);
    const artifact = {
      schemaVersion: TMPDIR_GROWTH_SCHEMA_VERSION,
      groupingVersion: TMPDIR_GROUPING_VERSION,
      snapshots,
      report,
    };
    writeArtifact(options.artifact, artifact);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.violations.length > 0 ? 1 : 0;
  } catch (error) {
    process.stderr.write(
      `Temp-growth measurement incomplete: ${String(error)}\n`
    );
    return 2;
  }
}

if (invokedAsScript(import.meta.url)) {
  process.exitCode = runTmpdirGrowth();
}

/** Validate exhaustive native-shard receipts before one original guard judge. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { tracerIndex } from "./shell-guard-refusal-coverage.mjs";

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const encoded = value => JSON.stringify(value);
const nonnegativeInteger = value => Number.isSafeInteger(value) && value >= 0;
export const identityHash = value => sha256(encoded(value));
const hex = (value, count) =>
  typeof value === "string" &&
  new RegExp(`^[a-f0-9]{${count}}$`, "u").test(value);
const relative = file =>
  typeof file === "string" &&
  file.length > 0 &&
  !file.includes("\\") &&
  !path.posix.isAbsolute(file) &&
  path.posix.normalize(file) === file &&
  !file.split("/").some(part => part === ".." || part === "." || part === "");

export function parseShard(value) {
  const match = /^(\d+)\/(\d+)$/u.exec(value ?? "");
  assert(match, "shard must be I/3");
  const index = Number(match[1]),
    total = Number(match[2]);
  assert(
    Number.isSafeInteger(index) && total === 3 && index >= 1 && index <= total,
    "invalid shard index/total"
  );
  return { index, total };
}

export function validateSnapshot(snapshot) {
  assert(hex(snapshot.head, 40) && hex(snapshot.tree, 40));
  assert(
    snapshot.provider &&
      /^\d+$/u.test(snapshot.provider.runId) &&
      /^\d+$/u.test(snapshot.provider.attempt)
  );
  assert(
    hex(snapshot.provider.sourceSha, 40) &&
      snapshot.provider.sourceSha === snapshot.head
  );
  assert(
    hex(snapshot.provider.prHead, 40) &&
      typeof snapshot.provider.workflowRef === "string" &&
      snapshot.provider.workflowRef.length > 0
  );
  assert(Array.isArray(snapshot.candidates) && snapshot.candidates.length > 0);
  const paths = snapshot.candidates.map(row => row.path);
  assert(new Set(paths).size === paths.length && paths.every(relative));
  assert(
    paths.every((file, at) => at === 0 || paths[at - 1].localeCompare(file) < 0)
  );
  assert(snapshot.candidates.every(row => hex(row.sha256, 64)));
  assert(Array.isArray(snapshot.population) && snapshot.population.length > 0);
  assert(
    new Set(snapshot.population.map(row => row.path)).size ===
      snapshot.population.length
  );
  assert(
    snapshot.population.every(
      row =>
        relative(row.path) &&
        hex(row.sha256, 64) &&
        nonnegativeInteger(row.size) &&
        typeof row.canRefuse === "boolean" &&
        typeof row.toolBoundary === "boolean"
    )
  );
  assert(snapshot.candidateHash === identityHash(snapshot.candidates));
  assert(snapshot.populationHash === identityHash(snapshot.population));
  assert(
    Object.keys(snapshot.scriptHashes).length > 0 &&
      Object.entries(snapshot.scriptHashes).every(
        ([file, hash]) => relative(file) && hex(hash, 64)
      )
  );
  assert(snapshot.runtime && Object.keys(snapshot.runtime).length > 0);
  return snapshot;
}

function reportedPath(root, file) {
  assert(
    typeof file === "string" && path.isAbsolute(file),
    "native reporter path must be absolute"
  );
  const rel = path.relative(root, file).split(path.sep).join("/");
  assert(relative(rel), "reported file outside checkout");
  return rel;
}

/** JSON suite counters include nested suites. File identity is testResults[].name. */
export function completeReportedFiles(root, report, terminal) {
  assert(
    report &&
      report.success === true &&
      report.numFailedTests === 0 &&
      report.numFailedTestSuites === 0,
    "native JSON report unsuccessful/incomplete"
  );
  assert(
    Array.isArray(report.testResults) && report.testResults.length > 0,
    "missing native file report"
  );
  assert(
    terminal &&
      terminal.schema === 1 &&
      terminal.complete === true &&
      terminal.reason === "passed" &&
      terminal.unhandledErrorCount === 0 &&
      Array.isArray(terminal.files),
    "missing/incomplete lifecycle receipt"
  );
  const files = report.testResults.map(file => {
    assert(
      file.status === "passed" && Array.isArray(file.assertionResults),
      "native file failed/malformed"
    );
    assert(
      file.assertionResults.every(
        test =>
          ["passed", "skipped", "todo"].includes(test.status) &&
          Array.isArray(test.failureMessages) &&
          test.failureMessages.length === 0
      ),
      "native assertion failed/pending/malformed"
    );
    return {
      path: reportedPath(root, file.name),
      assertions: file.assertionResults.length,
    };
  });
  assert(
    new Set(files.map(file => file.path)).size === files.length,
    "duplicate native file"
  );
  const lifecycle = terminal.files.map(file => {
    assert(
      file.complete === true &&
        Number.isSafeInteger(file.tests) &&
        file.tests >= 0,
      "unresolved native task"
    );
    assert(
      Array.isArray(file.tasks) &&
        file.tasks.length > 0 &&
        file.tasks.every(terminalTask),
      "unresolved native task state"
    );
    assert(
      file.tasks.filter(task => task.type === "test").length === file.tests
    );
    assert(["passed", "skipped"].includes(file.moduleState));
    assert(
      Array.isArray(file.cases) &&
        file.cases.length === file.tests &&
        file.cases.every(test => ["passed", "skipped"].includes(test.state)),
      "pending/failed native case"
    );
    return { path: reportedPath(root, file.name), assertions: file.tests };
  });
  const sort = rows =>
    rows.slice().sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(
    sort(files),
    sort(lifecycle),
    "JSON/lifecycle file roster mismatch"
  );
  for (const roster of [terminal.queuedFiles, terminal.collectedFiles]) {
    assert(Array.isArray(roster) && new Set(roster).size === roster.length);
    assert.deepEqual(
      roster.map(file => reportedPath(root, file)).sort(),
      lifecycle.map(file => file.path).sort(),
      "native queued/collected/ended roster mismatch"
    );
  }
  assert(
    report.numTotalTests ===
      files.reduce((count, file) => count + file.assertions, 0)
  );
  return files.map(file => file.path).sort((a, b) => a.localeCompare(b));
}

export function terminalTask(task) {
  return (
    task &&
    ["test", "suite"].includes(task.type) &&
    (["pass", "skip"].includes(task.state) ||
      (task.state === "todo" && task.mode === "todo") ||
      (task.state === null && ["skip", "todo"].includes(task.mode)))
  );
}

/** Preserve null status and repeated records, but neither counts as extra proof. */
export function strictTrace(raw, population) {
  assert(typeof raw === "string");
  const current = new Map(population.map(guard => [guard.path, guard.sha256]));
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    const row = JSON.parse(line);
    assert(
      row &&
        typeof row === "object" &&
        current.has(row.script) &&
        current.get(row.script) === row.sha256,
      "unknown/stale guard observation"
    );
    assert(
      row.status === null ||
        (Number.isInteger(row.status) && row.status >= 0 && row.status <= 255),
      "invalid child status"
    );
    assert(typeof row.origin === "string", "missing origin");
  }
  return raw;
}

export function nativeArgv(root, artifactRoot, shard, candidates) {
  return [
    "run",
    `--shard=${shard.index}/${shard.total}`,
    "--reporter=dot",
    "--reporter=json",
    `--reporter=${path.join(root, "scripts/lib/shell-guard-terminal-reporter.mjs")}`,
    `--outputFile.json=${path.join(artifactRoot, "results.json")}`,
    ...candidates.map(row => row.path),
  ];
}

/*
 * #4634: a failed-jobs re-run is a new Actions attempt that rebuilds only the
 * failed shard, so a valid merge may combine bundles from different attempts
 * of ONE run. Every refusal names the shard and attempt it judged and the
 * re-run that recovers it, because the operator reading a red check has no
 * other way to know a failed-jobs re-run would be wasted.
 */
/** Every recovery hint starts with this; recoverable() keys on it alone. */
export const RECOVERY_PREFIX = "Recovery: ";
export const RERUN_FAILED = `${RECOVERY_PREFIX}"Re-run failed jobs" rebuilds only that shard and is enough.`;
export const RERUN_ALL = `${RECOVERY_PREFIX}"Re-run all jobs" is needed; re-running only failed jobs cannot fix this.`;
const BUNDLE_NAME = /^lisa-shell-guard-(\d+)-([1-9]\d*)-shard-([1-9]\d*)$/u;
const RUN_IDENTITY = ["runId", "sourceSha", "prHead", "workflowRef"];
const shardName = index => `shard ${index}`;
const label = (index, attempt) => `${shardName(index)} attempt ${attempt}`;
const bundleLabel = manifest =>
  label(manifest?.shard?.index, manifest?.snapshot?.provider?.attempt);
/** The snapshot minus the one field a failed-jobs re-run legitimately changes. */
const withoutAttempt = value => {
  const { attempt: _attempt, ...provider } = value?.provider ?? {};
  return { ...value, provider };
};

/**
 * Bind a bundle to the current run. The attempt may be older than the merge
 * job's own (a re-run keeps earlier attempts' complete shards), never newer;
 * everything else — run, source, PR head, workflow, runtime, roster — must be
 * identical, because a re-run of the same run cannot change any of it.
 */
function assertCurrentRun(snapshot, manifest) {
  const where = bundleLabel(manifest);
  const recorded = manifest?.snapshot?.provider ?? {};
  for (const field of RUN_IDENTITY) {
    assert(
      recorded[field] === snapshot.provider[field],
      `${where} records ${field} ${JSON.stringify(recorded[field])}, but the current run has ${JSON.stringify(snapshot.provider[field])}; a foreign or stale bundle cannot be merged. ${RERUN_ALL}`
    );
  }
  assert(
    /^\d+$/u.test(recorded.attempt ?? "") &&
      Number(recorded.attempt) <= Number(snapshot.provider.attempt),
    `${where} is not an attempt at or before the merge job's attempt ${snapshot.provider.attempt}. ${RERUN_ALL}`
  );
  assert.deepEqual(
    withoutAttempt(manifest.snapshot),
    withoutAttempt(snapshot),
    `${where} was built from a different source/runtime/roster identity than the current merge job. ${RERUN_ALL}`
  );
}

export function validateBundle({
  snapshot,
  manifest,
  reportRaw,
  terminalRaw,
  traceRaw,
  indexRaw,
  executionRaw,
  stdoutRaw,
  stderrRaw,
}) {
  validateSnapshot(snapshot);
  assert(
    manifest && manifest.schema === 1 && manifest.complete === true,
    `${bundleLabel(manifest)} has an incomplete manifest. ${RERUN_FAILED}`
  );
  assertCurrentRun(snapshot, manifest);
  parseShard(`${manifest.shard.index}/${manifest.shard.total}`);
  assert(
    manifest.child.status === 0 &&
      manifest.child.signal === null &&
      manifest.child.error === null,
    `${bundleLabel(manifest)} child failed/killed/not started. ${RERUN_FAILED}`
  );
  assert(manifest.producerJob === "guard-trace", "wrong native producer job");
  assert(
    typeof manifest.artifactRoot === "string" &&
      path.isAbsolute(manifest.artifactRoot)
  );
  assert(
    manifest.child.command ===
      path.join(manifest.checkoutRoot, "node_modules/.bin/vitest"),
    "wrong child executable"
  );
  assert.deepEqual(
    manifest.child.argv,
    nativeArgv(
      manifest.checkoutRoot,
      manifest.artifactRoot,
      manifest.shard,
      snapshot.candidates
    ),
    "incomplete/altered native argv"
  );
  assert(
    Number.isFinite(Date.parse(manifest.child.startedAt)) &&
      Number.isFinite(Date.parse(manifest.child.endedAt)) &&
      Date.parse(manifest.child.endedAt) >=
        Date.parse(manifest.child.startedAt),
    "missing/reversed execution times"
  );
  assert(
    manifest.traceSha256 === sha256(traceRaw) &&
      manifest.reportSha256 === sha256(reportRaw) &&
      manifest.terminalSha256 === sha256(terminalRaw),
    "artifact digest mismatch"
  );
  assert(
    typeof manifest.checkoutRoot === "string" &&
      path.isAbsolute(manifest.checkoutRoot)
  );
  for (const [name, raw] of Object.entries({
    "guard-index.json": indexRaw,
    "execution.json": executionRaw,
    "stdout.log": stdoutRaw,
    "stderr.log": stderrRaw,
  })) {
    assert(
      (typeof raw === "string" || Buffer.isBuffer(raw)) &&
        manifest.rawHashes[name] === sha256(raw),
      `raw receipt digest mismatch: ${name}`
    );
  }
  assert.deepEqual(
    JSON.parse(indexRaw),
    tracerIndex(snapshot.population),
    "narrowed/stale tracer index"
  );
  assert(
    sha256(indexRaw) ===
      sha256(JSON.stringify(tracerIndex(snapshot.population))),
    "canonical tracer index bytes changed"
  );
  assert.deepEqual(
    JSON.parse(executionRaw),
    manifest.child,
    "execution record/manifest mismatch"
  );
  // Report paths belong to that producer's checkout; runners need not share a path.
  const terminal = JSON.parse(terminalRaw);
  const files = completeReportedFiles(
    manifest.checkoutRoot,
    JSON.parse(reportRaw),
    terminal
  );
  assert(
    Array.isArray(terminal.startedFiles) &&
      new Set(terminal.startedFiles).size === terminal.startedFiles.length
  );
  // Vitest4.1.11 starts with ALL filtered specs BEFORE native sharding.
  assert.deepEqual(
    terminal.startedFiles
      .map(file => reportedPath(manifest.checkoutRoot, file))
      .sort((a, b) => a.localeCompare(b)),
    snapshot.candidates.map(row => row.path),
    "complete pre-shard native collection differs from canonical candidates"
  );
  assert.deepEqual(manifest.reportedFiles, files);
  assert(
    files.every(file =>
      snapshot.candidates.some(candidate => candidate.path === file)
    ),
    "native filter collected a noncandidate file"
  );
  assert(manifest.reportedFileCount === files.length && files.length > 0);
  strictTrace(traceRaw, snapshot.population);
  return { files, trace: traceRaw, shard: manifest.shard };
}

export function mergeBundles(snapshot, bundles) {
  validateSnapshot(snapshot);
  assert(
    Array.isArray(bundles) && bundles.length === 3,
    `all three complete shards required. ${RERUN_FAILED}`
  );
  const seen = new Set(),
    files = new Set(),
    validated = [];
  for (const bundle of bundles) {
    const value = recoverable(bundleLabel(bundle.manifest), () =>
      validateBundle({ ...bundle, snapshot })
    );
    const where = bundleLabel(bundle.manifest);
    assert(
      !seen.has(value.shard.index),
      `duplicate shard identity: ${where}. ${RERUN_ALL}`
    );
    seen.add(value.shard.index);
    for (const file of value.files) {
      assert(
        !files.has(file),
        `duplicate reported file across shards: ${where} reports ${file} again. ${RERUN_ALL}`
      );
      files.add(file);
    }
    validated.push(value);
  }
  assert.deepEqual([...seen].sort(), [1, 2, 3]);
  assert.deepEqual(
    [...files].sort((a, b) => a.localeCompare(b)),
    snapshot.candidates.map(row => row.path),
    `missing/extra candidate files across ${bundles.map(bundle => bundleLabel(bundle.manifest)).join(", ")}. ${RERUN_ALL}`
  );
  // ONE existing judge receives this trace. Empty individual traces are valid.
  return `${validated
    .sort((a, b) => a.shard.index - b.shard.index)
    .map(value => value.trace.trimEnd())
    .filter(Boolean)
    .join("\n")}\n`;
}

/**
 * A receipt-integrity refusal deep inside validateBundle (digest, argv,
 * roster) or a missing artifact file does not know which bundle it judged.
 * Name it, and say a full re-run is needed: the bundle's own job succeeded,
 * so a failed-jobs re-run would not rebuild it.
 */
function recoverable(where, validate) {
  try {
    return validate();
  } catch (error) {
    if (String(error?.message ?? "").includes(RECOVERY_PREFIX)) throw error;
    throw new Error(
      `${where}: ${error?.message ?? String(error)}. ${RERUN_ALL}`,
      { cause: error }
    );
  }
}

/** Parse `lisa-shell-guard-<run>-<attempt>-shard-<index>` against this run. */
function parseBundleName(name, provider) {
  const match = BUNDLE_NAME.exec(name);
  assert(
    match,
    `download directory ${JSON.stringify(name)} is not a shell-guard shard bundle of run ${provider.runId}. ${RERUN_ALL}`
  );
  const [, runId, attemptText, indexText] = match;
  const attempt = Number(attemptText),
    index = Number(indexText);
  const where = label(index, attempt);
  assert(
    runId === provider.runId,
    `${where} (${name}) belongs to run ${runId}, not the current run ${provider.runId}. ${RERUN_ALL}`
  );
  assert(
    index <= 3,
    `${where} (${name}) is not one of shards 1-3. ${RERUN_ALL}`
  );
  assert(
    attempt <= Number(provider.attempt),
    `${where} (${name}) is newer than the merge job's attempt ${provider.attempt}. ${RERUN_ALL}`
  );
  return { index, attempt, where };
}

/** Keep the highest attempt per shard; two directories may not claim one slot. */
function newestPerShard(entries, provider) {
  const newest = new Map(),
    seen = new Set();
  for (const entry of entries) {
    const { index, attempt, where } = parseBundleName(entry.name, provider);
    assert(
      !seen.has(where),
      `duplicate download directories claim ${where}. ${RERUN_ALL}`
    );
    seen.add(where);
    if ((newest.get(index)?.attempt ?? 0) < attempt)
      newest.set(index, { index, attempt, where, entry });
  }
  const missing = [1, 2, 3].filter(index => !newest.has(index));
  assert(
    missing.length === 0,
    `missing shard bundle for ${missing.map(shardName).join(", ")}: no attempt 1-${provider.attempt} of run ${provider.runId} uploaded one. ${RECOVERY_PREFIX}"Re-run failed jobs" if that shard's job failed or was cancelled; "Re-run all jobs" if it succeeded without uploading.`
  );
  return [...newest.values()].sort((a, b) => a.index - b.index);
}

/**
 * Merge downloaded shard directories from EVERY attempt of the current run
 * (#4634). For each shard the newest attempt wins; its bundle must be
 * complete, because falling back to an older attempt would silently judge a
 * shard the operator just re-ran. `entries` are `{ name, read }`, where
 * `read()` returns the bundle or null when the directory holds no
 * manifest.json (a failed shard uploads diagnostics only). Only the chosen
 * directories are read.
 */
export function mergeShardDirectories(snapshot, entries) {
  validateSnapshot(snapshot);
  assert(Array.isArray(entries), "shard directory entries required");
  const selected = newestPerShard(entries, snapshot.provider).map(choice => {
    const bundle = recoverable(choice.where, () => choice.entry.read());
    assert(
      bundle,
      `${choice.where} did not complete: its bundle has no manifest.json, and an older attempt is never used in its place. ${RERUN_FAILED}`
    );
    const recordedShard = bundle.manifest?.shard?.index,
      recordedAttempt = bundle.manifest?.snapshot?.provider?.attempt;
    assert(
      recordedShard === choice.index &&
        recordedAttempt === String(choice.attempt),
      `${choice.where} (${choice.entry.name}) records shard ${recordedShard}, records attempt ${recordedAttempt} in its manifest. ${RERUN_ALL}`
    );
    return {
      index: choice.index,
      attempt: choice.attempt,
      name: choice.entry.name,
      bundle,
    };
  });
  return {
    trace: mergeBundles(
      snapshot,
      selected.map(choice => choice.bundle)
    ),
    selected,
  };
}

/** Collect and combine complete native shell-guard shard receipts. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  guardPopulation,
  tracerIndex,
} from "./shell-guard-refusal-coverage.mjs";
import {
  identityHash,
  mergeBundles,
  nativeArgv,
  parseShard,
  sha256,
  validateBundle,
  validateSnapshot,
} from "./shell-guard-shards.mjs";

const INDEX_FILE = "guard-index.json";
const EXECUTION_FILE = "execution.json";
const STDOUT_FILE = "stdout.log";
const STDERR_FILE = "stderr.log";
const RUN_TIMEOUT_MS = 45 * 60_000;
const GIT_TIMEOUT_MS = 60_000;
const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;
const SOURCES = [
  "scripts/check-shell-guard-refusal-coverage.mjs",
  "scripts/lib/shell-guard-trace.mjs",
  "scripts/lib/shell-guard-refusal-coverage.mjs",
  "scripts/lib/shell-guard-shards.mjs",
  "scripts/lib/shell-guard-shard-runner.mjs",
  "scripts/lib/shell-guard-terminal-reporter.mjs",
  "vitest.config.ts",
  "vitest.config.local.ts",
  "vitest.thresholds.json",
  "bun.lock",
  "package.json",
  ".github/workflows/plugins-sync.yml",
  "dist/cli/lisa-test-run.js",
  "node_modules/vitest/package.json",
  "node_modules/vitest/vitest.mjs",
];
const git = (root, args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
const bytes = file => {
  const stat = lstatSync(file);
  assert(
    stat.isFile() && stat.size <= MAX_ARTIFACT_BYTES,
    "missing/link/oversized artifact"
  );
  return readFileSync(file);
};
function provider() {
  const row = {
    runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
    sourceSha: process.env.GITHUB_SHA,
    prHead: process.env.LISA_GUARD_PR_HEAD,
    workflowRef: process.env.GITHUB_WORKFLOW_REF,
  };
  assert(
    Object.values(row).every(
      value => typeof value === "string" && value.length > 0
    ),
    "actual native Actions provenance required for shard mode"
  );
  return row;
}
function binary(file) {
  assert(
    typeof file === "string" && path.isAbsolute(file),
    "qualified executable missing"
  );
  const actual = realpathSync(file);
  return {
    sha256: sha256(bytes(actual)),
    version: execFileSync(actual, ["--version"], {
      encoding: "utf8",
      timeout: 15_000,
    }).trim(),
  };
}
function codeFiles(root, directory) {
  const files = [];
  const walk = current => {
    for (const entry of readdirSync(path.join(root, current), {
      withFileTypes: true,
    })) {
      const file = path.join(current, entry.name);
      assert(!entry.isSymbolicLink(), "unexpected linked code member");
      if (entry.isDirectory()) walk(file);
      else if (/\.(?:js|mjs|ts)$/u.test(entry.name)) files.push(file);
      assert(files.length <= 50_000, "code inventory exceeds finite bound");
    }
  };
  walk(directory);
  return files.sort();
}
export function snapshot(root, discover) {
  // A dirty tracked tree cannot claim the immutable HEAD/tree it names.
  execFileSync("git", ["diff", "--quiet", "HEAD", "--"], {
    cwd: root,
    timeout: GIT_TIMEOUT_MS,
  });
  const head = git(root, ["rev-parse", "HEAD"]),
    tree = git(root, ["rev-parse", "HEAD^{tree}"]);
  const candidates = discover(root).map(file => ({
    path: file,
    sha256: sha256(readFileSync(path.join(root, file))),
  }));
  const population = guardPopulation(root);
  const bunPath = execFileSync("bun", ["-p", "process.execPath"], {
    encoding: "utf8",
    timeout: 15_000,
  }).trim();
  const runtime = {
    node: binary(process.execPath),
    abi: process.versions.modules,
    platform: process.platform,
    arch: process.arch,
    bun: binary(bunPath),
    updaterNode: binary(process.env.LISA_TEST_UPDATER_NODE),
    nativeHostBun: binary(process.env.LISA_TEST_HOST_BUN),
  };
  const row = {
    head,
    tree,
    provider: provider(),
    candidates,
    candidateHash: identityHash(candidates),
    population,
    populationHash: identityHash(population),
    scriptHashes: Object.fromEntries(
      [
        ...SOURCES,
        ...codeFiles(root, "src/configs/vitest"),
        ...codeFiles(root, "dist/configs/vitest"),
        ...codeFiles(root, "node_modules/vitest/dist"),
      ].map(file => [file, sha256(bytes(path.join(root, file)))])
    ),
    runtime,
  };
  return validateSnapshot(row);
}
function value(args, flag) {
  const indexes = args.flatMap((arg, at) => (arg === flag ? [at] : []));
  assert(
    indexes.length === 1 &&
      args[indexes[0] + 1] &&
      !args[indexes[0] + 1].startsWith("--"),
    `explicit unique ${flag} required`
  );
  return args[indexes[0] + 1];
}

export function collectShard(root, discover, args) {
  assert(!args.includes("--trace") && !args.includes("--merge-traces"));
  const shard = parseShard(value(args, "--shard"));
  const tracePath = path.resolve(root, value(args, "--trace-out"));
  // Require a newly owned per-shard directory. No stale files can survive a retry.
  const directory = path.dirname(tracePath);
  assert(
    directory !== root && path.basename(tracePath) === "trace.jsonl",
    "owned trace directory/trace.jsonl required"
  );
  mkdirSync(directory, { recursive: false, mode: 0o700 });
  assert(
    realpathSync(directory) === directory,
    "symlinked collection directory"
  );
  const before = snapshot(root, discover);
  const reportPath = path.join(directory, "results.json"),
    terminalPath = path.join(directory, "terminal.json");
  writeFileSync(tracePath, "", { flag: "wx" });
  writeFileSync(
    path.join(directory, INDEX_FILE),
    JSON.stringify(tracerIndex(before.population)),
    { flag: "wx" }
  );
  const command = path.join(root, "node_modules/.bin/vitest");
  const argv = nativeArgv(root, directory, shard, before.candidates);
  const stdout = openSync(path.join(directory, STDOUT_FILE), "wx"),
    stderr = openSync(path.join(directory, STDERR_FILE), "wx");
  const startedAt = new Date().toISOString();
  let child;
  console.log(
    `Collecting native shard ${shard.index}/${shard.total} from ALL ${before.candidates.length} candidates; raw logs: ${directory}`
  );
  try {
    child = spawnSync(command, argv, {
      cwd: root,
      timeout: RUN_TIMEOUT_MS,
      stdio: ["ignore", stdout, stderr],
      env: {
        ...process.env,
        LISA_SHELL_GUARD_TRACE: tracePath,
        LISA_SHELL_GUARD_INDEX: path.join(directory, INDEX_FILE),
        LISA_GUARD_TERMINAL_REPORT: terminalPath,
        NODE_OPTIONS:
          `${process.env.NODE_OPTIONS ?? ""} --import=${path.join(root, "scripts/lib/shell-guard-trace.mjs")}`.trim(),
      },
    });
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
  const execution = {
    command,
    argv,
    startedAt,
    endedAt: new Date().toISOString(),
    status: child.status,
    signal: child.signal,
    error: child.error ? String(child.error) : null,
  };
  writeFileSync(
    path.join(directory, EXECUTION_FILE),
    JSON.stringify(execution)
  );
  assert(
    execution.status === 0 &&
      execution.signal === null &&
      execution.error === null,
    "native shard failed/killed/not started; no eligible manifest"
  );
  assert.deepEqual(
    snapshot(root, discover),
    before,
    "source/runtime changed during shard"
  );
  const traceRaw = bytes(tracePath).toString("utf8"),
    reportRaw = bytes(reportPath).toString("utf8"),
    terminalRaw = bytes(terminalPath).toString("utf8");
  assert(process.env.GITHUB_JOB, "actual producer job identifier required");
  const raw = Object.fromEntries(
    [INDEX_FILE, EXECUTION_FILE, STDOUT_FILE, STDERR_FILE].map(name => [
      name,
      bytes(path.join(directory, name)),
    ])
  );
  const manifest = {
    schema: 1,
    complete: true,
    snapshot: before,
    shard,
    checkoutRoot: root,
    artifactRoot: directory,
    producerJob: process.env.GITHUB_JOB,
    child: execution,
    rawHashes: Object.fromEntries(
      Object.entries(raw).map(([name, data]) => [name, sha256(data)])
    ),
    traceSha256: sha256(traceRaw),
    reportSha256: sha256(reportRaw),
    terminalSha256: sha256(terminalRaw),
  };
  // Derive names ONLY from the actual terminal native reporter, never a guessed shard algorithm.
  const names = JSON.parse(reportRaw)
    .testResults.map(file =>
      path.relative(root, file.name).split(path.sep).join("/")
    )
    .sort((a, b) => a.localeCompare(b));
  manifest.reportedFiles = names;
  manifest.reportedFileCount = names.length;
  validateBundle({
    snapshot: before,
    manifest,
    traceRaw,
    reportRaw,
    terminalRaw,
    indexRaw: raw[INDEX_FILE].toString("utf8"),
    executionRaw: raw[EXECUTION_FILE].toString("utf8"),
    stdoutRaw: raw[STDOUT_FILE],
    stderrRaw: raw[STDERR_FILE],
  });
  writeFileSync(
    path.join(directory, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    { flag: "wx" }
  );
  console.log(
    `Eligible completed native shard ${shard.index}/${shard.total}: ${names.length} reported files`
  );
}

export function mergeCollected(root, discover, args) {
  assert(
    !args.includes("--collect-only") &&
      !args.includes("--shard") &&
      !args.includes("--trace")
  );
  const directory = path.resolve(root, value(args, "--merge-traces"));
  assert(
    directory !== root &&
      realpathSync(directory) === directory &&
      lstatSync(directory).isDirectory(),
    "explicit owned download directory required"
  );
  const entries = readdirSync(directory, { withFileTypes: true });
  const current = snapshot(root, discover);
  const prefix = `lisa-shell-guard-${current.provider.runId}-${current.provider.attempt}-shard-`;
  assert(
    entries.length === 3 &&
      entries.every(
        entry =>
          entry.isDirectory() &&
          [1, 2, 3].some(index => entry.name === prefix + index)
      ),
    "missing/extra/nonowned/stale-attempt shard bundle"
  );
  const bundles = entries.map(entry => {
    const base = path.join(directory, entry.name);
    assert(realpathSync(base) === base);
    const manifestRaw = bytes(path.join(base, "manifest.json")).toString(
      "utf8"
    );
    const manifest = JSON.parse(manifestRaw);
    assert(
      entry.name === prefix + manifest.shard.index,
      "bundle name/shard mismatch"
    );
    return {
      manifest,
      manifestRaw,
      traceRaw: bytes(path.join(base, "trace.jsonl")).toString("utf8"),
      reportRaw: bytes(path.join(base, "results.json")).toString("utf8"),
      terminalRaw: bytes(path.join(base, "terminal.json")).toString("utf8"),
      indexRaw: bytes(path.join(base, INDEX_FILE)).toString("utf8"),
      executionRaw: bytes(path.join(base, EXECUTION_FILE)).toString("utf8"),
      stdoutRaw: bytes(path.join(base, STDOUT_FILE)),
      stderrRaw: bytes(path.join(base, STDERR_FILE)),
    };
  });
  const trace = mergeBundles(current, bundles);
  const target = path.resolve(root, value(args, "--trace-out"));
  mkdirSync(path.dirname(target), { recursive: true });
  // Aggregate provenance says complete shards were validated, not that guards passed.
  const provenance = {
    schema: 1,
    snapshot: current,
    traceSha256: sha256(trace),
    reportedFileCount: current.candidates.length,
    shards: bundles.map(bundle => ({
      index: bundle.manifest.shard.index,
      manifestSha256: sha256(bundle.manifestRaw),
      producerJob: bundle.manifest.producerJob,
      child: bundle.manifest.child,
    })),
    scope:
      "complete current native shards validated; ONE existing guard judgment remains required",
    providerArtifactDigestVerified: false,
  };
  writeFileSync(target, trace);
  writeFileSync(
    `${target}.provenance.json`,
    JSON.stringify(provenance, null, 2)
  );
  return {
    trace,
    suites: current.candidates.length,
    ok: true,
    detail: "",
    snapshot: current,
  };
}

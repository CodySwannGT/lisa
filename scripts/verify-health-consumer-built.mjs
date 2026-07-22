#!/usr/bin/env node
/** Built-package proof for the real two-phase Health CLI consumer. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let assertions = 0;
const check = (condition, message) => {
  assertions += 1;
  assert.ok(condition, message);
};
const equal = (actual, expected, message) => {
  assertions += 1;
  assert.deepEqual(actual, expected, message);
};
const printStateDump = (name, payload) => {
  const serialized = JSON.stringify({ name, ...payload });
  check(
    Buffer.byteLength(serialized, "utf8") <= 16 * 1024,
    `${name} state dump stays within 16 KiB`
  );
  console.log(serialized);
};

const root = process.cwd();
const cli = path.join(root, "dist", "index.js");
const workspace = await mkdtemp(path.join(tmpdir(), "lisa-health-consumer-"));

/** Create the smallest stable real project accepted by Health collection. */
async function createProject(name) {
  const project = path.join(workspace, name);
  await mkdir(project, { recursive: true });
  await writeFile(
    path.join(project, ".lisa.config.json"),
    `${JSON.stringify({ harness: "fleet" }, null, 2)}\n`
  );
  return project;
}

/** Run the compiled CLI and capture its exact standard-output bytes. */
function runCli(project, argv, input) {
  return execFileSync(
    process.execPath,
    [cli, "--no-update-check", "health", ...argv, project],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, LISA_SKIP_UPDATE_CHECK: "1" },
      input,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
}

/** Return whether the canonical result exists without throwing on absence. */
async function resultExists(project) {
  return lstat(path.join(project, ".lisa", "health", "latest.json"))
    .then(() => true)
    .catch(() => false);
}

/** Prepare the real CLI protocol and prove it performs no storage mutation. */
async function prepare(project) {
  const before = await resultExists(project);
  const stdout = runCli(project, ["--prepare-agentic"]);
  const after = await resultExists(project);
  equal(before, false, "fresh prepare fixture has no latest result");
  equal(after, false, "prepare creates no latest result");
  const envelope = JSON.parse(stdout);
  equal(envelope.protocolVersion, 1, "prepare emits protocol version 1");
  check(
    /^[a-f0-9]{64}$/u.test(envelope.requestDigest),
    "prepare emits a SHA-256 request digest"
  );
  check(
    envelope.request?.schemaVersion === 1,
    "prepare emits the bounded evaluator request"
  );
  return envelope;
}

/** Validate one final CLI result against its exact persisted representation. */
async function validateFinal(project, stdout, expectedMode) {
  const resultPath = path.join(project, ".lisa", "health", "latest.json");
  const persisted = await readFile(resultPath, "utf8");
  equal(stdout, persisted, `${expectedMode} stdout equals persisted bytes`);
  const result = JSON.parse(stdout);
  equal(result.mode, expectedMode, `final result is ${expectedMode}`);
  equal(
    (await readdir(path.dirname(resultPath))).sort(),
    ["latest.json"],
    "one final result remains with no temporary or lock artifact"
  );
  return result;
}

/** Finalize through stdin using a digest-bound evaluator response. */
async function finalize(project, response, expectedMode) {
  const stdout = runCli(
    project,
    ["--agentic-evaluation"],
    `${JSON.stringify(response)}\n`
  );
  return validateFinal(project, stdout, expectedMode);
}

try {
  check(await lstat(cli).then(stat => stat.isFile()), "compiled CLI exists");
  const health = await import("@codyswann/lisa/health");
  check(
    typeof health.runPersistedHealth === "function",
    "compiled health consumer export resolves"
  );

  const builtPrepare = await readFile(
    path.join(root, "dist", "health", "prepare.js"),
    "utf8"
  );
  const builtConsumer = await readFile(
    path.join(root, "dist", "health", "consumer.js"),
    "utf8"
  );
  check(
    !builtPrepare.includes("storage.js") &&
      !builtPrepare.includes("writeLatestHealthResult"),
    "built prepare phase has no storage dependency"
  );
  equal(
    builtConsumer.match(/\bwriteLatestHealthResult\(/gu)?.length ?? 0,
    1,
    "built final consumer contains exactly one storage write call"
  );

  const defaultProject = await createProject("default");
  const defaultResult = await validateFinal(
    defaultProject,
    runCli(defaultProject, []),
    "deterministic"
  );

  const unavailableProject = await createProject("unavailable");
  const unavailablePrepared = await prepare(unavailableProject);
  const unavailableResult = await finalize(
    unavailableProject,
    {
      protocolVersion: 1,
      requestDigest: unavailablePrepared.requestDigest,
      evaluation: { status: "unavailable" },
    },
    "deterministic"
  );

  const completedProject = await createProject("completed");
  const completedPrepared = await prepare(completedProject);
  const completedResult = await finalize(
    completedProject,
    {
      protocolVersion: 1,
      requestDigest: completedPrepared.requestDigest,
      evaluation: {
        status: "completed",
        judgments: [
          {
            check: "agentic.fixture-review",
            reason: "The fixture demonstrates completed harness judgment.",
          },
        ],
      },
    },
    "full"
  );
  check(
    completedResult.findings.some(
      finding =>
        finding.check === "agentic.fixture-review" &&
        finding.layer === "agentic" &&
        finding.status === "warn"
    ),
    "completed response is composed by the shipped API"
  );

  const staleProject = await createProject("stale");
  const stalePrepared = await prepare(staleProject);
  await writeFile(
    path.join(staleProject, "eslint.config.local.ts"),
    "export default [{ rules: { semi: 'off' } }];\n"
  );
  const staleResult = await finalize(
    staleProject,
    {
      protocolVersion: 1,
      requestDigest: stalePrepared.requestDigest,
      evaluation: {
        status: "completed",
        judgments: [
          {
            check: "agentic.stale-judgment",
            reason: "This judgment must not survive changed evidence.",
          },
        ],
      },
    },
    "deterministic"
  );
  check(
    !staleResult.findings.some(
      finding => finding.check === "agentic.stale-judgment"
    ),
    "stale digest never composes its judgment"
  );

  console.log("[EVIDENCE: health-consumer-prepare-no-write]");
  console.log("[EVIDENCE: health-consumer-one-final-write]");
  console.log("[EVIDENCE: health-consumer-output-storage-parity]");
  printStateDump("health-consumer-cli-modes", {
    default: defaultResult.mode,
    unavailable: unavailableResult.mode,
    completed: completedResult.mode,
    stale: staleResult.mode,
    prepareLatestJsonMutation: false,
    builtFinalWriteCalls: 1,
    stdoutMatchesPersisted: true,
  });
  console.log("[EVIDENCE: state-dump: health-consumer-cli-modes]");
  check(assertions > 0, "proof must execute assertions");
  console.log(`health-consumer assertions=${assertions}`);
} finally {
  await rm(workspace, { recursive: true, force: true });
}

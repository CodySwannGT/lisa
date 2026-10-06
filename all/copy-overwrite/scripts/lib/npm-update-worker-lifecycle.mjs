// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Parent registry and real daemon exit/removal own every worker lifecycle verdict. @module npm-updater */
import { required, UpdaterError } from "./npm-update-contract.mjs";
import { canonicalJson } from "../lisa-automation-provenance.mjs";
import { readBytes, runProcess } from "./npm-update-process.mjs";
import { sha256 } from "./github-attestation-verifier.mjs";
import {
  constants,
  openSync,
  closeSync,
  readSync,
  fstatSync,
  lstatSync,
  realpathSync,
} from "node:fs";
import { createHash } from "node:crypto";
import {
  registerNamespace,
  assignNamespaceId,
  namespaceRecords,
  completeNamespace,
} from "./npm-update-orchestrator.mjs";
import { workerArguments } from "./npm-update-worker-policy.mjs";
import { workerEnvironment } from "./npm-update-worker-environment.mjs";
import { assertWorkerInspection } from "./npm-update-worker-inspection.mjs";

/** Only the parent-qualified Docker executable can create or observe a candidate namespace. */
export function dockerClient(boundary) {
  const stat = lstatSync(boundary.docker);
  required(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      realpathSync(boundary.docker) === boundary.docker &&
      /^[a-f0-9]{64}$/.test(boundary.dockerSha256) &&
      binaryDigest(boundary.docker) === boundary.dockerSha256,
    "Docker controller binary is unqualified"
  );
  const env = {
    PATH: "/usr/bin:/bin",
    HOME: process.env.HOME,
    LANG: "C.UTF-8",
  };
  return (args, options = {}) =>
    runProcess(boundary.docker, args, { env, maximum: 8_388_608, ...options });
}

/** Large native tools are hashed through a no-follow descriptor and a bounded streaming buffer. */
export function binaryDigest(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    required(
      stat.isFile() && stat.size > 0 && stat.size <= 150_000_000,
      "controller binary exceeds bound"
    );
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(65_536);
    let total = 0;
    let count;
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      total += count;
      required(total <= stat.size, "controller binary changed while hashing");
      hash.update(buffer.subarray(0, count));
    }
    required(total === stat.size, "controller binary length changed");
    return hash.digest("hex");
  } finally {
    closeSync(fd);
  }
}

/** Readback checks ownership before every lifecycle mutation; foreign IDs are never removed. */
async function ownedInspection(docker, id, boundary) {
  const result = await docker(["inspect", "--type", "container", id]);
  const entries = JSON.parse(result.stdout.toString());
  required(
    Array.isArray(entries) &&
      entries.length === 1 &&
      entries[0].Id === id &&
      entries[0].Image === boundary.image &&
      entries[0].Config?.Labels?.["dev.lisa.npm.owner"] === boundary.nonce &&
      (!boundary.name || entries[0].Name === `/${boundary.name}`),
    "container ownership readback differs"
  );
  return entries[0];
}

/** Recovery never removes a foreign object or infers daemon absence from an inspect error. */
async function reapRegistration(docker, entry) {
  const { record } = entry;
  let removedId = record.id;
  const observed = await docker(
    ["inspect", "--type", "container", record.id ?? record.name],
    { allowed: [0, 1] }
  );
  if (observed.code === 0) {
    const values = JSON.parse(observed.stdout.toString());
    required(
      Array.isArray(values) &&
        values.length === 1 &&
        /^[a-f0-9]{64}$/.test(values[0].Id),
      "namespace recovery inspection differs"
    );
    const id = values[0].Id;
    removedId = id;
    required(
      record.id === null || record.id === id,
      "namespace recovery ID differs"
    );
    await ownedInspection(docker, id, { ...record, name: record.name });
    if (record.id === null) assignNamespaceId(entry.file, id);
    await docker(["rm", "--force", id]);
  }
  const absent = await docker([
    "ps",
    "--all",
    "--quiet",
    "--no-trunc",
    "--filter",
    `name=^/${record.name}$`,
  ]);
  required(
    absent.stdout.toString().trim() === "",
    "registered owned namespace still exists"
  );
  if (removedId) {
    const byId = await docker([
      "ps",
      "--all",
      "--quiet",
      "--no-trunc",
      "--filter",
      `id=${removedId}`,
    ]);
    required(
      byId.stdout.toString().trim() === "",
      "registered owned namespace ID still exists"
    );
  }
  required(
    record.id !== null || observed.code === 0,
    "unconfirmed namespace creation remains registered"
  );
  completeNamespace(entry.file, true);
}

/** The guest deadline never expands the existing outer process budget. */
export function workerCaptureBudget(deadlineMs) {
  required(
    Number.isSafeInteger(deadlineMs) &&
      deadlineMs > 0 &&
      deadlineMs <= 1_800_000,
    "invalid worker capture deadline"
  );
  return Math.min(deadlineMs + 6000, 1_800_000);
}

/** Dead-caller recovery covers created-but-unstarted objects before any new execution/sealing. */
export async function recoverWorkers(boundary) {
  const docker = dockerClient(boundary);
  const entries = namespaceRecords(boundary.root);
  for (const entry of entries) {
    let alive = true;
    try {
      process.kill(entry.record.callerPid, 0);
    } catch (error) {
      required(
        error.code === "ESRCH",
        "registered caller visibility is unavailable"
      );
      alive = false;
    }
    required(!alive, "registered namespace belongs to a live caller");
    await reapRegistration(docker, entry);
  }
  required(
    namespaceRecords(boundary.root).length === 0,
    "owned namespace recovery remains outstanding"
  );
}

/** Daemon exit and whole-namespace removal decide the result, never a writable guest receipt. */
export async function executeWorker(boundary, invocation, { input, env } = {}) {
  const args = workerArguments(
    boundary,
    invocation,
    workerEnvironment(env, boundary)
  );
  required(
    sha256(
      `${canonicalJson(JSON.parse(readBytes(boundary.seccompPath, 1_048_576).toString()))}\n`
    ) === boundary.seccompSha256,
    "worker seccomp input bytes differ"
  );
  const docker = dockerClient(boundary);
  const registration = registerNamespace(boundary);
  args.splice(1, 0, "--name", registration.record.name);
  try {
    const created = await docker(args);
    const id = created.stdout.toString().trim();
    required(/^[a-f0-9]{64}$/.test(id), "Docker returned an invalid worker ID");
    assignNamespaceId(registration.file, id);
    const ownedBoundary = { ...boundary, name: registration.record.name };
    assertWorkerInspection(
      await ownedInspection(docker, id, ownedBoundary),
      boundary,
      invocation
    );
    const attached = await docker(["start", "--attach", "--interactive", id], {
      input,
      timeout: workerCaptureBudget(boundary.deadlineMs),
      allowed: Array.from({ length: 256 }, (_, code) => code),
    });
    const waited = (await docker(["wait", id])).stdout.toString().trim();
    required(
      /^(?:0|[1-9]\d{0,2})$/.test(waited) && Number(waited) <= 255,
      "Docker returned an invalid actual worker exit"
    );
    const inspected = await ownedInspection(docker, id, ownedBoundary);
    if (
      !(
        inspected.State?.Running === false &&
        inspected.State?.ExitCode === Number(waited) &&
        attached.code === Number(waited) &&
        !inspected.State?.OOMKilled &&
        !inspected.State?.Error
      )
    )
      throw Object.assign(
        new UpdaterError(
          "worker actual status/attach differs or worker was killed"
        ),
        {
          workerDiagnostic: {
            attach: attached.code,
            wait: Number(waited),
            state: inspected.State,
            stderr: attached.stderr.toString(),
          },
        }
      );
    return {
      code: Number(waited),
      stdout: attached.stdout,
      stderr: attached.stderr,
    };
  } finally {
    const active = namespaceRecords(boundary.root).find(
      entry => entry.file === registration.file
    );
    required(active, "owned namespace registration disappeared");
    await reapRegistration(docker, active);
  }
}

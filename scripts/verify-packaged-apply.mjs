#!/usr/bin/env node
/** Genuine packaged verification with a checked disposable filesystem boundary. */
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";

import {
  assertDisposableContainer,
  compareSnapshots,
  preserveUnexpectedWrite,
  refuseHostApply,
  snapshotFiles,
} from "./lib/packaged-apply-isolation.mjs";

const execute = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, "..");
const harnesses = [
  "claude",
  "codex",
  "cursor",
  "opencode",
  "agy",
  "copilot",
  "devin",
  "fleet",
];

/**
 * Bounded native command; no shell interpolation or operator credentials passed
 * to the container. Docker itself retains its normal local daemon access.
 * @param {string[]} args - Literal Docker arguments.
 * @returns {Promise<string>} Native stdout.
 */
async function docker(args) {
  const result = await execute("docker", args, {
    encoding: "utf8",
    timeout: 25 * 60_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return result.stdout;
}

/**
 * `docker start --attach` failing says nothing about why; carry the driver's
 * own recorded assertion so every caller sees it (CodySwannGT/lisa#4822).
 * @param {Error} error - Container start failure.
 * @param {string} directory - Run output holding native-proof.json.
 * @returns {Promise<Error>} The same error, its message extended when known.
 */
async function withNativeFailure(error, directory) {
  try {
    const { failure } = JSON.parse(
      await readFile(path.join(directory, "native-proof.json"), "utf8")
    );
    if (failure)
      error.message += `\nNative driver failure: ${failure.stack ?? failure.message}`;
  } catch {
    // An unreadable proof must not replace the original failure.
  }
  return error;
}

/**
 * @param {string} directory - Newly owned output directory.
 * @param {string} name - Private evidence filename.
 * @param {unknown} value - Evidence without raw operator configuration.
 * @returns {Promise<void>}
 */
async function record(directory, name, value) {
  await writeFile(
    path.join(directory, name),
    `${JSON.stringify(value, null, 2)}\n`,
    {
      mode: 0o600,
      flag: "wx",
    }
  );
}

/** @returns {Promise<void>} CLI action. */
async function main() {
  const { values } = parseArgs({
    options: {
      backend: { type: "string", default: "host" },
      archive: { type: "string" },
      image: { type: "string" },
      harness: { type: "string", default: "codex" },
      output: { type: "string" },
      preserve: { type: "string", multiple: true, default: [] },
      "failure-control": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(
      "Usage: node scripts/verify-packaged-apply.mjs --backend docker --archive FILE --image IMAGE --output NEW_DIRECTORY [--harness codex|fleet|claude|cursor|opencode|agy|copilot|devin] [--preserve FILE ...] [--failure-control]"
    );
    console.log(
      "Default host preflight refuses without spawning apply. Build scripts/fixtures/packaged-apply/Dockerfile first. No host mounts or operator environment are forwarded."
    );
    return;
  }
  if (!harnesses.includes(values.harness))
    throw new Error("Unsupported harness");
  if (values["failure-control"] && !["fleet", "agy"].includes(values.harness)) {
    throw new Error("The failed-child control requires --harness fleet or agy");
  }
  const { defaultUserMcpConfigPath } = await import(
    pathToFileURL(path.join(packageRoot, "dist/agy/mcp-installer.js")).href
  );
  const agyDestination = defaultUserMcpConfigPath();
  if (values.backend === "host")
    refuseHostApply(values.harness, agyDestination);
  if (
    values.backend !== "docker" ||
    !values.archive ||
    !values.image ||
    !values.output
  ) {
    throw new Error(
      "Docker verification requires --archive FILE --image IMAGE --output NEW_DIRECTORY"
    );
  }
  const archive = path.resolve(values.archive);
  const archiveBytes = await readFile(archive);
  const output = path.resolve(values.output);
  await mkdir(output, { mode: 0o700 });
  const ownedArchive = path.join(output, "input.tgz");
  // Docker may retain the copying client's UID. Keep this public package
  // readable inside the capability-dropped container; its host parent is 0700.
  await writeFile(ownedArchive, archiveBytes, { mode: 0o644, flag: "wx" });
  await chmod(ownedArchive, 0o644);
  const driverBytes = await readFile(
    path.join(import.meta.dirname, "lib/packaged-apply-driver.mjs")
  );
  const driverCopy = path.join(output, "driver.mjs");
  await writeFile(driverCopy, driverBytes, { mode: 0o644, flag: "wx" });
  await chmod(driverCopy, 0o644);
  const casesBytes = await readFile(
    path.join(import.meta.dirname, "fixtures/packaged-apply/guard-cases.json")
  );
  const casesCopy = path.join(output, "guard-cases.json");
  await writeFile(casesCopy, casesBytes, { mode: 0o644, flag: "wx" });
  await chmod(casesCopy, 0o644);
  const files = [
    ...new Set([
      agyDestination,
      path.join(os.homedir(), ".claude/settings.json"),
      path.join(os.homedir(), ".claude/plugins/known_marketplaces.json"),
      path.join(os.homedir(), ".codex/config.toml"),
      ...values.preserve.map(file => path.resolve(file)),
    ]),
  ];
  const before = await snapshotFiles(files, path.join(output, "before-images"));
  await record(output, "before.json", before);
  const image = JSON.parse(await docker(["image", "inspect", values.image]))[0];
  if (!/^sha256:[a-f0-9]{64}$/u.test(image?.Id ?? ""))
    throw new Error("Unresolved Docker image identity");
  let id;
  let failure;
  let cleanupError;
  let preservation = false;
  try {
    id = (
      await docker([
        "create",
        "--name",
        `lisa-verify-${randomUUID()}`,
        "--label",
        "lisa.verification=packaged-apply",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--network",
        "bridge",
        "--ipc",
        "private",
        "--cgroupns",
        "private",
        "--pids-limit",
        "512",
        "--memory",
        "4g",
        "--cpus",
        "2",
        "--env",
        "LISA_DISPOSABLE_APPLY=1",
        "--entrypoint",
        "/usr/bin/timeout",
        image.Id,
        "--signal=TERM",
        "--kill-after=10s",
        "20m",
        "/usr/local/bin/node",
        "/lisa-verify-driver.mjs",
        values.harness,
        ...(values["failure-control"] ? ["failure-control"] : []),
      ])
    ).trim();
    const inspected = JSON.parse(await docker(["inspect", id]))[0];
    assertDisposableContainer(inspected, id);
    await record(output, "preflight.json", {
      container_id: id,
      image_id: image.Id,
      archive_sha256: createHash("sha256").update(archiveBytes).digest("hex"),
      driver_sha256: createHash("sha256").update(driverBytes).digest("hex"),
      guard_cases_sha256: createHash("sha256").update(casesBytes).digest("hex"),
      harness: values.harness,
      mounts: inspected.Mounts,
      inspection: {
        Id: inspected.Id,
        State: inspected.State,
        Mounts: inspected.Mounts,
        HostConfig: Object.fromEntries(
          [
            "Binds",
            "Mounts",
            "VolumesFrom",
            "Privileged",
            "Devices",
            "DeviceRequests",
            "CapAdd",
            "CapDrop",
            "SecurityOpt",
            "NetworkMode",
            "PidMode",
            "IpcMode",
            "UsernsMode",
            "CgroupnsMode",
          ].map(key => [key, inspected.HostConfig[key] ?? null])
        ),
      },
      isolation:
        "disposable root filesystem; no host mounts or shared namespaces",
      operator_home_overridden: false,
      operator_credentials_forwarded: false,
      host_destinations: files,
    });
    await docker(["cp", ownedArchive, `${id}:/lisa-input.tgz`]);
    await docker(["cp", driverCopy, `${id}:/lisa-verify-driver.mjs`]);
    await docker(["cp", casesCopy, `${id}:/lisa-guard-cases.json`]);
    let stdout = "";
    let childFailure;
    try {
      stdout = await docker(["start", "--attach", id]);
    } catch (error) {
      stdout = error.stdout ?? "";
      childFailure = error;
    }
    await writeFile(path.join(output, "container.stdout.log"), stdout, {
      mode: 0o600,
      flag: "wx",
    });
    const terminal = JSON.parse(await docker(["inspect", id]))[0];
    await record(output, "terminal.json", terminal.State);
    await docker([
      "cp",
      `${id}:/lisa-proof.json`,
      path.join(output, "native-proof.json"),
    ]);
    if (childFailure) throw await withNativeFailure(childFailure, output);
    if (terminal.State.Status !== "exited" || terminal.State.ExitCode !== 0) {
      throw new Error(
        `Native verification child exited ${terminal.State.ExitCode}`
      );
    }
  } catch (error) {
    failure = error;
    await record(output, "failure.json", {
      message: error.message,
      stdout: error.stdout ?? null,
      stderr: error.stderr ?? null,
    });
  } finally {
    // Stop every process in the owned namespace before examining host state.
    try {
      if (id) await docker(["rm", "--force", "--volumes", id]);
    } catch (error) {
      cleanupError = error;
    }
    const after = await snapshotFiles(
      files,
      path.join(output, "after-images"),
      { phase: "after" }
    );
    const changed = compareSnapshots(before, after);
    const recovery = [];
    for (const file of changed) {
      if (after[file]?.present)
        recovery.push({
          ...(await preserveUnexpectedWrite(
            file,
            path.join(output, "recovery")
          )),
          prior_content: Object.hasOwn(before, file)
            ? before[file].present
              ? "captured privately"
              : "absent"
            : "unknown",
        });
    }
    preservation = changed.length === 0;
    await record(output, "preservation.json", {
      before,
      after,
      changed,
      recovery,
      preserved: preservation,
      container_removed: Boolean(id) && !cleanupError,
      cleanup_error: cleanupError?.message ?? null,
      restoration_attempted: false,
      private_images:
        "before-images/ and after-images/; filenames are SHA256 of each absolute path; never publish these directories",
      limit:
        "Declared product-config destinations; Docker infrastructure bookkeeping is expected",
    });
  }
  if (cleanupError)
    throw new Error(
      `Could not stop/remove owned container ${id}: ${cleanupError.message}`
    );
  if (!preservation)
    throw new Error(
      `Unexpected outside write; stopped and preserved current bytes privately in ${output}`
    );
  if (failure) throw failure;
  console.log(
    JSON.stringify({
      output,
      harness: values.harness,
      preserved: preservation,
      native_agent_activation: "not established",
    })
  );
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

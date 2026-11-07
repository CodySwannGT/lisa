#!/usr/bin/env node
/** Run the codified package-update journey in a genuinely isolated filesystem. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const fixture = path.join(
  root,
  "scripts/fixtures/native-safety-net-retirement"
);
const args = process.argv.slice(2);
const CANDIDATE_OPTION = "--candidate";
const flags = new Set(["--out", CANDIDATE_OPTION, "--image"]);
assert.equal(args.length % 2, 0, "Each verifier option needs a value");
for (let index = 0; index < args.length; index += 2) {
  assert.ok(
    flags.delete(args[index]),
    `Unknown or duplicate verifier option: ${args[index]}`
  );
  assert.ok(
    args[index + 1] && !args[index + 1].startsWith("--"),
    "Verifier option needs a value"
  );
}
const option = name => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const out = path.resolve(
  option("--out") || mkdtempSync(path.join(tmpdir(), "lisa-retirement-proof-"))
);
mkdirSync(out, { recursive: true, mode: 0o700 });
assert.equal(
  readdirSync(out).length,
  0,
  "Choose a fresh evidence directory; earlier packets must be preserved"
);
const transcript = [];
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const record = (file, value) =>
  writeFileSync(path.join(out, file), `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });

/** Bounded controller process; all tool output is retained in the packet. */
function run(command, parameters, milliseconds = 25 * 60_000) {
  const result = spawnSync(command, parameters, {
    cwd: root,
    encoding: "utf8",
    timeout: milliseconds,
    maxBuffer: 32 * 1024 * 1024,
  });
  const row = {
    command,
    args: parameters,
    status: result.status,
    signal: result.signal,
    error: result.error?.message ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
  transcript.push(row);
  record("controller-transcript.json", transcript);
  assert.equal(result.error, undefined, JSON.stringify(row));
  assert.equal(result.signal, null, JSON.stringify(row));
  assert.equal(result.status, 0, JSON.stringify(row));
  return row.stdout;
}

/** Inspect the actual created container rather than trusting creation flags. */
function inspect(id) {
  const data = JSON.parse(run("docker", ["inspect", id], 30_000))[0];
  assert.equal(data.Id, id);
  assert.deepEqual(data.Mounts, []);
  const host = data.HostConfig;
  for (const key of [
    "Binds",
    "Mounts",
    "VolumesFrom",
    "Devices",
    "DeviceRequests",
    "CapAdd",
  ])
    assert.ok(host[key] == null || host[key].length === 0, key);
  assert.equal(host.Privileged, false);
  assert.ok(host.CapDrop.includes("ALL"));
  assert.deepEqual(host.SecurityOpt, ["no-new-privileges"]);
  assert.equal(host.NetworkMode, "bridge");
  assert.equal(host.PidMode, "");
  assert.equal(host.IpcMode, "private");
  assert.equal(host.CgroupnsMode, "private");
  return data;
}

/** Public immutable baseline bytes, pinned independently of registry metadata. */
async function baseline() {
  const metadataResponse = await fetch(
    "https://registry.npmjs.org/@codyswann%2Flisa/4.90.0",
    { signal: AbortSignal.timeout(60_000) }
  );
  assert.equal(metadataResponse.status, 200);
  const metadata = await metadataResponse.json();
  assert.equal(metadata.gitHead, "f7355b414bdf0c994b04fdb1cf9b0b8edc473ba9");
  const response = await fetch(
    "https://registry.npmjs.org/@codyswann/lisa/-/lisa-4.90.0.tgz",
    { signal: AbortSignal.timeout(120_000) }
  );
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  const measured = {
    sha256: sha(bytes),
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
  };
  assert.equal(
    measured.sha256,
    "9b8f63426cc9d75821a8e085842fd3cd053bd40d0b5502bec75cd89f41356fbf"
  );
  assert.equal(
    measured.integrity,
    "sha512-5CrCmSlov+Nj/1SuwHX9Nx4SHlezHc5e59Oest0oEnGrYOmJI3tuvBmLaHOHRnV+tlbAEf+ZO3aQ94I/GkZMdw=="
  );
  assert.equal(measured.integrity, metadata.dist.integrity);
  writeFileSync(path.join(out, "baseline.tgz"), bytes, { mode: 0o644 });
  record("baseline-identity.json", {
    version: "4.90.0",
    git_head: metadata.gitHead,
    ...measured,
  });
}

let id;
try {
  assert.ok(
    existsSync(path.join(fixture, "journey.mjs")),
    "Run the source checkout's verifier, which contains its codified fixture."
  );
  await baseline();
  const candidate = path.join(out, "candidate.tgz");
  if (option(CANDIDATE_OPTION))
    copyFileSync(path.resolve(option(CANDIDATE_OPTION)), candidate);
  else run("bun", ["pm", "pack", "--filename", candidate]);
  // Public archives and fixture programs need to be readable after docker cp
  // preserves the host UID into a capability-dropped container. Parent stays700.
  chmodSync(candidate, 0o644);
  record("candidate-identity.json", {
    archive_sha256: sha(readFileSync(candidate)),
    verification_driver_head: run("git", ["rev-parse", "HEAD"], 30_000).trim(),
    verification_driver_worktree_status: run(
      "git",
      ["status", "--porcelain"],
      30_000
    ),
    artifact_source: option(CANDIDATE_OPTION)
      ? "Caller-supplied immutable archive; source/release relationship must be verified separately"
      : "Packed from this checkout; dirty status is recorded and is not exact-commit proof",
    fixture: [
      "journey.mjs",
      "probes.mjs",
      "invoke-opencode.mjs",
      "Dockerfile",
      "reduced-core.mjs",
    ].map(file => ({
      file,
      sha256: sha(readFileSync(path.join(fixture, file))),
    })),
  });
  const image = option("--image") || "lisa-native-safety-net-retirement:v1";
  if (!option("--image")) run("docker", ["build", "--tag", image, fixture]);
  const imageData = JSON.parse(
    run("docker", ["image", "inspect", image], 30_000)
  )[0];
  const name = `lisa-native-safety-net-retirement-${randomUUID()}`;
  id = run(
    "docker",
    [
      "create",
      "--name",
      name,
      "--label",
      "lisa.verification=native-safety-net-retirement",
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
      "--entrypoint",
      "/usr/bin/timeout",
      imageData.Id,
      "--signal=TERM",
      "--kill-after=10s",
      "20m",
      "node",
      "/proof/journey.mjs",
    ],
    30_000
  ).trim();
  assert.match(id, /^[a-f0-9]{64}$/);
  record("container-lease.json", {
    id,
    name,
    image_id: imageData.Id,
    created_at: new Date().toISOString(),
  });
  record("isolation-inspection.json", inspect(id));
  run("docker", ["cp", `${fixture}/.`, `${id}:/proof`], 30_000);
  run(
    "docker",
    ["cp", path.join(out, "baseline.tgz"), `${id}:/baseline.tgz`],
    30_000
  );
  run("docker", ["cp", candidate, `${id}:/candidate.tgz`], 30_000);
  const output = run("docker", ["start", "--attach", id]);
  console.log(output);
  const finished = inspect(id);
  record("final-inspection.json", finished);
  assert.equal(finished.State.Running, false);
  assert.equal(finished.State.ExitCode, 0);
  run("docker", ["cp", `${id}:/evidence`, path.join(out, "runtime")], 30_000);
  const result = JSON.parse(
    readFileSync(path.join(out, "runtime/retirement-proof.json"), "utf8")
  );
  assert.match(result.outcome, /^PASS:/);
  record("result.json", {
    outcome: result.outcome,
    archive_sha256: sha(readFileSync(candidate)),
    runtime_proof_sha256: sha(
      readFileSync(path.join(out, "runtime/retirement-proof.json"))
    ),
    container_id: id,
    observed_at: new Date().toISOString(),
    limits: result.boundary,
  });
  console.log(`Evidence: ${out}`);
} finally {
  if (id) {
    // Collect failures too. Preserve the leased container for diagnosis; never
    // force-remove another process or silently overwrite a previous packet.
    const state = JSON.parse(run("docker", ["inspect", id], 30_000))[0];
    if (!state.State.Running && !existsSync(path.join(out, "runtime"))) {
      try {
        run(
          "docker",
          ["cp", `${id}:/evidence`, path.join(out, "runtime")],
          30_000
        );
      } catch (error) {
        console.error(`Evidence collection failed: ${error.message}`);
      }
    }
    record("last-inspection.json", state);
  }
}

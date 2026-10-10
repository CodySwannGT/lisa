// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Effective daemon observations must match all parent-selected namespace controls. @module npm-updater */
import { required } from "./npm-update-contract.mjs";
// Preload dependencies must not execute the entry CLI before instrumentation.
import { canonicalJson } from "./automation-provenance-contract.mjs";
import { sha256 } from "./github-attestation-verifier.mjs";
import { workerScratch } from "./npm-update-worker-policy.mjs";
import {
  inspectedEnvironment,
  isInstallerRole,
  assertRubyEnvironment,
} from "./npm-update-worker-environment.mjs";

/** Daemon inspection records the effective profile JSON rather than its caller filename. */
function inspectedSecurity(host, expected) {
  required(
    Array.isArray(host.SecurityOpt) &&
      host.SecurityOpt.length === 2 &&
      host.SecurityOpt[0] === "no-new-privileges" &&
      host.SecurityOpt[1].startsWith("seccomp="),
    "worker security options differ"
  );
  const profile = JSON.parse(host.SecurityOpt[1].slice(8));
  required(
    sha256(`${canonicalJson(profile)}\n`) === expected.seccompSha256,
    "worker effective kernel policy bytes differ"
  );
  required(
    host.PidsLimit === 512 &&
      host.Memory === 4_294_967_296 &&
      host.NanoCpus === 4_000_000_000,
    "worker resource limits differ"
  );
  required(
    [host.GroupAdd, host.ExtraHosts, host.Links, host.VolumesFrom].every(
      value => !value?.length
    ),
    "worker has supplementary or linked authority"
  );
  required(
    Array.isArray(host.ReadonlyPaths) &&
      [
        "/proc/bus",
        "/proc/fs",
        "/proc/irq",
        "/proc/sys",
        "/proc/sysrq-trigger",
      ].every(path => host.ReadonlyPaths.includes(path)),
    "worker proc policy is not read-only"
  );
  required(
    canonicalJson(host.Tmpfs) === canonicalJson(workerScratch(expected)),
    "worker scratch mounts differ"
  );
}

/** Every observed bind belongs to the exact parent-selected projection. */
function inspectedMounts(inspected, expected) {
  required(
    Array.isArray(inspected.Mounts) &&
      inspected.Mounts.length === expected.mounts.length,
    "worker has missing or extra mounts"
  );
  for (const mount of expected.mounts) {
    const matches = inspected.Mounts.filter(
      actual => actual.Destination === mount.target
    );
    required(
      matches.length === 1 &&
        matches[0].Type === "bind" &&
        matches[0].Source === mount.source &&
        matches[0].RW === !mount.readOnly,
      "worker input/control mount differs"
    );
  }
}

/** An actual inspected namespace must match every parent-selected mount and kernel flag. */
export function assertWorkerInspection(inspected, expected, invocation) {
  const user = isInstallerRole(expected.role)
    ? `${expected.uid}:${expected.gid}`
    : "2001:2001";
  required(
    /^[a-f0-9]{64}$/.test(inspected.Id) &&
      inspected.Image === expected.image &&
      inspected.Config?.User === user &&
      inspected.Config?.Labels?.["dev.lisa.npm.owner"] === expected.nonce,
    "worker ownership/image/user differs"
  );
  const host = inspected.HostConfig;
  required(
    host &&
      host.ReadonlyRootfs === true &&
      host.Privileged === false &&
      host.PidMode === "" &&
      host.IpcMode === "private" &&
      canonicalJson(host.CapDrop) === '["ALL"]' &&
      !host.CapAdd?.length,
    "worker namespace or capabilities differ"
  );
  inspectedSecurity(host, expected);
  required(
    canonicalJson(inspected.Config.Entrypoint) ===
      canonicalJson([expected.supervisor.path]) &&
      inspected.Config.Cmd?.[0] === String(expected.deadlineMs) &&
      inspected.Config.Cmd?.[1] === "--",
    "worker protected supervisor invocation differs"
  );
  if (invocation)
    required(
      canonicalJson(inspected.Config.Cmd.slice(2)) ===
        canonicalJson([invocation.command, ...invocation.args]),
      "worker original argv differs"
    );
  required(
    host.NetworkMode === expected.network &&
      expected.network !== "host" &&
      !host.Binds?.length &&
      !host.Devices?.length &&
      !host.DeviceRequests?.length,
    "worker has foreign network/device/bind authority"
  );
  inspectedEnvironment(inspected.Config.Env);
  assertRubyEnvironment(
    Object.fromEntries(
      inspected.Config.Env.map(value => [
        value.slice(0, value.indexOf("=")),
        value.slice(value.indexOf("=") + 1),
      ])
    ),
    expected
  );
  if (isInstallerRole(expected.role))
    required(
      inspected.Config.Env.every(
        value => !/^(?:GH_TOKEN|GITHUB_|DATABASE_)/.test(value)
      ),
      "installer contains provider or application credentials"
    );
  inspectedMounts(inspected, expected);
}

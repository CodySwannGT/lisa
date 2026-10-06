// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Closed worker roles, scratch and literal command data grant no controller authority. @module npm-updater */
import { required, keys } from "./npm-update-contract.mjs";
import { dirname, resolve } from "node:path";

import {
  inspectedEnvironment,
  isInstallerRole,
  assertRubyEnvironment,
} from "./npm-update-worker-environment.mjs";
export {
  inspectedEnvironment,
  isInstallerRole,
  workerEnvironment,
} from "./npm-update-worker-environment.mjs";

export function workerScratch(boundary) {
  const uid = boundary.uid ?? 2001;
  const gid = boundary.gid ?? 2001;
  return {
    "/tmp": "rw,nosuid,nodev,size=536870912,mode=1777",
    "/home/candidate": `rw,nosuid,nodev,size=536870912,uid=${uid},gid=${gid},mode=700`,
    [`${boundary.workspace}/tmp`]: `rw,nosuid,nodev,size=536870912,uid=${uid},gid=${gid},mode=700`,
  };
}

/** Only the fixed qualified protected parent accepts a bounded original deadline. */
function supervisorIdentity(boundary) {
  keys(boundary.supervisor, ["path", "version", "sha256"]);
  required(
    boundary.supervisor.path === "/usr/local/bin/lisa-npm-supervisor" &&
      boundary.supervisor.version === "lisa-npm-supervisor 1" &&
      /^[a-f0-9]{64}$/.test(boundary.supervisor.sha256) &&
      /^[a-f0-9]{64}$/.test(boundary.seccompSha256) &&
      Number.isSafeInteger(boundary.deadlineMs) &&
      boundary.deadlineMs >= 1 &&
      boundary.deadlineMs <= 1_800_000,
    "unqualified supervisor or bounded deadline"
  );
}

/** Closed inputs are validated before any Docker argument is constructed. */
function validateBoundary(boundary, invocation) {
  keys(boundary, [
    "role",
    "uid",
    "gid",
    "root",
    "docker",
    "dockerSha256",
    "nonce",
    "platform",
    "image",
    "network",
    "seccompPath",
    "seccompSha256",
    "mounts",
    "workspace",
    "cwd",
    "deadlineMs",
    "supervisor",
  ]);
  supervisorIdentity(boundary);
  required(
    [
      boundary.root,
      boundary.workspace,
      boundary.cwd,
      boundary.seccompPath,
    ].every(
      path =>
        typeof path === "string" &&
        path.startsWith("/") &&
        !/[\n\0,:]/.test(path) &&
        !path.split("/").includes("..")
    ) &&
      (boundary.cwd === boundary.workspace ||
        boundary.cwd.startsWith(`${boundary.workspace}/`)),
    "invalid worker boundary path"
  );
  required(
    (boundary.role === "gate" || isInstallerRole(boundary.role)) &&
      [boundary.uid, boundary.gid].every(
        value => Number.isSafeInteger(value) && value > 0 && value <= 65_535
      ) &&
      (isInstallerRole(boundary.role) ||
        (boundary.uid === 2001 && boundary.gid === 2001)),
    "invalid worker role or identity"
  );
  required(
    typeof boundary.nonce === "string" &&
      /^[a-f0-9]{48}$/.test(boundary.nonce) &&
      /^sha256:[a-f0-9]{64}$/.test(boundary.image) &&
      ["linux/arm64", "linux/amd64"].includes(boundary.platform),
    "unqualified worker identity"
  );
  required(
    boundary.network === "none" ||
      boundary.network === `lisa-npm-${boundary.nonce}`,
    "foreign worker network"
  );
  invocationIdentity(invocation);
}

/** A native entrypoint remains literal bounded data, never a Docker option. */
function invocationIdentity(invocation) {
  required(
    typeof invocation.command === "string" &&
      /^\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(invocation.command) &&
      Array.isArray(invocation.args),
    "invalid real-tool entrypoint"
  );
  required(
    invocation.args.length <= 512 &&
      invocation.args.every(
        value =>
          typeof value === "string" &&
          !value.includes("\0") &&
          Buffer.byteLength(value) <= 65_536
      ) &&
      Buffer.byteLength(JSON.stringify(invocation.args)) <= 262_144,
    "invalid or unbounded real-tool argument"
  );
}

/** Fixed kernel options cannot be supplied by a candidate as flags. */
function createArguments(boundary) {
  return [
    "create",
    "--interactive",
    "--platform",
    boundary.platform,
    "--read-only",
    "--user",
    `${boundary.uid}:${boundary.gid}`,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--security-opt",
    `seccomp=${boundary.seccompPath}`,
    "--pids-limit",
    "512",
    "--memory",
    "4g",
    "--cpus",
    "4",
    "--ipc",
    "private",
    "--network",
    boundary.network,
    "--label",
    `dev.lisa.npm.owner=${boundary.nonce}`,
    "--workdir",
    boundary.cwd,
  ];
}

/** Installation owns exactly one dependency-only write mount. */
function sourceProjection(boundary, mount) {
  const source = mount.source;
  required(
    typeof source === "string" &&
      resolve(source) === source &&
      !/(?:^|\/)\.git(?:\/|$)|docker\.sock/.test(source),
    "worker source mount is Git, socket or aliased projection"
  );
  const projections = [
    boundary.workspace,
    `${boundary.root}/source`,
    `${dirname(boundary.root)}/source`,
    `${dirname(boundary.root)}/workspace`,
  ];
  const sourceInput =
    mount.readOnly &&
    mount.target === boundary.workspace &&
    projections.includes(source);
  const dependency =
    (source === `${boundary.root}/dependencies` &&
      mount.target === `${boundary.workspace}/node_modules`) ||
    (source === `${boundary.root}/ruby-dependencies` &&
      mount.target === `${boundary.workspace}/vendor/bundle`);
  required(
    sourceInput || dependency,
    "worker source mount exposes undeclared control or ancestor projection"
  );
  required(
    source !== "/" &&
      source !== boundary.root &&
      !boundary.root.startsWith(`${source}/`),
    "worker source mount exposes controller ancestor"
  );
}

/** Every namespace binds only its fixed source and separate dependency cohorts. */
function mountArguments(boundary, args) {
  required(
    Array.isArray(boundary.mounts) &&
      boundary.mounts.length > 0 &&
      boundary.mounts.length <= 8,
    "invalid worker mounts"
  );
  for (const mount of boundary.mounts) {
    keys(mount, ["source", "target", "readOnly"]);
    sourceProjection(boundary, mount);
    const dependencyWrite =
      (boundary.role === "install" &&
        mount.source === `${boundary.root}/dependencies` &&
        mount.target === `${boundary.workspace}/node_modules`) ||
      (boundary.role === "ruby-install" &&
        mount.source === `${boundary.root}/ruby-dependencies` &&
        mount.target === `${boundary.workspace}/vendor/bundle`);
    required(
      typeof mount.readOnly === "boolean" &&
        (mount.readOnly || dependencyWrite) &&
        [mount.source, mount.target].every(
          path =>
            typeof path === "string" &&
            path.startsWith("/") &&
            !/[\n\0,]/.test(path)
        ) &&
        !/docker\.sock|\/\.git(?:\/|$)/.test(mount.target) &&
        !mount.target.startsWith(boundary.root) &&
        mount.source !== boundary.root,
      "worker mount exposes writable/control authority"
    );
    args.push(
      "--mount",
      `type=bind,src=${mount.source},dst=${mount.target}${mount.readOnly ? ",readonly" : ""}`
    );
  }
}

/** Parent-qualified literal command data follows the fixed protected entrypoint. */
export function workerArguments(boundary, invocation, environment) {
  validateBoundary(boundary, invocation);
  const args = createArguments(boundary);
  mountArguments(boundary, args);
  for (const [path, policy] of Object.entries(workerScratch(boundary)))
    args.push("--tmpfs", `${path}:${policy}`);
  inspectedEnvironment(
    Object.entries(environment).map(([name, value]) => `${name}=${value}`)
  );
  if (isInstallerRole(boundary.role))
    required(
      !Object.keys(environment).some(name =>
        /^(?:GH_TOKEN|GITHUB_|DATABASE_)/.test(name)
      ),
      "installer contains provider or application credentials"
    );
  assertRubyEnvironment(environment, boundary);
  for (const [name, value] of Object.entries(environment))
    args.push("--env", `${name}=${value}`);
  return [
    ...args,
    "--entrypoint",
    boundary.supervisor.path,
    boundary.image,
    String(boundary.deadlineMs),
    "--",
    invocation.command,
    ...invocation.args,
  ];
}

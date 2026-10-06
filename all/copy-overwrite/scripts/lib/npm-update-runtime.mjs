// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Closed runtime identities make missing platform and process policy actionable refusals. @module npm-updater */
import { canonicalJson } from "../lisa-automation-provenance.mjs";
import { sha256 } from "./github-attestation-verifier.mjs";
import { required, keys } from "./npm-update-contract.mjs";
import { validateArchiveTransport } from "./npm-update-runtime-transport.mjs";

const HEX = /^[a-f0-9]{64}$/;
const TOOLS = [
  "node",
  "npm",
  "git",
  "shell",
  "bash",
  "bun",
  "gh",
  "gitleaks",
  "ruby",
  "bundle",
  "timeout",
  "supervisor",
];
const DENIED = new Set([
  "ptrace",
  "process_vm_readv",
  "process_vm_writev",
  "mount",
  "umount2",
  "pivot_root",
  "setns",
  "unshare",
  "bpf",
  "userfaultfd",
  "open_by_handle_at",
]);

/** A manifest's hash cannot make an allowing process-memory profile safe. */
function securityProfile(seccomp) {
  keys(seccomp, ["sha256", "profile"]);
  const profile = seccomp.profile;
  required(
    typeof seccomp.sha256 === "string" &&
      HEX.test(seccomp.sha256) &&
      sha256(`${canonicalJson(profile)}\n`) === seccomp.sha256,
    "runtime kernel policy bytes differ"
  );
  required(
    profile.defaultAction === "SCMP_ACT_ERRNO" &&
      Array.isArray(profile.syscalls) &&
      profile.syscalls.length > 0 &&
      profile.syscalls.length <= 512,
    "runtime kernel policy is not fail closed"
  );
  required(
    Object.keys(profile).every(name =>
      ["defaultAction", "defaultErrnoRet", "archMap", "syscalls"].includes(name)
    ) &&
      (profile.defaultErrnoRet === undefined || profile.defaultErrnoRet === 1),
    "runtime kernel policy contains foreign authority"
  );
  if (profile.archMap !== undefined) {
    required(
      Array.isArray(profile.archMap) && profile.archMap.length <= 16,
      "unbounded runtime architecture map"
    );
    for (const mapping of profile.archMap) {
      keys(mapping, ["architecture", "subArchitectures"]);
      required(
        typeof mapping.architecture === "string" &&
          /^SCMP_ARCH_[A-Z0-9_]+$/.test(mapping.architecture) &&
          (mapping.subArchitectures === null ||
            (Array.isArray(mapping.subArchitectures) &&
              mapping.subArchitectures.length <= 8 &&
              mapping.subArchitectures.every(
                value =>
                  typeof value === "string" &&
                  /^SCMP_ARCH_[A-Z0-9_]+$/.test(value)
              ))),
        "invalid runtime architecture map"
      );
    }
  }
  for (const rule of profile.syscalls) {
    syscallRule(rule);
    required(
      Array.isArray(rule.names) &&
        rule.names.length > 0 &&
        rule.names.length <= 512 &&
        rule.names.every(
          name => typeof name === "string" && /^[a-z0-9_]+$/.test(name)
        ),
      "invalid runtime syscall inventory"
    );
    required(
      ["SCMP_ACT_ALLOW", "SCMP_ACT_ERRNO"].includes(rule.action),
      "unsupported runtime syscall action"
    );
    required(
      rule.action !== "SCMP_ACT_ALLOW" ||
        rule.names.every(name => !DENIED.has(name)),
      "runtime permits process-memory or namespace authority"
    );
  }
}

/** Only reviewed argument/capability filters can constrain an allowed syscall. */
function syscallRule(rule) {
  required(
    rule &&
      typeof rule === "object" &&
      !Array.isArray(rule) &&
      Object.keys(rule).every(name =>
        [
          "names",
          "action",
          "args",
          "comment",
          "errnoRet",
          "includes",
          "excludes",
        ].includes(name)
      ),
    "foreign runtime syscall control"
  );
  required(
    rule.errnoRet === undefined ||
      (Number.isSafeInteger(rule.errnoRet) &&
        rule.errnoRet > 0 &&
        rule.errnoRet <= 4095),
    "invalid runtime syscall errno"
  );
  if (rule.args !== undefined) {
    required(
      Array.isArray(rule.args) && rule.args.length <= 6,
      "unbounded runtime syscall argument policy"
    );
    for (const argument of rule.args) {
      keys(argument, ["index", "op", "value"]);
      required(
        Number.isSafeInteger(argument.index) &&
          argument.index >= 0 &&
          argument.index <= 5 &&
          ["SCMP_CMP_EQ", "SCMP_CMP_NE", "SCMP_CMP_MASKED_EQ"].includes(
            argument.op
          ) &&
          Number.isSafeInteger(argument.value) &&
          argument.value >= 0,
        "invalid runtime syscall argument policy"
      );
    }
  }
  syscallFilters(rule);
}

/** Capability filters are closed independently of syscall argument predicates. */
function syscallFilters(rule) {
  for (const name of ["includes", "excludes"])
    if (rule[name] !== undefined) {
      const filter = rule[name];
      required(
        filter &&
          typeof filter === "object" &&
          !Array.isArray(filter) &&
          Object.keys(filter).every(key =>
            ["arches", "caps", "minKernel"].includes(key)
          ),
        "foreign runtime syscall filter"
      );
      for (const key of ["arches", "caps"])
        if (filter[key] !== undefined)
          required(
            Array.isArray(filter[key]) &&
              filter[key].length <= 64 &&
              filter[key].every(
                value => typeof value === "string" && /^\w+$/.test(value)
              ),
            "invalid runtime syscall filter"
          );
      required(
        filter.minKernel === undefined ||
          (typeof filter.minKernel === "string" &&
            /^\d+\.\d+(?:\.\d+)?$/.test(filter.minKernel)),
        "invalid runtime kernel bound"
      );
    }
}

/** Typed tool records describe required identities, not evidence that an image ran. */
export function toolIdentity(tools) {
  keys(tools, TOOLS);
  for (const name of TOOLS) {
    const tool = tools[name];
    keys(tool, ["path", "version", "sha256"]);
    required(
      typeof tool.path === "string" &&
        /^\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(tool.path) &&
        !tool.path.split("/").includes(".."),
      "invalid qualified tool path"
    );
    required(
      typeof tool.version === "string" &&
        tool.version.length > 0 &&
        tool.version.length <= 128 &&
        typeof tool.sha256 === "string" &&
        HEX.test(tool.sha256),
      "unqualified runtime tool identity"
    );
  }
  required(
    tools.node.version === "22.23.3" && tools.npm.version === "11.21.0",
    "unsupported runtime Node/npm identity"
  );
}

/** A fixed workload service grants no arbitrary Docker or production credential configuration. */
function serviceProfiles(services) {
  required(
    Array.isArray(services) && services.length <= 2,
    "runtime service inventory exceeds bound"
  );
  for (const service of services) {
    keys(service, ["profile", "platform", "image", "port"]);
    required(
      service.profile === "mysql" &&
        ["linux/arm64", "linux/amd64"].includes(service.platform) &&
        service.port === 3306 &&
        typeof service.image === "string" &&
        /^sha256:[a-f0-9]{64}$/.test(service.image),
      "unsupported or unqualified runtime service"
    );
  }
  required(
    new Set(services.map(service => service.platform)).size === services.length,
    "ambiguous runtime service identity"
  );
}

/** Closed immutable identities refuse a missing platform; native execution is never a fallback. */
export function validateRuntime(value, platform) {
  keys(value, [
    "version",
    "recipeSha256",
    "supervisorSha256",
    "platforms",
    "seccomp",
    "services",
  ]);
  required(
    value.version === 1 &&
      [value.recipeSha256, value.supervisorSha256].every(
        hash => typeof hash === "string" && HEX.test(hash)
      ),
    "unqualified runtime build recipe or supervisor"
  );
  securityProfile(value.seccomp);
  serviceProfiles(value.services);
  required(
    Array.isArray(value.platforms) &&
      value.platforms.length > 0 &&
      value.platforms.length <= 2,
    "runtime platform identity is unavailable"
  );
  for (const entry of value.platforms) {
    keys(entry, ["platform", "image", "tools", "archive"]);
    required(
      ["linux/arm64", "linux/amd64"].includes(entry.platform) &&
        typeof entry.image === "string" &&
        /^sha256:[a-f0-9]{64}$/.test(entry.image),
      "unqualified platform image"
    );
    toolIdentity(entry.tools);
    validateArchiveTransport(entry.archive, entry.platform);
  }
  const matching = value.platforms.filter(entry => entry.platform === platform);
  required(
    matching.length === 1 &&
      new Set(value.platforms.map(entry => entry.platform)).size ===
        value.platforms.length,
    "runtime platform is absent or ambiguous"
  );
  return matching[0];
}

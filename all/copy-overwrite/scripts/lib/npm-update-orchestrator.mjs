// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Original hooks own Git/control state; only qualified canonical interpreters stay in the controller. */
import {
  mkdirSync,
  writeFileSync,
  realpathSync,
  lstatSync,
  readdirSync,
  unlinkSync,
  openSync,
  closeSync,
  fsyncSync,
  constants,
  renameSync,
  existsSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { required, keys } from "./npm-update-contract.mjs";
import { readBytes, readJson, writeJson } from "./npm-update-process.mjs";
import { sha256 } from "./github-attestation-verifier.mjs";
// Preload dependencies must not execute the entry CLI before instrumentation.
import { canonicalJson } from "./automation-provenance-contract.mjs";
import { controllerGraph, configuredRoute } from "./npm-update-gate-hooks.mjs";
export { controllerGraph } from "./npm-update-gate-hooks.mjs";

const INTERPRETERS = new Set(["node", "shell", "bash"]);
const WRAPPERS = {
  node: "node",
  npm: "npm",
  bun: "bun",
  ruby: "ruby",
  bundle: "bundle",
  bash: "bash",
  sh: "shell",
  gh: "gh",
  gitleaks: "gitleaks",
};

/** Registration is private and flushed before any namespace is created or started. */
function flushRegistration(file) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function registryRoot(root) {
  const stat = lstatSync(root);
  required(
    stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      realpathSync(root) === root &&
      stat.uid === process.getuid() &&
      (stat.mode & 0o077) === 0,
    "namespace registry root is not private owned storage"
  );
}

/** Even an unstarted Docker object has an immutable owned name before creation. */
export function registerNamespace(boundary) {
  registryRoot(boundary.root);
  required(
    /^[a-f0-9]{48}$/.test(boundary.nonce) &&
      /^sha256:[a-f0-9]{64}$/.test(boundary.image) &&
      ["linux/arm64", "linux/amd64"].includes(boundary.platform) &&
      Number.isSafeInteger(boundary.deadlineMs) &&
      boundary.deadlineMs >= 1 &&
      boundary.deadlineMs <= 1_800_000,
    "invalid namespace registration identity/deadline"
  );
  const suffix = randomBytes(8).toString("hex");
  const record = {
    version: 1,
    name: `lisa-npm-${boundary.nonce}-${suffix}`,
    id: null,
    nonce: boundary.nonce,
    image: boundary.image,
    platform: boundary.platform,
    callerPid: process.pid,
    deadlineMs: boundary.deadlineMs,
    createdAt: Date.now(),
  };
  const file = writeJson(
    join(boundary.root, `namespace-${suffix}.json`),
    record
  );
  flushRegistration(file);
  flushRegistration(boundary.root);
  return { file, record };
}

function namespaceRecord(file) {
  const record = readJson(file, 16_384);
  keys(record, [
    "version",
    "name",
    "id",
    "nonce",
    "image",
    "platform",
    "callerPid",
    "deadlineMs",
    "createdAt",
  ]);
  required(
    record.version === 1 &&
      typeof record.nonce === "string" &&
      /^[a-f0-9]{48}$/.test(record.nonce) &&
      record.name ===
        `lisa-npm-${record.nonce}-${file.match(/namespace-([a-f0-9]{16})\.json$/)?.[1]}` &&
      /^sha256:[a-f0-9]{64}$/.test(record.image) &&
      ["linux/arm64", "linux/amd64"].includes(record.platform),
    "namespace registry identity differs"
  );
  required(
    record.id === null ||
      (typeof record.id === "string" && /^[a-f0-9]{64}$/.test(record.id)),
    "invalid registered namespace ID"
  );
  required(
    [record.callerPid, record.deadlineMs, record.createdAt].every(
      value => Number.isSafeInteger(value) && value > 0
    ) && record.deadlineMs <= 1_800_000,
    "invalid namespace registry process/deadline"
  );
  return record;
}

/** An actual daemon-returned ID is assigned once before start, never rebound on retry. */
export function assignNamespaceId(file, id) {
  const record = namespaceRecord(file);
  required(
    record.id === null && typeof id === "string" && /^[a-f0-9]{64}$/.test(id),
    "namespace identity is already assigned or invalid"
  );
  const temporary = writeJson(`${file}.id-${randomBytes(8).toString("hex")}`, {
    ...record,
    id,
  });
  try {
    flushRegistration(temporary);
    required(
      sha256(readBytes(file, 16_384)) === sha256(`${canonicalJson(record)}\n`),
      "namespace registration changed before ID assignment"
    );
    renameSync(temporary, file);
    flushRegistration(resolve(file, ".."));
    required(
      namespaceRecord(file).id === id,
      "namespace ID assignment readback differs"
    );
  } finally {
    if (existsSync(temporary)) {
      readBytes(temporary, 16_384);
      unlinkSync(temporary);
    }
  }
}

/** Only bounded canonical records inside this positively owned root are recovery input. */
export function namespaceRecords(root) {
  registryRoot(root);
  const names = readdirSync(root).filter(name =>
    /^namespace-[a-f0-9]{16}\.json$/.test(name)
  );
  required(names.length <= 512, "namespace registry inventory exceeds bound");
  return names.sort().map(name => {
    const file = join(root, name);
    return { file, record: namespaceRecord(file) };
  });
}

/** The parent removes its registration only after positive daemon namespace absence. */
export function completeNamespace(file, absent) {
  namespaceRecord(file);
  required(absent === true, "namespace completion requires positive absence");
  unlinkSync(file);
}

/** Every trusted import is rechecked before any controller interpreter is admitted. */
export function currentGraph(graph) {
  const result = {};
  for (const [path, hash] of Object.entries(graph)) {
    required(
      path.startsWith("/") &&
        typeof hash === "string" &&
        /^[a-f0-9]{64}$/.test(hash) &&
        realpathSync(path) === path,
      "trusted helper graph path is malformed or aliased"
    );
    result[path] = sha256(readBytes(path, 1_048_576, false));
  }
  return result;
}

/** A matching entry alone cannot bless a changed transitive import or a loader override. */
export function controllerRoute(
  tool,
  args,
  graph,
  observed,
  cwd,
  routes = [],
  environment = {}
) {
  if (!INTERPRETERS.has(tool)) return "worker";
  required(
    !args.some(arg =>
      /^(?:-r|--require|--import|--(?:experimental-)?loader)(?:=|$)/.test(arg)
    ),
    "unqualified controller loader route"
  );
  const entry =
    typeof args[0] === "string" && cwd && !args[0].startsWith("-")
      ? resolve(cwd, args[0])
      : args[0];
  const expected = controllerGraph(graph, routes);
  const configured = configuredRoute(tool, args, routes, cwd, environment);
  if (
    !configured &&
    (typeof entry !== "string" || !Object.hasOwn(graph, entry))
  )
    return "worker";
  required(
    Object.entries(expected).every(
      ([path, hash]) => /^[a-f0-9]{64}$/.test(hash) && observed[path] === hash
    ) && Object.keys(observed).length === Object.keys(expected).length,
    "trusted helper/configuration import graph changed"
  );
  return "controller";
}

/** Single quotes preserve fixed caller paths; candidate arguments enter only through literal "$@". */
function quote(value) {
  required(
    typeof value === "string" && !value.includes("\0") && !value.includes("\n"),
    "invalid launcher path"
  );
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** These executables dispatch real tools; no version, hook or verdict is synthesized. */
export function installLaunchers(
  root,
  context,
  interpreter = process.execPath
) {
  const stat = lstatSync(root);
  required(
    stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      stat.uid === process.getuid() &&
      (stat.mode & 0o077) === 0 &&
      context.root === root,
    "launcher root is not private controller storage"
  );
  const bin = join(root, "bin");
  mkdirSync(bin, { mode: 0o700 });
  const config = writeJson(join(root, "launcher.json"), context);
  const entry = fileURLToPath(
    new URL("./npm-update-tool-launcher.mjs", import.meta.url)
  );
  for (const [name, tool] of Object.entries(WRAPPERS)) {
    const script = `#!/bin/sh\nexec ${quote(resolve(interpreter))} ${quote(entry)} --context ${quote(config)} --tool ${quote(tool)} -- "$@"\n`;
    writeFileSync(join(bin, name), script, { mode: 0o700, flag: "wx" });
  }
  return bin;
}

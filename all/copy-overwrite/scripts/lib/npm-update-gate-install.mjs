// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Exact proposed installation is sealed only after its isolated namespace is absent. @module npm-updater */
import { required, keys } from "./npm-update-contract.mjs";
import {
  chmodSync,
  lstatSync,
  readdirSync,
  realpathSync,
  existsSync,
} from "node:fs";
import { join, sep } from "node:path";
import { executeWorker } from "./npm-update-isolation.mjs";
import { namespaceRecords } from "./npm-update-orchestrator.mjs";
import { toolIdentity, validateRuntime } from "./npm-update-runtime.mjs";
import { sha256 } from "./github-attestation-verifier.mjs";
import { readBytes } from "./npm-update-process.mjs";
import { fileURLToPath } from "node:url";
const HEX = /^[a-f0-9]{64}$/;
export { validateRuntime } from "./npm-update-runtime.mjs";

/** Ordinary npm installs the exact proposal with no lifecycle code or deployment authority. */
export async function installDependencies(boundary, tools, engineStrict) {
  required(
    boundary.role === "install" && typeof engineStrict === "boolean",
    "installation requires its isolated role and resolved engine policy"
  );
  toolIdentity(tools);
  required(
    namespaceRecords(boundary.root).length === 0,
    "installation requires completed owned namespace recovery"
  );
  const args = [
    tools.npm.path,
    "ci",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ];
  if (engineStrict) args.push("--engine-strict");
  const result = await executeWorker(boundary, {
    command: tools.node.path,
    args,
  });
  required(result.code === 0, "actual proposed npm installation failed");
  required(
    namespaceRecords(boundary.root).length === 0,
    "installer namespace cleanup remains outstanding"
  );
  const sealed = sealDependencies(join(boundary.root, "dependencies"), true);
  return { code: result.code, files: sealed.files, bytes: sealed.bytes };
}

/** Frozen Bundler supports only the committed public-source and exact runtime contract. */
export function rubyInstallationInputs(inputs, tools) {
  keys(inputs, ["lock", "rubyVersion", "configurationPresent"]);
  required(
    typeof inputs.lock === "string" &&
      Buffer.byteLength(inputs.lock) <= 3_145_728 &&
      !inputs.lock.includes("\0") &&
      typeof inputs.rubyVersion === "string" &&
      inputs.rubyVersion.trim() === "3.4.11",
    "unsupported Ruby installation inputs"
  );
  required(
    inputs.configurationPresent === false,
    "configured alternate Bundler policy is unsupported"
  );
  required(
    tools.ruby?.path === "/usr/local/bin/ruby" &&
      /^ruby 3\.4\.11(?:p\d+)?\s/.test(tools.ruby.version) &&
      tools.bundle?.path === "/usr/local/bin/bundle" &&
      tools.bundle.version === "Bundler version 2.4.10",
    "unsupported genuine Ruby/Bundler identity"
  );
  const lock = inputs.lock.replaceAll("\r\n", "\n");
  const headers = [...lock.matchAll(/^([A-Z][A-Z ]+)$/gm)].map(
    match => match[1]
  );
  required(
    lock.startsWith("GEM\n") &&
      headers.every(header =>
        [
          "GEM",
          "PLATFORMS",
          "DEPENDENCIES",
          "RUBY VERSION",
          "BUNDLED WITH",
          "CHECKSUMS",
        ].includes(header)
      ),
    "private/git/path Ruby sources are unsupported"
  );
  const remotes = [...lock.matchAll(/^ {2}remote: (.+)$/gm)].map(
    match => match[1]
  );
  required(
    remotes.length === 1 && /^https:\/\/rubygems\.org\/?$/.test(remotes[0]),
    "private or alternate Ruby source is unsupported"
  );
  required(
    /\nRUBY VERSION\n {3}ruby 3\.4\.11p\d*(?:\n|$)/.test(lock) &&
      /\nBUNDLED WITH\n {3}2\.4\.10(?:\n|$)/.test(lock),
    "frozen Ruby/Bundler lock identity differs"
  );
}

/** Read-only source bytes are checked before and after the entire isolated installer. */
function rubySource(boundary, tools) {
  const mount = boundary.mounts.find(
    value => value.target === boundary.workspace && value.readOnly === true
  );
  required(
    mount && realpathSync(mount.source) === mount.source,
    "Ruby installer source projection is missing or aliased"
  );
  const source = mount.source;
  const lock = readBytes(join(source, "Gemfile.lock"), 3_145_728, false);
  const manifest = readBytes(join(source, "Gemfile"), 1_048_576, false);
  const decoder = new TextDecoder("utf8", { fatal: true });
  rubyInstallationInputs(
    {
      lock: decoder.decode(lock),
      rubyVersion: decoder.decode(
        readBytes(join(source, ".ruby-version"), 128, false)
      ),
      configurationPresent: existsSync(join(source, ".bundle")),
    },
    tools
  );
  return { source, lock, manifest };
}

/** Native extensions load only in the separate dependency-only installer namespace. */
export async function installRubyDependencies(boundary, tools) {
  required(
    boundary.role === "ruby-install",
    "Ruby installation requires its separate isolated role"
  );
  toolIdentity(tools);
  required(
    namespaceRecords(boundary.root).length === 0,
    "Ruby installation requires completed namespace recovery"
  );
  const input = rubySource(boundary, tools);
  const result = await executeWorker(boundary, {
    command: tools.bundle.path,
    args: ["_2.4.10_", "install", "--jobs", "2", "--retry", "0"],
  });
  required(result.code === 0, "actual frozen Ruby installation failed");
  required(
    namespaceRecords(boundary.root).length === 0,
    "Ruby installer namespace cleanup remains outstanding"
  );
  required(
    readBytes(join(input.source, "Gemfile"), 1_048_576, false).equals(
      input.manifest
    ) &&
      readBytes(join(input.source, "Gemfile.lock"), 3_145_728, false).equals(
        input.lock
      ),
    "Ruby installer changed committed baseline bytes"
  );
  const sealed = sealDependencies(
    join(boundary.root, "ruby-dependencies"),
    true
  );
  return { code: result.code, files: sealed.files, bytes: sealed.bytes };
}

/** Only installer-owned dependency files may be sealed after its entire namespace is absent. */
export function sealDependencies(directory, installerAbsent) {
  required(
    installerAbsent === true && realpathSync(directory) === directory,
    "dependency sealing requires reaped installer and unaliased root"
  );
  const root = lstatSync(directory);
  required(
    root.isDirectory() &&
      !root.isSymbolicLink() &&
      root.uid === process.getuid(),
    "installed dependency root is not controller owned"
  );
  const pending = [directory];
  let count = 0;
  let bytes = 0;
  const files = [];
  while (pending.length) {
    const parent = pending.pop();
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      const path = join(parent, entry.name);
      const stat = lstatSync(path);
      required(
        ++count <= 300_000 && stat.uid === process.getuid(),
        "installed dependency ownership/inventory differs"
      );
      if (stat.isSymbolicLink()) {
        required(
          realpathSync(path).startsWith(`${directory}${sep}`),
          "installed dependency alias escapes its sealed tree"
        );
        continue;
      }
      required(
        stat.isFile() || stat.isDirectory(),
        "installed dependency contains a special file"
      );
      if (stat.isDirectory()) pending.push(path);
      else {
        bytes += stat.size;
        required(
          bytes <= 10_737_418_240 && stat.nlink === 1,
          "installed dependency size or link ownership differs"
        );
      }
      files.push({
        path,
        mode: stat.isDirectory() || stat.mode & 0o111 ? 0o555 : 0o444,
      });
    }
  }
  for (const file of files) chmodSync(file.path, file.mode);
  chmodSync(directory, 0o555);
  required(
    files.every(file => (lstatSync(file.path).mode & 0o222) === 0) &&
      (lstatSync(directory).mode & 0o222) === 0,
    "installed dependency sealing readback differs"
  );
  return { files: count, bytes };
}

/** The committed caller pins the actual managed catalog bytes independently of the parsed policy. */
export function loadRuntime(config, platform) {
  const file = fileURLToPath(
    new URL("../npm-updater-gate-runtime.json", import.meta.url)
  );
  const digest = config.automationProvenance?.gateRuntimeSha256;
  required(
    typeof digest === "string" && HEX.test(digest),
    "committed qualified gate runtime digest is missing"
  );
  const bytes = readBytes(file, 1_048_576, false);
  required(
    sha256(bytes) === digest,
    "qualified gate runtime catalog bytes differ"
  );
  const value = JSON.parse(
    new TextDecoder("utf8", { fatal: true }).decode(bytes)
  );
  const selected = validateRuntime(value, platform);
  const recipe = fileURLToPath(
    new URL("../npm-updater-gate.Dockerfile", import.meta.url)
  );
  required(
    sha256(readBytes(recipe, 65_536, false)) === value.recipeSha256,
    "qualified runtime recipe bytes differ"
  );
  const supervisor = fileURLToPath(
    new URL("../npm-updater-gate-supervisor.c", import.meta.url)
  );
  required(
    sha256(readBytes(supervisor, 65_536, false)) === value.supervisorSha256,
    "qualified supervisor source bytes differ"
  );
  return { value, selected };
}

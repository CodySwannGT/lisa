// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Genuine immutable npm and released helper identity preserve native engine policy. */
import {
  lstatSync,
  existsSync,
  constants,
  openSync,
  closeSync,
  fstatSync,
  readSync,
  realpathSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, isAbsolute, parse } from "node:path";
import { required } from "./npm-update-contract.mjs";
import { readBytes, runProcess } from "./npm-update-process-core.mjs";
import { sha256 } from "./github-attestation-verifier.mjs";

/** Ascend from the actual entry; a host manifest never becomes the Lisa package owner. */
export function findLisaPackageOwner(entry) {
  let directory = dirname(realpathSync(entry));
  const root = parse(directory).root;
  while (directory !== root) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest)) {
      const metadata = JSON.parse(readBytes(manifest, 1_048_576, false));
      if (metadata.name === "@codyswann/lisa")
        return { root: directory, metadata };
    }
    directory = dirname(directory);
  }
  return undefined;
}

/** Stream a bounded regular archive so its actual bytes, not metadata, prove registry integrity. */
export function archiveIntegrity(file) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    required(
      lstatSync(file).isFile() &&
        !lstatSync(file).isSymbolicLink() &&
        stat.isFile() &&
        stat.nlink === 1 &&
        stat.uid === process.getuid() &&
        stat.size > 0 &&
        stat.size <= 150_000_000,
      "invalid bounded owned helper archive"
    );
    const hash = createHash("sha512");
    const buffer = Buffer.alloc(65_536);
    let total = 0;
    let count;
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      total += count;
      required(total <= 150_000_000, "helper archive grew beyond bound");
      hash.update(buffer.subarray(0, count));
    }
    return `sha512-${hash.digest("base64")}`;
  } finally {
    closeSync(fd);
  }
}

/** Public metadata is bounded during consumption and must match the prepared lock. */
export async function registryVersion(update, proposal) {
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(update.name)}/${update.to}`,
    { signal: AbortSignal.timeout(30_000), redirect: "error" }
  );
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    required(false, "selected registry version is unavailable");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      required(length <= 1_048_576, "registry response exceeds bound");
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const text = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(Buffer.concat(chunks));
  const value = JSON.parse(text);
  const lock = JSON.parse(proposal.files["package-lock.json"]);
  const item = lock.packages?.[`node_modules/${update.name}`];
  required(
    value.name === update.name &&
      value.version === update.to &&
      item?.version === update.to &&
      value.dist?.integrity === item.integrity &&
      typeof item.integrity === "string" &&
      value.dist.tarball === item.resolved &&
      typeof item.resolved === "string",
    "registry selected version, archive or integrity differs"
  );
  return { name: value.name, version: value.version };
}

/** Run genuine immutable npm11 with the actual required Node interpreter. */
export async function runNpm(args, options) {
  const cli = process.env.LISA_NPM_CLI;
  if (!cli) return runProcess("npm", args, options);
  required(
    process.versions.node === "22.23.3" &&
      isAbsolute(cli) &&
      !lstatSync(cli).isSymbolicLink(),
    "qualified Node/npm CLI required"
  );
  const metadata = JSON.parse(
    readBytes(join(dirname(cli), "../package.json"), 1_048_576, false)
  );
  required(
    metadata.name === "npm" &&
      metadata.version === "11.21.0" &&
      metadata.engines?.node === "^20.17.0 || >=22.9.0" &&
      sha256(readBytes(cli, 1_048_576, false)) ===
        "8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7",
    "immutable supported npm identity differs"
  );
  return runProcess(process.execPath, [cli, ...args], options);
}

/** Resolve only the effective boolean with native precedence, before isolating HOME. */
export async function effectiveEngineStrict(cwd, source = process.env) {
  const env = {
    PATH: source.PATH,
    HOME: source.HOME,
    LANG: "C.UTF-8",
    GIT_TERMINAL_PROMPT: "0",
  };
  required(typeof env.HOME === "string", "engine policy HOME is unavailable");
  const allowed = new Set([
    "engine_strict",
    "engine-strict",
    "userconfig",
    "globalconfig",
    "prefix",
  ]);
  for (const [name, value] of Object.entries(source))
    if (
      allowed.has(name.toLowerCase().replace(/^npm_config_/, "")) &&
      /^npm_config_/i.test(name)
    )
      env[name] = value;
  const git = args => runProcess("git", args, { cwd, env, maximum: 1_048_576 });
  const project = join(cwd, ".npmrc");
  if (existsSync(project)) {
    required(
      lstatSync(project).isFile() && !lstatSync(project).isSymbolicLink(),
      "engine policy project config is aliased"
    );
    const entry = (
      await git(["ls-tree", "HEAD", "--", ".npmrc"])
    ).stdout.toString();
    required(
      entry.startsWith("100644 blob ") && entry.trim().split("\n").length === 1,
      "engine policy project config is not committed"
    );
    const changed = await git(["diff", "--name-only", "HEAD", "--", ".npmrc"]);
    required(
      !changed.stdout.length,
      "engine policy project config differs from HEAD"
    );
  }
  const result = await runNpm(["config", "get", "engine-strict", "--json"], {
    cwd,
    env,
    maximum: 65_536,
  });
  required(!result.stderr.length, "engine policy config warning is ambiguous");
  const text = result.stdout.toString().trim();
  required(
    ["true", "false"].includes(text),
    "engine policy is unresolved or nonboolean"
  );
  return text === "true";
}

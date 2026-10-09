// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Optional Bun coherence uses a pinned native tool and the original committed lock. */
import { existsSync, lstatSync, realpathSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { required } from "./npm-update-invariants.mjs";
import { sha256 } from "./github-attestation-verifier.mjs";
import { runProcess, readBytes } from "./npm-update-process-core.mjs";
import { binaryDigest } from "./npm-update-worker-lifecycle.mjs";
import { canonicalJson } from "./automation-provenance-contract.mjs";

/** An untracked, removed, aliased or changed original lock never becomes authority. */
export async function committedBun(cwd, command, proposal) {
  const entry = (
    await command(["ls-tree", "HEAD", "--", "bun.lock"])
  ).stdout.toString();
  const path = join(cwd, "bun.lock");
  if (!entry) {
    required(!existsSync(path), "unexpected Bun lock path");
    try {
      lstatSync(path);
      required(false, "unexpected Bun lock alias");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    required(
      !proposal || !Object.hasOwn(proposal, "bunLockSha256"),
      "original Bun lock was removed"
    );
    return undefined;
  }
  required(
    /^100644 blob [a-f0-9]{40}\tbun\.lock\n$/.test(entry),
    "regular committed Bun lock required"
  );
  const stat = lstatSync(path);
  required(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.nlink === 1 &&
      realpathSync(path) === path,
    "Bun lock path is aliased"
  );
  const bytes = (await command(["show", "HEAD:bun.lock"])).stdout;
  const digest = sha256(bytes);
  required(
    proposal
      ? proposal.bunLockSha256 === digest
      : readBytes(path, 1_048_576, false).equals(bytes),
    "original Bun lock bytes differ"
  );
  return bytes.toString("utf8");
}

/** Recheck the same regular executable identity and bytes around every native call. */
function toolIdentity(path) {
  const stat = lstatSync(path);
  required(
    isAbsolute(path) &&
      stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.nlink === 1 &&
      realpathSync(path) === path,
    "Bun executable is aliased"
  );
  return `${stat.dev}:${stat.ino}:${stat.uid}:${stat.mode}:${binaryDigest(path)}`;
}

/** Only the original trusted PATH may select a supported native Bun installation. */
export async function qualifiedBun(env, { executable, deadline } = {}) {
  const path =
    executable ??
    (env.PATH ?? "")
      .split(":")
      .filter(isAbsolute)
      .map(directory => join(directory, "bun"))
      .find(existsSync);
  required(typeof path === "string", "native Bun is unavailable");
  const absolute = resolve(path);
  const identity = toolIdentity(absolute);
  const invoke = async (args, options = {}) => {
    required(
      toolIdentity(absolute) === identity,
      "Bun executable identity changed"
    );
    const timeout = Math.min(
      options.timeout ?? 120_000,
      120_000,
      deadline === undefined ? 120_000 : deadline - Date.now()
    );
    required(
      Number.isSafeInteger(timeout) && timeout > 0,
      "original Bun operation deadline expired"
    );
    const result = await runProcess(absolute, args, {
      ...options,
      env: { ...env, BUN_FEATURE_FLAG_DISABLE_NATIVE_DEPENDENCY_LINKER: "1" },
      timeout,
    });
    required(
      toolIdentity(absolute) === identity,
      "Bun executable changed during execution"
    );
    return result;
  };
  const version = await invoke(["--version"]);
  required(
    version.stdout.toString() === "1.3.8\n" && !version.stderr.length,
    "Bun1.3.8 is required"
  );
  return invoke;
}

/**
 * Native JSONC parsing is data-only; every Bun package must match a public npm lock identity.
 * npm aliases record their real registry name separately from the installation path.
 */
export async function verifyBunLock(bun, app, options = {}) {
  const text = readBytes(join(app, "bun.lock"), 1_048_576, false);
  const parsed = await bun(
    [
      "--eval",
      "process.stdout.write(JSON.stringify(Bun.JSONC.parse(await Bun.stdin.text())))",
    ],
    { ...options, cwd: app, input: text, maximum: 1_048_576 }
  );
  const value = JSON.parse(parsed.stdout.toString());
  const manifest = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
  const npm = JSON.parse(readFileSync(join(app, "package-lock.json"), "utf8"));
  required(
    value.lockfileVersion === 1 &&
      Object.keys(value.workspaces ?? {}).join() === "" &&
      value.workspaces?.[""]?.name === manifest.name,
    "unsupported Bun root lock"
  );
  for (const section of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ])
    required(
      canonicalJson(value.workspaces[""][section] ?? {}) ===
        canonicalJson(manifest[section] ?? {}),
      "Bun root selections differ"
    );
  required(
    value.packages &&
      typeof value.packages === "object" &&
      !Array.isArray(value.packages),
    "Bun packages are absent"
  );
  const nodes = Object.entries(npm.packages).filter(([name]) => name !== "");
  for (const row of Object.values(value.packages)) {
    required(
      Array.isArray(row) && row.length === 4 && typeof row[0] === "string",
      "unsupported Bun package record"
    );
    const matching = nodes.some(
      ([path, node]) =>
        row[0] ===
          `${node.name ?? path.split("node_modules/").at(-1)}@${node.version}` &&
        row[3] === node.integrity &&
        (row[1] === "" || row[1] === node.resolved)
    );
    required(matching, "Bun package identity differs from public npm lock");
  }
}

/** Frozen native installation must preserve every prepared manifest and lock byte. */
export async function frozenBun(bun, app, files, options = {}) {
  await verifyBunLock(bun, app, options);
  const before = files.map(file =>
    readBytes(join(app, file), 1_048_576, false)
  );
  await bun(
    [
      "install",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--registry",
      "https://registry.npmjs.org/",
    ],
    { ...options, cwd: app }
  );
  required(
    files.every((file, index) =>
      readBytes(join(app, file), 1_048_576, false).equals(before[index])
    ),
    "frozen Bun rewrote manifest or lock"
  );
}

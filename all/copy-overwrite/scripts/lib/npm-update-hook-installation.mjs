// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Original manager readback preserves installed bytes; dispatch qualification is a separate obligation. */
import { existsSync, lstatSync, realpathSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { keys, required } from "./npm-update-contract.mjs";
import { readBytes } from "./npm-update-process.mjs";
import { sha256 } from "./github-attestation-verifier.mjs";

const HOOKS = ["pre-commit", "prepare-commit-msg", "commit-msg", "pre-push"];
const HEX = /^[a-f0-9]{64}$/;

/** Native Git resolves the real installation, including its configured path, without a configuration override. */
async function installedDirectory(cwd, command) {
  const result = await command(["rev-parse", "--git-path", "hooks"]);
  required(
    Buffer.isBuffer(result.stdout) && result.stdout.length <= 4096,
    "installed hook path readback is unbounded"
  );
  const text = new TextDecoder("utf8", { fatal: true }).decode(result.stdout);
  required(
    text.endsWith("\n") && !/[\n\r\0]/.test(text.slice(0, -1)),
    "installed hook path is unsupported"
  );
  const directory = resolve(cwd, text.slice(0, -1));
  required(
    directory.startsWith(`${cwd}/`) &&
      realpathSync(directory) === directory &&
      lstatSync(directory).isDirectory() &&
      !lstatSync(directory).isSymbolicLink(),
    "installed hook directory escapes its checkout or is aliased"
  );
  return directory;
}

/** A separately observed manager installation binds all hooks that an ordinary commit/push can execute. */
function checkedWrappers(directory, authority) {
  keys(authority, ["manager", "wrappers"]);
  required(
    ["husky", "lefthook"].includes(authority.manager),
    "unsupported original hook manager"
  );
  keys(authority.wrappers, HOOKS);
  for (const name of HOOKS) {
    const file = join(directory, name);
    const stat = lstatSync(file);
    required(
      stat.isFile() &&
        !stat.isSymbolicLink() &&
        realpathSync(file) === file &&
        (stat.mode & 0o111) !== 0,
      "original installed wrapper is missing, nonexecutable or aliased"
    );
    required(
      HEX.test(authority.wrappers[name]) &&
        sha256(readBytes(file, 65_536, false)) === authority.wrappers[name],
      "original installed wrapper differs from qualified installation"
    );
  }
}

/** Committed manager configuration is unchanged; this hash does not bless application commands. */
async function sourceReadback(cwd, command, source) {
  const bytes = readBytes(join(cwd, source), 1_048_576, false);
  const committed = await command(["show", `HEAD:${source}`]);
  required(
    Buffer.isBuffer(committed.stdout) && bytes.equals(committed.stdout),
    "original hook source differs from committed source"
  );
  return sha256(bytes);
}

/** Lefthook requires actual installation receipts; legacy Husky source readback retains its original contract. */
export async function originalHookInstallation(cwd, command, authority) {
  required(realpathSync(cwd) === cwd, "original hook checkout is aliased");
  const directory = await installedDirectory(cwd, command);
  const husky = [join(cwd, ".husky"), join(cwd, ".husky/_")].includes(
    directory
  );
  if (authority !== undefined) {
    required(
      authority.manager === (husky ? "husky" : "lefthook"),
      "original hook manager differs"
    );
    checkedWrappers(directory, authority);
  }
  if (!husky) {
    required(
      authority !== undefined,
      "original Lefthook installation qualification is absent"
    );
  }
  const source = husky ? ".husky/pre-push" : "lefthook.yml";
  const path = join(directory, "pre-push");
  const stat = lstatSync(path);
  required(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      realpathSync(path) === path &&
      (stat.mode & 0o111) !== 0,
    "original pre-push installation is missing or aliased"
  );
  return {
    manager: husky ? "husky" : "lefthook",
    path,
    source,
    sourceSha256: await sourceReadback(cwd, command, source),
    wrapperSha256: sha256(readBytes(path, 65_536, false)),
  };
}

/** Compatibility export returns the same original executable path; no replacement gate is constructed. */
export async function originalPrePush(cwd, command, authority) {
  return (await originalHookInstallation(cwd, command, authority)).path;
}

/** Husky 8 declares its real installer in package metadata; dependency install remains script-disabled. */
function huskyInstaller(cwd) {
  const root = join(cwd, "node_modules/husky");
  const metadata = JSON.parse(
    readBytes(join(root, "package.json"), 65_536, false)
  );
  const bin =
    typeof metadata.bin === "string" ? metadata.bin : metadata.bin?.husky;
  required(
    metadata.name === "husky" &&
      /^8\.\d+\.\d+$/.test(metadata.version) &&
      typeof bin === "string" &&
      /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.js$/.test(bin),
    "original Husky 8 installer declaration is unsupported"
  );
  const path = join(root, bin);
  required(
    realpathSync(root) === root &&
      realpathSync(path) === path &&
      lstatSync(path).isFile(),
    "original Husky installer is unavailable or aliased"
  );
  return path;
}

/** The original supported manager installs its own wrappers; no synthetic replacement hook is written. */
export async function installOriginalManager(context, env, nativeStep) {
  const lefthook = existsSync(join(context.cwd, "lefthook.yml"));
  if (lefthook)
    await nativeStep(context, env, "bundle", ["exec", "lefthook", "install"]);
  else {
    required(
      existsSync(join(context.cwd, ".husky/pre-push")),
      "original hook manager installation is unavailable"
    );
    await nativeStep(context, env, process.execPath, [
      huskyInstaller(context.cwd),
      "install",
    ]);
  }
  const git = args => nativeStep(context, env, "/usr/bin/git", args);
  const result = await git(["rev-parse", "--git-path", "hooks"]);
  const text = result.stdout.toString();
  required(
    text.endsWith("\n") && !/[\n\r\0]/.test(text.slice(0, -1)),
    "original hook path is unsupported"
  );
  const directory = resolve(context.cwd, text.slice(0, -1));
  const wrappers = {};
  for (const name of [
    "pre-commit",
    "prepare-commit-msg",
    "commit-msg",
    "pre-push",
  ]) {
    const path = join(directory, name);
    required(
      lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(),
      "original hook wrapper is missing or aliased"
    );
    wrappers[name] = sha256(readFileSync(path));
  }
  const installation = { manager: lefthook ? "lefthook" : "husky", wrappers };
  await originalHookInstallation(context.cwd, git, installation);
  return installation;
}

// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Original manager readback preserves installed bytes; dispatch qualification is a separate obligation. */
import { lstatSync, realpathSync } from "node:fs";
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

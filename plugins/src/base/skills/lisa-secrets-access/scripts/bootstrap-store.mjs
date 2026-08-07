/**
 * Store the one credential that unlocks the provider, on the machine that needs
 * it.
 *
 * Reading it already existed; writing it did not, so every operator ran a
 * platform-specific `security add-generic-password` copied from documentation.
 * That is a command with a credential in it, typed by hand, on the one value
 * whose compromise costs every other secret.
 *
 * **Two stores, because there is no third option.** macOS has a keychain that
 * is encrypted at rest and unlocked with the login session. Linux has no
 * equivalent that can be assumed present — libsecret needs a running daemon and
 * a desktop session, which a server or a container does not have. So the
 * fallback is a `0600` file under `$XDG_CONFIG_HOME`, which is the same
 * protection the materialized secrets file already relies on. It is weaker than
 * a keychain and it is stated as such, rather than pretending the two are equal.
 * @module bootstrap-store
 */

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Where a file-backed bootstrap lives, for platforms with no keychain.
 * @param {string} key Bootstrap variable name.
 * @param {Record<string, string|undefined>} [env] Environment to read.
 * @returns {string} Absolute path.
 */
export function bootstrapFile(key, env = process.env) {
  const root = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config");
  return join(root, "lisa", "bootstrap", key);
}

/**
 * Which store this platform uses.
 * @param {string} [platform] Platform name, injectable for tests.
 * @returns {"keychain"|"file"} The store.
 */
export function storeKind(platform = process.platform) {
  return platform === "darwin" ? "keychain" : "file";
}

/**
 * Write the bootstrap where this machine's sessions will look for it.
 *
 * The value never reaches a command line on either path. `security` is handed
 * it on **stdin** via `-w` with no argument, because an argument is visible in
 * `ps` to every process on the machine for as long as the call runs — and a
 * shell would also record it in history. The file path writes and chmods a
 * temporary before renaming, so the credential is never briefly world-readable
 * on a filesystem where the default umask would have made it so.
 * @param {string} key Bootstrap variable name.
 * @param {string} value The token.
 * @param {object} [deps] Injected seams, for tests.
 * @returns {{kind: string, where: string}} Where it went.
 */
export function storeBootstrap(key, value, deps = {}) {
  const kind = deps.kind ?? storeKind();
  const env = deps.env ?? process.env;

  if (kind === "keychain") {
    const run = deps.run ?? execFileSync;
    // `-U` updates in place. Without it a second run fails with "already
    // exists", which would make rotation — the common case — the broken one.
    run(
      "security",
      ["add-generic-password", "-U", "-s", key, "-a", env.USER ?? "", "-w"],
      { input: value, stdio: ["pipe", "ignore", "ignore"] }
    );
    return { kind, where: `keychain (service ${key})` };
  }

  const path = deps.path ?? bootstrapFile(key, env);
  const write = deps.write ?? writeFileSync;
  const chmod = deps.chmod ?? chmodSync;
  const rename = deps.rename ?? renameSync;
  const makeDir = deps.mkdir ?? mkdirSync;

  makeDir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  // mode on write applies only when the file is CREATED, so an existing
  // temporary from a crashed run would keep its old permissions. chmod after
  // writing is what makes 0600 true rather than usually true.
  write(temporary, `${value}\n`, { mode: 0o600 });
  chmod(temporary, 0o600);
  rename(temporary, path);
  return { kind, where: path };
}

/**
 * Remove a stored bootstrap, so a rotation can be proven rather than assumed.
 * @param {string} key Bootstrap variable name.
 * @param {object} [deps] Injected seams, for tests.
 */
export function clearBootstrap(key, deps = {}) {
  const kind = deps.kind ?? storeKind();
  const env = deps.env ?? process.env;

  if (kind === "keychain") {
    const run = deps.run ?? execFileSync;
    try {
      run(
        "security",
        ["delete-generic-password", "-s", key, "-a", env.USER ?? ""],
        {
          stdio: "ignore",
        }
      );
    } catch {
      // Absent is the desired state, and `security` exits non-zero for it.
    }
    return;
  }
  const remove = deps.remove ?? rmSync;
  remove(deps.path ?? bootstrapFile(key, env), { force: true });
}

/**
 * Read a file-backed bootstrap, treating absence as empty.
 *
 * The keychain reader lives beside the other provider concerns in
 * `providers.mjs`; this is its counterpart for platforms without one.
 * @param {string} key Bootstrap variable name.
 * @param {Record<string, string|undefined>} [env] Environment to read.
 * @returns {string} The value, or an empty string.
 */
export function readBootstrapFile(key, env = process.env) {
  const path = bootstrapFile(key, env);
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8").trim();
}

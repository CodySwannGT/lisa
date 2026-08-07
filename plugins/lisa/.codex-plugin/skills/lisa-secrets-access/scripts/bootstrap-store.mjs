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
  return join(root, "lisa", "bootstrap", assertKey(key));
}

/**
 * Reject a key that is not exactly one safe path segment.
 *
 * The key is joined onto a directory, and every entry point — store, clear and
 * read — routes through that join. A `/` or a `..` in it escapes the bootstrap
 * directory, so an unvalidated key can write, delete, or read an arbitrary file
 * as the operator. Validating in `bootstrapFile` covers all three at once
 * rather than trusting each caller to remember.
 *
 * Same guard `assertNamespace` applies to the namespace, and for the same
 * reason. The character set is what a variable name can hold anyway, so nothing
 * legitimate is refused.
 * @param {string} key Candidate bootstrap variable name.
 * @returns {string} The key, unchanged, when valid.
 */
export function assertKey(key) {
  if (
    typeof key !== "string" ||
    !/^[A-Za-z0-9._-]+$/.test(key) ||
    key === ".."
  ) {
    throw new Error(
      `bootstrap key must be one safe path segment, got ${JSON.stringify(key)}`
    );
  }
  return key;
}

/**
 * Quote a word for `security -i`, which tokenizes its stdin like a shell.
 *
 * A token is usually base64-ish and needs no quoting, but "usually" is not a
 * property to rely on for a credential: an unquoted value containing a space
 * would be parsed as two arguments and silently store only the first part.
 * A newline is refused outright rather than escaped, because it terminates the
 * command line and there is no quoting that survives it.
 * @param {string} word Value to quote.
 * @returns {string} A single quoted token.
 */
function quote(word) {
  if (/[\n\r]/.test(word)) {
    throw new Error("bootstrap value must not contain a newline");
  }
  return `"${String(word).replace(/(["\\])/g, "\\$1")}"`;
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
    assertKey(key);
    // `security -i` reads a COMMAND STREAM on stdin, which is what keeps the
    // value out of `argv` — where `ps` would show it to every process running
    // as this user for as long as the call lasts.
    //
    // The obvious `-w` with no argument does NOT read the password from stdin.
    // It opens an interactive prompt on the terminal, and with stdin piped it
    // stores an EMPTY value and exits 0 — verified against the real binary,
    // which is how this shipped broken the first time: unit tests injected the
    // runner and never executed it.
    //
    // `-U` updates in place; without it a second run fails with "already
    // exists", making rotation — the common case — the broken one.
    run("security", ["-i"], {
      input: `add-generic-password -U -s ${quote(key)} -a ${quote(
        env.USER ?? ""
      )} -w ${quote(value)}\n`,
      stdio: ["pipe", "ignore", "ignore"],
    });
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

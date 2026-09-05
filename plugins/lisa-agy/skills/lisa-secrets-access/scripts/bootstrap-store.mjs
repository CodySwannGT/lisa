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
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * The one grammar a bootstrap key may take: a single safe path segment.
 *
 * Named once and shared by the guard that enforces it on the way in
 * ({@link assertKey}) and the filter that applies it on the way out
 * ({@link listBootstrapFiles}). Two copies of this expression would eventually
 * disagree, and the direction that matters is the lax one: a name accepted by
 * the reader but rejected by the writer is a name this module never wrote.
 */
const KEY_GRAMMAR = /^[A-Za-z0-9._-]+$/;

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
  if (typeof key !== "string" || !KEY_GRAMMAR.test(key) || key === "..") {
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
 * The value never reaches a command line on either path. The keychain path
 * feeds `security -i` a command stream on **stdin**, because an argument is
 * visible in `ps` to every process running as this user for as long as the call
 * lasts. The file path writes and chmods a temporary before renaming, so the
 * credential is never briefly world-readable on a filesystem where the default
 * umask would have made it so.
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
 * Whether this machine already holds a bootstrap under that name.
 *
 * Asked so `environment local` can re-materialize after a rotation in the vault
 * without demanding the token again — that is the common case, and prompting
 * every time would make it the tedious one.
 *
 * Presence only. The value is never read here, because nothing about deciding
 * whether to prompt needs it.
 * @param {string} key Bootstrap variable name.
 * @param {object} [deps] Injected seams, for tests.
 * @returns {boolean} True when a value is stored.
 */
export function hasBootstrap(key, deps = {}) {
  const kind = deps.kind ?? storeKind();
  const env = deps.env ?? process.env;

  if (kind === "keychain") {
    const run = deps.run ?? execFileSync;
    try {
      run(
        "security",
        ["find-generic-password", "-s", assertKey(key), "-a", env.USER ?? ""],
        { stdio: "ignore" }
      );
      return true;
    } catch {
      // probe-direction: fail-closed — false means "no bootstrap value proven
      // present", which makes the setup flow ASK for one. A keychain that cannot
      // be queried costs a redundant prompt, never a skipped bootstrap.
      return false;
    }
  }
  return (deps.exists ?? existsSync)(deps.path ?? bootstrapFile(key, env));
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

/**
 * Every file-backed bootstrap NAME this machine holds. Never a value.
 *
 * Exists so a failed lookup can say what is actually here instead of only what
 * was missing. Those are different sentences: "no bootstrap credential is
 * provisioned" and "one is provisioned under a different name" have different
 * remedies, and a message that cannot tell them apart gets read as the first
 * when it means the second (CodySwannGT/lisa#3555).
 *
 * Absence is empty, never an error. This runs on a path that is already
 * failing, and a diagnostic that throws replaces the real message with its own.
 *
 * Two filters, and both are load-bearing because these names are rendered into
 * an operator-facing message and into a `.lisa.config.json` snippet the
 * operator is invited to paste:
 *
 * - **Grammar.** `readdirSync` returns whatever is in the directory. A name
 *   outside {@link KEY_GRAMMAR} is not a key this module would ever have
 *   written, and one carrying a quote or a newline would corrupt the suggested
 *   JSON rather than merely look odd. The same grammar `assertKey` enforces on
 *   the way in is applied on the way out.
 * - **Dotfiles.** The reader is deliberately STRICTER than the writer here.
 *   `KEY_GRAMMAR` permits a leading dot, so `assertKey(".DS_Store")` passes —
 *   and macOS writes exactly that file into any directory it browses. Listing
 *   it would offer the operator a credential named `.DS_Store`. Being stricter
 *   on read is the safe direction: it can only omit a name, never invent one.
 * - **Content.** An empty file is not a credential. Offering one sends the
 *   operator to a store that will fail the same way a second time — and the
 *   environment scan already refuses empty values, so listing empty FILES would
 *   have made the two stores disagree about what counts as provisioned.
 * @param {Record<string, string|undefined>} [env] Environment to read.
 * @returns {string[]} Bootstrap names that hold a credential, sorted.
 */
export function listBootstrapFiles(env = process.env) {
  try {
    const root = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config");
    return readdirSync(join(root, "lisa", "bootstrap"))
      .filter(name => KEY_GRAMMAR.test(name) && !name.startsWith("."))
      .filter(name => readBootstrapFile(name, env) !== "")
      .sort();
  } catch {
    return [];
  }
}

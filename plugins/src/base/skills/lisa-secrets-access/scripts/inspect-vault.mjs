#!/usr/bin/env node
/**
 * Safe discovery: which secrets a vault grants, by name and size only.
 *
 * This exists because the obvious way to answer "what is this key called?" is
 * `bws secret list -o tsv` (or `table`, or `env`), and **all three print
 * VALUES**. Run once to find one name and every secret in the project is in a
 * terminal, a CI log, or an agent transcript — nowhere any of them can be taken
 * back from.
 *
 * Two properties, and the second one is the reason this is a file:
 *
 * - **Names and lengths, never values.** A length is enough to tell a populated
 *   secret from an empty one and to confirm you are looking at the credential
 *   you meant, which is all discovery ever needs.
 * - **A file invoked with literal argv**, so the command is
 *   `bws run -- node .../inspect-vault.mjs` and what runs can be read before it
 *   runs. The inline alternative — `bws run --shell sh '...'` — is refused by
 *   agent sandboxes as unanalyzable, and the natural response to that refusal
 *   is to try variants until one slips through. The remedy is structural rather
 *   than a better incantation, and it is better than an inline pipeline whether
 *   or not a sandbox is watching.
 *
 * Deliberately no `--json` and no way to print a value. A tool that can be
 * asked for one will eventually be asked for one.
 *
 * Usage:
 *   bws run -- node scripts/inspect-vault.mjs [PREFIX]
 * @module inspect-vault
 */

/**
 * Variables present in any shell, which say nothing about the vault.
 *
 * Prefix-matched rather than listed exactly, because the point is to keep the
 * output short enough to read — a hundred inherited variables buries the six
 * that came from the vault.
 */
const AMBIENT = [
  "BASH",
  "COLORTERM",
  "COMMAND_MODE",
  "DISPLAY",
  "EDITOR",
  "HOME",
  "HOSTNAME",
  "INFOPATH",
  "LANG",
  "LC_",
  "LESS",
  "LOGNAME",
  "LS_COLORS",
  "MAIL",
  "MANPATH",
  "NODE_",
  "OLDPWD",
  "PAGER",
  "PATH",
  "PS1",
  "PWD",
  "SHELL",
  "SHLVL",
  "SSH_",
  "TERM",
  "TMPDIR",
  "TZ",
  "USER",
  "VISUAL",
  "XPC_",
  "_",
];

/**
 * Whether a variable is ordinary shell furniture rather than a vault entry.
 * @param {string} key Variable name.
 * @returns {boolean} Whether to hide it.
 */
export function isAmbient(key) {
  return AMBIENT.some(prefix => key === prefix || key.startsWith(prefix));
}

/**
 * Describe the environment as names and sizes.
 *
 * Split from printing so the "no value ever appears in the output" property is
 * testable directly, rather than inferred from reading the formatting code.
 * @param {Record<string, string|undefined>} env Environment to describe.
 * @param {string} [prefix] Optional name prefix to narrow to.
 * @returns {Array<{name: string, bytes: number}>} One row per variable.
 */
export function describeEnv(env, prefix = "") {
  return Object.entries(env)
    .filter(([key]) => /^[A-Z][A-Z0-9_]*$/.test(key) && !isAmbient(key))
    .filter(([key]) => key.startsWith(prefix))
    .map(([name, value]) => ({ name, bytes: Buffer.byteLength(value ?? "") }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function main() {
  const rows = describeEnv(process.env, process.argv[2] ?? "");
  if (!rows.length) {
    console.log(
      "no vault-shaped variables in this environment.\n" +
        "Run this UNDER the provider: bws run -- node <this file>"
    );
    return;
  }
  const width = Math.max(...rows.map(row => row.name.length));
  for (const row of rows) {
    // A length, never a value — and an explicit word for zero, because an empty
    // secret is the one this is most often run to find.
    const size = row.bytes === 0 ? "EMPTY" : `${row.bytes} bytes`;
    console.log(`  ${row.name.padEnd(width)}  ${size}`);
  }
  console.log(`\n${rows.length} secret(s). Values are never printed.`);
}

/**
 * Whether this module is the one node was asked to run.
 *
 * Both sides are realpath'd: a raw URL comparison answers "no" through a
 * symlinked checkout, a git worktree, or a /tmp path on macOS, so the module
 * loads, runs nothing and exits 0 — a silent no-op that reads as success.
 *
 * A local copy rather than an import: plugin payload scripts ship standalone,
 * with no `lib/` sibling to import from once installed.
 * @param {string} moduleUrl - The caller's own `import.meta.url`.
 * @param {string | undefined} [argv1] - Entry path; defaults to `process.argv[1]`.
 * @returns {boolean} Whether the caller should run its CLI body.
 */
function invokedAsScript(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (invokedAsScript(import.meta.url)) {
  main();
}

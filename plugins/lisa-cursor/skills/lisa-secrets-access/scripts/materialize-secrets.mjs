#!/usr/bin/env node
/**
 * Write the provider's current view to the two files a materializing surface
 * reads.
 *
 * Only surfaces that cannot read through live use this. A remote agent
 * container prepares itself during setup — before any task exists, and often
 * before network policy would permit a provider call from the task itself — so
 * files written at that moment are the only channel available. Everywhere else
 * this is forbidden, because a value on disk is a copy that can drift and leak.
 *
 * Both files are written atomically from one provider response, so values and
 * notes always describe the same revision. A rename within the destination
 * directory is atomic on the same filesystem; a temporary file elsewhere would
 * not be.
 *
 * Usage:
 *   materialize-secrets.mjs [--dry-run]
 * @module materialize-secrets
 */

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
import { join } from "node:path";

import {
  BOOTSTRAP_KEY,
  deriveAwsEnvironment,
  parseBootstrap,
  renderAwsProfiles,
} from "./aws-bootstrap.mjs";
import { renderEnv, renderNotes } from "./envfile.mjs";
import { fetchAll } from "./providers.mjs";
import { materializedPaths, readConfig } from "./surfaces.mjs";

/**
 * Write one file to a temporary sibling, then move it into place.
 *
 * The mode is set before the rename so the file is never briefly readable by
 * anyone else, and the temporary sibling is removed on any failure so a partial
 * write cannot be mistaken for a complete one.
 * @param {string} destination Final path.
 * @param {string} contents File body.
 */
function writeAtomic(destination, contents) {
  const temporary = `${destination}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, contents, { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, destination);
  } catch (err) {
    rmSync(temporary, { force: true });
    throw err;
  }
}

/**
 * Materialize the configured provider view for the current surface.
 * @param {object} [cfg] Resolved configuration.
 * @returns {{count: number, dir: string}} What was written, and where.
 */
/** Marks the block this owns, so it is replaced rather than appended twice. */
const PROFILE_MARKER = "# >>> lisa secrets (managed) >>>";

/** Closes the managed block. */
const PROFILE_END = "# <<< lisa secrets (managed) <<<";

/**
 * Identifies an `~/.aws` file as one this wrote, and may therefore replace.
 *
 * `#` is a comment in the AWS shared-config format, so this is inert to every
 * consumer while still being the thing that distinguishes "our file, refresh
 * it" from "someone else's file, leave it alone".
 */
const MANAGED_MARKER = "# >>> managed by lisa-secrets-access >>>";

/** Closes the managed region of an `~/.aws` file. */
const MANAGED_END = "# <<< managed by lisa-secrets-access <<<";

/**
 * Replace this module's delimited region in a file, preserving everything else.
 *
 * Written as a merge rather than a whole-file write because both `~/.aws` files
 * routinely hold sections nobody here knows about — an operator's own profiles,
 * or a container's bare `[default]`. Refusing on their account wrote nothing at
 * all; overwriting would delete them. This does neither.
 * @param {string} current Existing file contents, or "".
 * @param {string} body The region this module owns.
 * @returns {string} The merged file.
 */
export function upsertManagedBlock(current, body) {
  const block = `${MANAGED_MARKER}\n${body.trimEnd()}\n${MANAGED_END}`;
  const start = current.indexOf(MANAGED_MARKER);

  if (start === -1) {
    const prefix =
      current && !current.endsWith("\n") ? `${current}\n` : current;
    return `${prefix}${prefix ? "\n" : ""}${block}\n`;
  }

  const endAt = current.indexOf(MANAGED_END, start);
  // A truncated block (marker opened, never closed) would otherwise swallow the
  // rest of the file on every subsequent write.
  const after =
    endAt === -1
      ? ""
      : current.slice(endAt + MANAGED_END.length).replace(/^\n/, "");
  return `${current.slice(0, start)}${block}\n${after}`;
}

/**
 * Make every shell in this container load the materialized secrets.
 *
 * `set -a` so the values are exported rather than merely set as shell
 * variables, and sourced LAST so they win over anything the host injected —
 * environment variables outrank profile files in AWS's credential chain, which
 * is the whole reason a valid credential was being ignored.
 *
 * Guarded on the file existing, so a shell still starts cleanly before the
 * first materialization or if the file is removed. Written to both `.bashrc`
 * and `.profile` because which one a given shell reads depends on whether it is
 * interactive or a login shell, and an agent's tool calls are not reliably
 * either.
 * @param {string} valuesFile Absolute path to the materialized env file.
 * @param {object} [options] Home directory and file seams, for tests.
 * @returns {string[]} The profile files that now source it.
 */
export function installProfileSourcing(valuesFile, options = {}) {
  const {
    home = process.env.HOME || homedir(),
    exists = existsSync,
    read = readFileSync,
    write = writeFileSync,
  } = options;

  const block = [
    PROFILE_MARKER,
    // Unset BEFORE sourcing. A cloud container injects its own AWS key pair,
    // and environment credentials outrank both ~/.aws profiles and AWS_PROFILE
    // — so leaving them set means the session ignores whichever environment it
    // selected and runs as whatever the host injected. That is how a perfectly
    // valid credential produced InvalidClientTokenId for a day. Removing the
    // poison beats out-shouting it, and it is what lets `--profile agent-dev`
    // behave here exactly as it does on a developer's machine.
    `unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN`,
    `if [ -f "${valuesFile}" ]; then`,
    `  set -a`,
    `  . "${valuesFile}"`,
    `  set +a`,
    `fi`,
    PROFILE_END,
  ].join("\n");

  const updated = [];
  for (const name of [".bashrc", ".profile"]) {
    const file = join(home, name);
    const current = exists(file) ? String(read(file, "utf8")) : "";

    // Replace an existing managed block rather than appending another: this
    // runs on every session, and an appended-forever profile is its own bug.
    const start = current.indexOf(PROFILE_MARKER);
    const next =
      start === -1
        ? `${current}${current.endsWith("\n") || !current ? "" : "\n"}\n${block}\n`
        : `${current.slice(0, start)}${block}${current.slice(
            current.indexOf(PROFILE_END, start) + PROFILE_END.length
          )}`;

    if (next !== current) {
      write(file, next, { mode: 0o600 });
      updated.push(file);
    }
  }
  return updated;
}

/**
 * Write `~/.aws/credentials` and `~/.aws/config` from the bootstrap bundle.
 *
 * Both at 0600 inside a 0700 directory, matching how the materialized secrets
 * themselves are protected — the credentials file holds the source key pair.
 * @param {object|null} bundle Parsed bootstrap bundle.
 * @param {object} [options] Home directory and file seams, for tests.
 * @returns {string[]} The profile names written.
 */
export function installAwsProfiles(bundle, options = {}) {
  const {
    home = process.env.HOME || homedir(),
    mkdir = mkdirSync,
    write = writeFileSync,
    read = readFileSync,
    exists = existsSync,
    chmod = chmodSync,
  } = options;

  const rendered = renderAwsProfiles(bundle);
  if (!rendered) return [];

  const dir = join(home, ".aws");
  mkdir(dir, { recursive: true, mode: 0o700 });
  chmod(dir, 0o700);

  // Merge into a delimited block; never replace the file.
  //
  // Refusing whole files whenever one already existed sounded safe and was
  // worse than useless: a container ships `~/.aws/config` containing a bare
  // `[default]`, so the guard fired every time, wrote nothing, and returned
  // silently — while AWS_PROFILE was still derived from the bundle. The session
  // got a pointer to a profile that did not exist:
  //
  //     The config profile (agent-dev) could not be found
  //
  // Merging keeps the operator's own sections intact AND writes ours, which is
  // what the guard was actually for. Same delimited-block approach as the shell
  // profile, and `#` is a comment in the shared-config format so the markers are
  // inert to every consumer.
  for (const [name, body] of [
    ["credentials", rendered.credentials],
    ["config", rendered.config],
  ]) {
    const file = join(dir, name);
    const current = exists(file) ? String(read(file, "utf8")) : "";
    write(file, upsertManagedBlock(current, body), { mode: 0o600 });
  }

  return rendered.profiles;
}

export function materialize(cfg = readConfig()) {
  if (!cfg.capabilities.mayWriteValues) {
    throw new Error(
      `surface "${cfg.surface}" may not write secret values to disk.\n` +
        `It can read through to the provider, so a copy on disk would add drift ` +
        `and exposure without adding capability.`
    );
  }

  const selected = fetchAll(cfg);
  if (!selected.size) {
    throw new Error(
      "no exportable secrets matched the configured boundary.\n" +
        "Check the machine account's project grants and any narrowing filters."
    );
  }

  // The AWS bundle is stored as one JSON blob under a name no SDK reads, so
  // the variables it implies are derived here. Without them a host-injected
  // AWS_ACCESS_KEY_ID wins — environment variables outrank profile files in the
  // credential chain — and every AWS call fails with InvalidClientTokenId even
  // though the real credential materialized correctly.
  const derived = deriveAwsEnvironment(selected);
  for (const [name, entry] of derived) selected.set(name, entry);

  const { dir, valuesFile, notesFile } = materializedPaths(cfg.namespace);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  writeAtomic(valuesFile, renderEnv(selected));
  writeAtomic(notesFile, renderNotes(selected));

  // Writing the file is not the same as the values being in effect.
  //
  // A materialized secrets.env that nothing sources changes nothing: the agent's
  // shell starts from the container's own environment, so a host-injected
  // AWS_ACCESS_KEY_ID keeps winning and every call fails with
  // InvalidClientTokenId while the correct credential sits on disk, correct and
  // unused. Deriving the variables (above) only fixes precedence WITHIN the
  // file — something still has to load the file.
  //
  // So the shell profile sources it. That is what makes "the credential is
  // materialized" and "the credential is usable" the same statement.
  const sourced = installProfileSourcing(valuesFile);

  // The environments live in separate AWS accounts, reached by assuming a role
  // per environment. Without these files `--profile agent-dev` fails with
  // "profile not found" and everything silently falls back to the bootstrap
  // identity, which can assume roles and do nothing else.
  const profiles = installAwsProfiles(
    parseBootstrap(selected.get(BOOTSTRAP_KEY)?.value)
  );

  return {
    count: selected.size,
    derived: derived.size,
    dir,
    sourced,
    profiles,
  };
}

function main() {
  const cfg = readConfig();
  if (process.argv.includes("--dry-run")) {
    const selected = fetchAll(cfg);
    // Derive here too, or the preview lies in the one place it matters most:
    // the derived names are exactly the ones that override ambient host
    // credentials, so omitting them hides the most surprising effect of the run
    // and reports a smaller count than the real write produces.
    for (const [name, entry] of deriveAwsEnvironment(selected)) {
      selected.set(name, entry);
    }
    const { dir } = materializedPaths(cfg.namespace);
    console.log(`would write ${selected.size} secret(s) to ${dir}`);
    console.log([...selected.keys()].sort().join("\n"));
    return;
  }
  const { count, derived, dir } = materialize(cfg);
  console.log(`materialized ${count} secret(s) and their notes into ${dir}`);
  if (derived > 0) {
    // Said out loud: this run exported variables the host may also have set.
    console.log(
      `  ${derived} AWS variable(s) derived from the bootstrap bundle, ` +
        `overriding any ambient value`
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

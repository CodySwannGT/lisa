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
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
/**
 * Marker version this build writes. Bumping it is SAFE, which is the point.
 *
 * The recognisers below match the FAMILY — the frozen identifier plus any
 * version — rather than one literal string, so a block written by an older
 * build is still found and replaced in place. Before that, the reader looked
 * for the exact text it was about to write, so the first rename made it
 * conclude there was no block here and append a second one.
 *
 * That failure is additive and silent, and this module is the worst place in
 * Lisa for it: it writes into `~/.aws` files and a shell profile, outside any
 * repository, where no apply, diff, or review ever revisits the result. An
 * orphaned block in a shell profile is STILL SOURCED, and profiles apply
 * assignments in order — so whichever block comes last wins, and an operator
 * can end up running under credentials from a block Lisa believes it no longer
 * manages. That is credential selection going wrong with no review step.
 *
 * Everywhere else in the codebase the mitigation is "widen the recogniser and
 * accept the old shape until an apply normalises the file". There is no such
 * operation here: the old population never drains and cannot be counted, so
 * the recogniser must accept every past version permanently.
 *
 * Following `core/apply-receipt`, which treats a `schema_version` it does not
 * recognise as NO RECEIPT rather than one it half-understands: on an
 * unrecognised marker, fail toward redoing the work, not toward assuming it is
 * done. Here that means replacing every family member found, so a file already
 * carrying orphans from a past rename is repaired on the next run rather than
 * accumulating one more.
 */
const MARKER_VERSION = "v2";

/**
 * The frozen half of each marker. Changing one of these DOES orphan blocks —
 * that is the whole contract, and it is why the version lives beside it.
 *
 * This does not make renaming impossible, it makes it deliberate: an innocuous
 * text edit no longer orphans a block, and the one edit that still would is the
 * one these comments forbid.
 */
const PROFILE_FAMILY = "lisa secrets (managed";

/** The frozen family identifier for an `~/.aws` managed region. */
const MANAGED_FAMILY = "managed by lisa-secrets-access";

/**
 * Build the start/end recognisers for one marker family.
 *
 * Matches the family followed by anything up to the closing delimiter, so
 * `(managed)` — every block in the field today — and `(managed v2)` are both
 * found by the same reader.
 * @param {string} family Frozen family identifier.
 * @returns {{start: RegExp, end: RegExp}} Global recognisers for the family.
 */
function familyRecognisers(family) {
  const quoted = family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    start: new RegExp(`# >>> ${quoted}[^\\n]*>>>`, "g"),
    end: new RegExp(`# <<< ${quoted}[^\\n]*<<<`, "g"),
  };
}

/**
 * Index of the first family match at or after `from`, and its length.
 * @param {string} text Haystack.
 * @param {RegExp} recogniser Global family recogniser.
 * @param {number} from Index to search from.
 * @returns {{index: number, length: number}} `index` is -1 when absent.
 */
function findFamily(text, recogniser, from = 0) {
  recogniser.lastIndex = from;
  const match = recogniser.exec(text);
  return match === null
    ? { index: -1, length: 0 }
    : { index: match.index, length: match[0].length };
}

/**
 * Remove every managed block of one family, leaving the rest of the file.
 *
 * Every block, not just the first: a file that already carries orphans from a
 * rename that happened before this fix must come out with exactly one block,
 * or the fix would leave the damage it exists to prevent.
 * @param {string} text File contents.
 * @param {string} family Frozen family identifier.
 * @returns {string} The file with every family block removed.
 */
function stripFamilyBlocks(text, family) {
  const { start, end } = familyRecognisers(family);
  let out = text;
  for (;;) {
    const opened = findFamily(out, start);
    if (opened.index === -1) return out;
    const closed = findFamily(out, end, opened.index + opened.length);
    // A truncated block (opened, never closed) is not safe to interpret. Any
    // guessed boundary could delete operator-authored content after the marker,
    // so refuse before the caller writes and preserve the original byte-for-byte.
    if (closed.index === -1) {
      throw new Error(
        `Refusing to rewrite a managed ${family} block with no closing marker. ` +
          `Repair the marker pair first; no file was changed.`
      );
    }
    const after = out.slice(closed.index + closed.length).replace(/^\n/, "");
    out = `${out.slice(0, opened.index)}${after}`;
  }
}

/** Marks the block this owns, so it is replaced rather than appended twice. */
const PROFILE_MARKER = `# >>> ${PROFILE_FAMILY} ${MARKER_VERSION}) >>>`;

/** Closes the managed block. */
const PROFILE_END = `# <<< ${PROFILE_FAMILY} ${MARKER_VERSION}) <<<`;

/**
 * Identifies an `~/.aws` file as one this wrote, and may therefore replace.
 *
 * `#` is a comment in the AWS shared-config format, so this is inert to every
 * consumer while still being the thing that distinguishes "our file, refresh
 * it" from "someone else's file, leave it alone".
 */
const MANAGED_MARKER = `# >>> ${MANAGED_FAMILY} ${MARKER_VERSION} >>>`;

/** Closes the managed region of an `~/.aws` file. */
const MANAGED_END = `# <<< ${MANAGED_FAMILY} ${MARKER_VERSION} <<<`;

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
  const opened = findFamily(current, familyRecognisers(MANAGED_FAMILY).start);

  if (opened.index === -1) {
    const prefix =
      current && !current.endsWith("\n") ? `${current}\n` : current;
    return `${prefix}${prefix ? "\n" : ""}${block}\n`;
  }

  // Everything this module owns is stripped first, so a file already carrying
  // orphans from a rename that predates the family recogniser comes out with
  // exactly one block rather than one more.
  const withoutOurs = stripFamilyBlocks(current, MANAGED_FAMILY);
  const head = withoutOurs.slice(0, opened.index);
  const tail = withoutOurs.slice(opened.index);
  return `${head}${block}\n${tail}`;
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
    // The pinned toolchain installs into ~/.local/bin, which is not on PATH in
    // every base image. Without this the tools are present and unfindable:
    // `command -v bws` fails and anything spawning it gets ENOENT, which reads
    // as "nothing was installed" when everything was.
    `case ":$PATH:" in *":$HOME/.local/bin:"*) ;; ` +
      `*) PATH="$HOME/.local/bin:$PATH"; export PATH;; esac`,
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
    const opened = findFamily(current, familyRecognisers(PROFILE_FAMILY).start);
    // Stripping EVERY family block before writing one is what makes an already
    // orphaned profile self-heal. It matters more here than anywhere else in
    // Lisa: an orphaned block in a shell profile is still sourced, and the last
    // assignment wins, so a stale block silently selects the wrong credentials.
    const withoutOurs = stripFamilyBlocks(current, PROFILE_FAMILY);
    const next =
      opened.index === -1
        ? `${current}${current.endsWith("\n") || !current ? "" : "\n"}\n${block}\n`
        : `${withoutOurs.slice(0, opened.index)}${block}\n${withoutOurs
            .slice(opened.index)
            .replace(/^\n/, "")}`;

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
/**
 * Profile names already defined OUTSIDE this module's managed block.
 *
 * Only what lies outside the block counts: our own previous output is meant to
 * be replaced, and treating it as a collision would make the second run fail.
 * @param {string} dir The `.aws` directory.
 * @param {string[]} names Profile names about to be written.
 * @param {object} io `exists` and `read` seams.
 * @returns {string[]} Colliding names, in the order given.
 */
export function collidingProfiles(dir, names, io = {}) {
  const { exists = existsSync, read = readFileSync } = io;
  const file = join(dir, "config");
  if (!exists(file)) return [];

  const text = String(read(file, "utf8"));
  // Every family block, not just the current version's. An orphan left by an
  // older marker is still OUR previous output, so counting its profiles as a
  // host collision would refuse to write the very names we wrote last time.
  const outside = stripFamilyBlocks(text, MANAGED_FAMILY);

  return names.filter(name =>
    new RegExp(
      `^\\s*\\[profile\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\]`,
      "m"
    ).test(outside)
  );
}

export function installAwsProfiles(bundle, options = {}) {
  const {
    home = process.env.HOME || homedir(),
    mkdir = mkdirSync,
    write = writeAtomic,
    read = readFileSync,
    exists = existsSync,
    chmod = chmodSync,
  } = options;

  const rendered = renderAwsProfiles(bundle);
  if (!rendered) return [];

  const dir = join(home, ".aws");

  // Refuse to write a profile name the operator already uses outside our block.
  //
  // AWS does not error on a duplicate `[profile x]` — it resolves one and
  // ignores the other. So writing `acmeorgd-dev` next to an operator's existing SSO
  // `acmeorgd-dev` would silently run some calls as the wrong identity, which is
  // worse than either winning outright. Merging protects their sections from
  // being deleted; this protects them from being shadowed.
  //
  // Deliberately not resolved by renaming theirs: this module writes its own
  // block and nothing else. The operator renames (conventionally to `-sso`) and
  // re-runs.
  const collisions = collidingProfiles(dir, rendered.profiles, {
    exists,
    read,
  });
  if (collisions.length > 0) {
    throw new Error(
      `~/.aws/config already defines ${collisions.map(n => `"${n}"`).join(", ")} ` +
        `outside the lisa-managed block.\n` +
        `Writing them would create duplicate sections, and AWS resolves only ` +
        `one — some calls would silently use the wrong identity.\n` +
        `Rename the existing entries (for example to "${collisions[0]}-sso") ` +
        `and run this again.`
    );
  }

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
    write(file, upsertManagedBlock(current, body));
  }

  return rendered.profiles;
}

export function materialize(cfg = readConfig(), options = {}) {
  // `requested` distinguishes an OPERATOR asking from a flow deciding.
  //
  // The capability governs automated behaviour: a session-start hook on a
  // laptop must not write credentials to disk, because the provider CLI is
  // authenticated there and a copy would add drift and exposure without adding
  // capability. That reasoning holds, and the guard below still enforces it.
  //
  // It does not hold for `lisa environment local`, where the operator typed the
  // command whose entire purpose is to put credentials on this machine — the
  // AWS `-static` profiles reference variables that exist only once the env
  // file is materialized, so refusing there means the profiles never work.
  //
  // Two different questions, so two different answers, rather than flipping
  // `local` to `materialized: true` and silently starting to write on every
  // machine that upgrades.
  if (!cfg.capabilities.mayWriteValues && !options.requested) {
    throw new Error(
      `surface "${cfg.surface}" may not write secret values to disk.\n` +
        `It can read through to the provider, so a copy on disk would add drift ` +
        `and exposure without adding capability.\n` +
        `Run 'lisa environment local --tenant=<name>' to ask for it explicitly.`
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

  // `--aws-profiles-only` writes ~/.aws and NOTHING else, on any surface.
  //
  // A laptop refuses to materialize secrets to disk, deliberately: read-through
  // to the provider adds no drift and leaves no copy. That rule is about the
  // thirteen values in secrets.env, and it stays exactly as it was here.
  //
  // The AWS profiles are a different bargain, requested explicitly. Agents
  // working on a developer's machine should act as RemoteAgent rather than
  // borrowing the human's SSO identity — separate attribution in CloudTrail,
  // the role's blast radius instead of a person's, and the same `agent-*`
  // profile names as a container so a script does not need two vocabularies.
  //
  // The cost is real and belongs in the open: `source_profile` needs a
  // long-lived key pair, so this writes one to a machine that is not
  // disposable, which is the thing the local surface otherwise prevents. It is
  // therefore opt-in per run, never automatic, and never part of a normal
  // materialize.
  if (process.argv.includes("--aws-profiles-only")) {
    const selected = fetchAll(cfg);
    const bundle = parseBootstrap(selected.get(BOOTSTRAP_KEY)?.value);
    const written = installAwsProfiles(bundle);

    if (written.length === 0) {
      console.log(
        `no AWS profiles written — ${BOOTSTRAP_KEY} is absent, unparseable, ` +
          `or declares no profile carrying a roleArn.`
      );
      return;
    }
    console.log(
      `wrote ${written.length} AWS profile(s): ${written.join(", ")}`
    );
    console.log(
      `  Sourced from a long-lived key pair in ~/.aws/credentials. Existing\n` +
        `  sections were preserved — only the lisa-managed block was replaced.\n` +
        `  Use them explicitly: aws --profile ${written[0]} ...`
    );
    return;
  }

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
    // Do not claim an override this does not perform.
    //
    // This line used to end "overriding any ambient value". That was true when
    // the key pair was exported and stopped being true when the pair moved into
    // ~/.aws and AWS_PROFILE took its place — AWS_PROFILE loses to ambient
    // environment credentials, it does not beat them. The stale sentence sent
    // two separate investigations after a credential problem that did not
    // exist, while the real fault was that nothing sourced the file. A message
    // that overclaims costs more than no message.
    console.log(
      `  ${derived} AWS variable(s) derived from the bootstrap bundle. ` +
        `These take\n  effect only in a shell that sourced the materialized ` +
        `env file; ambient\n  credentials outrank AWS_PROFILE, so prefer an ` +
        `explicit --profile.`
    );
  }
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
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

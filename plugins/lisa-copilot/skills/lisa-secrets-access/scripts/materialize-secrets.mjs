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
  LEGACY_SOURCE_PROFILE,
  parseBootstrap,
  renderAwsProfiles,
} from "./aws-bootstrap.mjs";
import { renderEnv, renderNotes } from "./envfile.mjs";
import { assertOwner, ownerOf, ownerTag } from "./owner.mjs";
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
const MARKER_VERSION = "v3";

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
 * Index of the first family match at or after `from`, its length, and its text.
 *
 * The matched text is returned because the owner lives inside the marker, and
 * re-slicing it at every call site is how a reader ends up owner-blind in one
 * of them.
 * @param {string} text Haystack.
 * @param {RegExp} recogniser Global family recogniser.
 * @param {number} from Index to search from.
 * @returns {{index: number, length: number, text: string}} `index` is -1 when absent.
 */
function findFamily(text, recogniser, from = 0) {
  recogniser.lastIndex = from;
  const match = recogniser.exec(text);
  return match === null
    ? { index: -1, length: 0, text: "" }
    : { index: match.index, length: match[0].length, text: match[0] };
}

/**
 * Every managed block of one family, in file order, with its owner.
 *
 * Every block, not just the first: a file may carry orphans from a rename that
 * predates the family recogniser, AND — since a machine can serve more than one
 * tenant — blocks belonging to other projects that must be left exactly alone.
 * Those are different populations with different handling, so the reader
 * enumerates rather than assuming.
 * @param {string} text File contents.
 * @param {string} family Frozen family identifier.
 * @returns {Array<{start: number, end: number, owner: string|null, body: string}>} Blocks.
 */
function familyBlocks(text, family) {
  const { start, end } = familyRecognisers(family);
  const blocks = [];
  let from = 0;
  for (;;) {
    const opened = findFamily(text, start, from);
    if (opened.index === -1) return blocks;
    const closed = findFamily(text, end, opened.index + opened.length);
    // A truncated block (opened, never closed) is not safe to interpret. Any
    // guessed boundary could delete operator-authored content after the marker,
    // so refuse before the caller writes and preserve the original byte-for-byte.
    if (closed.index === -1) {
      throw new Error(
        `Refusing to rewrite a managed ${family} block with no closing marker. ` +
          `Repair the marker pair first; no file was changed.`
      );
    }
    const stop = closed.index + closed.length;
    blocks.push({
      start: opened.index,
      end: stop,
      owner: ownerOf(opened.text),
      body: text.slice(opened.index, stop),
    });
    from = stop;
  }
}

/**
 * Remove the family blocks a predicate selects, leaving the rest of the file.
 *
 * Selective rather than total, and that is the fix. "Our own previous output is
 * meant to be replaced" was true and unqualified by WHOSE: a second tenant's
 * run matched the same unowned marker and stripped the first tenant's block.
 * @param {string} text File contents.
 * @param {string} family Frozen family identifier.
 * @param {(block: {owner: string|null, body: string}) => boolean} selects Which blocks to remove.
 * @returns {string} The file with the selected blocks removed.
 */
function stripFamilyBlocks(text, family, selects) {
  // Back to front, so an earlier block's offsets are still valid after a later
  // one is cut.
  const doomed = familyBlocks(text, family).filter(block => selects(block));
  let out = text;
  for (const block of doomed.reverse()) {
    const after = out.slice(block.end).replace(/^\n/, "");
    out = `${out.slice(0, block.start)}${after}`;
  }
  return out;
}

/**
 * Marks the block one owner owns, so it is replaced rather than appended twice.
 * @param {string} owner Validated owner.
 * @returns {string} The opening marker.
 */
function profileMarker(owner) {
  return `# >>> ${PROFILE_FAMILY} ${MARKER_VERSION} ${ownerTag(owner)}) >>>`;
}

/**
 * Closes one owner's managed shell block.
 * @param {string} owner Validated owner.
 * @returns {string} The closing marker.
 */
function profileEnd(owner) {
  return `# <<< ${PROFILE_FAMILY} ${MARKER_VERSION} ${ownerTag(owner)}) <<<`;
}

/**
 * Identifies an `~/.aws` region as one this wrote FOR A GIVEN OWNER.
 *
 * `#` is a comment in the AWS shared-config format, so this is inert to every
 * consumer while still being the thing that distinguishes "our file, refresh
 * it" from "someone else's file, leave it alone" — and now also from "another
 * Lisa project's, leave it alone too", which is the case that was missing.
 * @param {string} owner Validated owner.
 * @returns {string} The opening marker.
 */
function managedMarker(owner) {
  return `# >>> ${MANAGED_FAMILY} ${MARKER_VERSION} ${ownerTag(owner)} >>>`;
}

/**
 * Closes one owner's managed region of an `~/.aws` file.
 * @param {string} owner Validated owner.
 * @returns {string} The closing marker.
 */
function managedEnd(owner) {
  return `# <<< ${MANAGED_FAMILY} ${MARKER_VERSION} ${ownerTag(owner)} <<<`;
}

/**
 * Whether a block belongs to `owner`, for stripping.
 *
 * An unowned block is NEVER ours here. It predates ownership, so it may belong
 * to any tenant on this machine, and adopting it is exactly the silent
 * consumption this change exists to stop. It is reported instead, and removed
 * only under an explicit prune.
 * @param {string} owner Our owner.
 * @returns {(candidate: string|null) => boolean} Predicate over block owners.
 */
function ownedBy(owner) {
  return block => block.owner === owner;
}

/**
 * Replace one owner's delimited region in a file, preserving everything else.
 *
 * Written as a merge rather than a whole-file write because both `~/.aws` files
 * routinely hold sections nobody here knows about — an operator's own profiles,
 * a container's bare `[default]`, or another Lisa project's block. Refusing on
 * their account wrote nothing at all; overwriting would delete them. This does
 * neither.
 * @param {string} current Existing file contents, or "".
 * @param {string} body The region this owner owns.
 * @param {string} owner Validated owner.
 * @param {boolean} [claimLegacy] Also replace pre-ownership blocks.
 * @returns {string} The merged file.
 */
export function upsertManagedBlock(current, body, owner, claimLegacy = false) {
  const scope = assertOwner(owner, "~/.aws");
  const block = `${managedMarker(scope)}\n${body.trimEnd()}\n${managedEnd(scope)}`;

  // Legacy first, and OUR position measured after it. Removing a pre-ownership
  // block that sits ahead of ours moves ours, so a position taken before the
  // removal would splice the replacement into the wrong place.
  const withoutLegacy = claimLegacy
    ? stripFamilyBlocks(current, MANAGED_FAMILY, block => block.owner === null)
    : current;
  const mine = familyBlocks(withoutLegacy, MANAGED_FAMILY).find(
    found => found.owner === scope
  );
  // Only ours. Everything else in the family belongs to another project.
  const withoutOurs = stripFamilyBlocks(
    withoutLegacy,
    MANAGED_FAMILY,
    ownedBy(scope)
  );

  if (mine === undefined) {
    const prefix =
      withoutOurs && !withoutOurs.endsWith("\n")
        ? `${withoutOurs}\n`
        : withoutOurs;
    return `${prefix}${prefix ? "\n" : ""}${block}\n`;
  }

  // Nothing before our first block is ours, so stripping ours cannot have moved
  // anything ahead of it — the original offset still points where it did.
  const head = withoutOurs.slice(0, mine.start);
  const tail = withoutOurs.slice(mine.start);
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
    owner,
    claimShell = process.env.LISA_SECRETS_CLAIM_SHELL_PROFILE === "1",
    exists = existsSync,
    read = readFileSync,
    write = writeFileSync,
  } = options;

  const scope = assertOwner(owner, "the shell profile block");

  const block = [
    profileMarker(scope),
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
    profileEnd(scope),
  ].join("\n");

  const files = [".bashrc", ".profile"].map(name => join(home, name));
  const contents = files.map(file =>
    exists(file) ? String(read(file, "utf8")) : ""
  );

  // Every file is inspected BEFORE any is written. A shell profile is not a
  // namespaced resource — it exports into every shell on the machine, so if one
  // of the two belongs to another tenant the whole run must stop, not stop
  // halfway with `.bashrc` rewritten and `.profile` not.
  for (const [index, current] of contents.entries()) {
    assertShellUnclaimed(files[index], current, scope, claimShell);
  }

  const updated = [];
  for (const [index, file] of files.entries()) {
    const current = contents[index];
    // Ours, plus any legacy block this owner can prove is its own, plus — only
    // under an explicit claim — another tenant's. Stripping every family block
    // unconditionally is what let a second tenant delete the first's.
    const selects = block =>
      claimShell || [scope, null].includes(shellOwnerOf(block));
    const mine = familyBlocks(current, PROFILE_FAMILY).find(selects);
    const withoutOurs = stripFamilyBlocks(current, PROFILE_FAMILY, selects);
    const next =
      mine === undefined
        ? `${current}${current.endsWith("\n") || !current ? "" : "\n"}\n${block}\n`
        : `${withoutOurs.slice(0, mine.start)}${block}\n${withoutOurs
            .slice(mine.start)
            .replace(/^\n/, "")}`;

    if (next !== current) {
      write(file, next, { mode: 0o600 });
      updated.push(file);
    }
  }
  return updated;
}

/**
 * Who one shell block belongs to, marked or recoverable.
 *
 * A legacy `~/.aws` block carries no tell of who wrote it — bare stage names
 * name a stage and no owner — which is why those are attributed by account id
 * instead. A legacy SHELL block is different: its body sources
 * `<config root>/<tenant>/secrets.env`, so it states its own owner in the one
 * line that matters. Reading it back removes the ambiguity entirely, which is
 * better than a flag, and it lets an existing single-tenant machine upgrade in
 * one silent step rather than failing until an operator intervenes.
 *
 * `null` means unattributable, and that is treated as OURS to claim rather than
 * as a stranger's. Every block this module has ever written names a tenant
 * directory, so a block that names none is not a well-formed block of any
 * tenant — while leaving it behind would break the rule that matters most here:
 * an orphaned block in a shell profile is still sourced, and the last
 * assignment wins.
 * @param {{owner: string|null, body: string}} block One managed block.
 * @returns {string|null} The owner, or null when it cannot be attributed.
 */
function shellOwnerOf(block) {
  if (block.owner !== null) return block.owner;
  // The tenant directory is the segment before `secrets.env`; that path is the
  // only place a pre-ownership block records whose values it loads.
  const found = /[/\\]([^/\\]+)[/\\]secrets\.env/.exec(block.body);
  return found === null ? null : found[1];
}

/**
 * Stop before redirecting a machine that already serves another tenant.
 *
 * `~/.aws` profiles can be namespaced, so two tenants coexist there and a wrong
 * resolution becomes impossible. A shell profile cannot: it exports into every
 * shell and there is no name for a consumer to select, so it is a single slot
 * two projects contend for — the same problem `[default]` poses in
 * `~/.aws/config`, and it gets the same answer. Claimed when unowned or already
 * ours; otherwise the run stops and names the tenant that holds it.
 *
 * Taking it over silently is the whole defect in miniature: every shell on the
 * machine would start exporting another project's credentials, and the sessions
 * that lost their block would carry on believing they had their own.
 * @param {string} file The shell profile path, for the message.
 * @param {string} current File contents.
 * @param {string} scope Our owner.
 * @param {boolean} claimShell Whether the operator asked to take it over.
 */
function assertShellUnclaimed(file, current, scope, claimShell) {
  if (claimShell) return;
  const others = [
    ...new Set(
      familyBlocks(current, PROFILE_FAMILY)
        .map(shellOwnerOf)
        .filter(found => found !== null)
    ),
  ].filter(found => found !== scope);
  if (others.length === 0) return;
  throw new Error(
    `${file} already loads secrets for ${others.map(n => `"${n}"`).join(", ")}, ` +
      `not "${scope}".\n` +
      `A shell profile is read by every shell on this machine, so rewriting it ` +
      `would hand ${scope}'s credentials to that project's sessions too — and ` +
      `they would report ready, because the credentials work.\n` +
      `Re-run with LISA_SECRETS_CLAIM_SHELL_PROFILE=1 to switch this machine ` +
      `to "${scope}" deliberately. Nothing was changed.`
  );
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
 * Profile names already defined outside the block this owner is about to write.
 *
 * Only what lies outside OUR block counts: our own previous output is meant to
 * be replaced, and treating it as a collision would make the second run fail.
 * What changed is that "ours" is now scoped to one owner, so another project's
 * block reads as a collision instead of as our own output.
 *
 * Each hit reports who holds the name: `null` for a section an operator wrote
 * outside any managed block, or the owning project. The two need different
 * advice, and a message that guessed would send the reader to the wrong file.
 * @param {string} dir The `.aws` directory.
 * @param {string[]} names Profile names about to be written.
 * @param {object} io `exists`, `read`, `owner`, and `includeLegacy` seams.
 * @returns {Array<{name: string, owner: string|null}>} Collisions, in the order given.
 */
export function collidingProfiles(dir, names, io = {}) {
  const {
    exists = existsSync,
    read = readFileSync,
    owner = null,
    includeLegacy = false,
  } = io;
  const file = join(dir, "config");
  if (!exists(file)) return [];

  const text = String(read(file, "utf8"));
  // Our own previous output is meant to be replaced, so counting its profiles
  // as a collision would refuse to write the very names we wrote last time.
  // "Ours" now means this owner's — another project's block is exactly the case
  // that was being consumed silently — plus, unless the caller says otherwise,
  // pre-ownership blocks, which the caller is about to replace in place.
  const ours = block =>
    (block.owner === owner && owner !== null) ||
    (block.owner === null && !includeLegacy);
  const outside = stripFamilyBlocks(text, MANAGED_FAMILY, ours);

  const claimed = [];
  for (const block of familyBlocks(text, MANAGED_FAMILY)) {
    if (ours(block)) continue;
    for (const name of profileNamesIn(block.body)) {
      claimed.push({ name, owner: block.owner });
    }
  }

  return names
    .filter(name => sectionPresent(outside, name))
    .map(name => ({
      name,
      owner: claimed.find(entry => entry.name === name)?.owner ?? null,
    }));
}

/**
 * Whether a `[profile name]` section header appears in some text.
 * @param {string} text Haystack.
 * @param {string} name Exact profile name.
 * @returns {boolean} Whether the section is defined.
 */
function sectionPresent(text, name) {
  return new RegExp(
    `^\\s*\\[profile\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\]`,
    "m"
  ).test(text);
}

/**
 * The `[profile …]` names defined in a chunk of shared-config text.
 * @param {string} text Config text.
 * @returns {string[]} Section names, in order.
 */
function profileNamesIn(text) {
  return [...text.matchAll(/^\s*\[profile\s+([^\]\n]+)\]/gm)].map(found =>
    found[1].trim()
  );
}

/**
 * Profile names left in `~/.aws/config` by a build that predated ownership.
 *
 * Reported rather than removed, and that asymmetry with the shell block is the
 * point: a legacy `~/.aws` block carries no record of who wrote it. Its stage
 * names name a stage and no owner, and the account ids in its role ARNs are not
 * tied to any tenant name this process knows. Deleting it could therefore
 * remove another project's working profiles — the exact harm being fixed —
 * so it is named on every run and removed only under an explicit prune.
 * @param {string} dir The `.aws` directory.
 * @param {object} [io] `exists` and `read` seams.
 * @returns {string[]} Unowned profile names still present.
 */
export function legacyManagedProfiles(dir, io = {}) {
  const { exists = existsSync, read = readFileSync } = io;
  const file = join(dir, "config");
  if (!exists(file)) return [];

  const text = String(read(file, "utf8"));
  return familyBlocks(text, MANAGED_FAMILY)
    .filter(block => block.owner === null)
    .flatMap(block => profileNamesIn(block.body));
}

export function installAwsProfiles(bundle, options = {}) {
  const {
    home = process.env.HOME || homedir(),
    owner,
    pruneLegacy = process.env.LISA_SECRETS_PRUNE_LEGACY_PROFILES === "1",
    // The compatibility window, on by default and closable from both ends.
    // `NO_LEGACY` is how a caller that has migrated takes the isolation before
    // the window closes; `CLAIM_LEGACY` is how one takes the shared bare slot
    // from another project deliberately.
    noLegacy = process.env.LISA_SECRETS_NO_LEGACY_PROFILES === "1",
    claimLegacyNames = process.env.LISA_SECRETS_CLAIM_LEGACY_PROFILES === "1",
    mkdir = mkdirSync,
    write = writeAtomic,
    read = readFileSync,
    exists = existsSync,
    chmod = chmodSync,
  } = options;

  const rendered = renderAwsProfiles(bundle, owner);
  if (!rendered) return [];
  const scope = assertOwner(owner, "~/.aws");

  const dir = join(home, ".aws");

  // Whether a pre-ownership block in this file is THIS project's own past
  // output, or another project's.
  //
  // Leaving one behind is not free. Everywhere else in Lisa the orphan doctrine
  // is absolute — an orphaned block is still read, and the reader cannot tell it
  // from the live one — so a change that started leaving orphans would trade
  // this bug for the one the marker versioning already fixed.
  //
  // The block itself answers the question: the accounts in its role ARNs are
  // this project's if they are the accounts we are about to write. A bundle
  // names its own accounts, so a match is attribution rather than a guess. That
  // makes the ordinary single-tenant upgrade replace its block silently and
  // leave nothing behind, and confines the reported-not-deleted case to a block
  // that provably belongs to a different project.
  const configFile = join(dir, "config");
  const existingConfig = exists(configFile)
    ? String(read(configFile, "utf8"))
    : "";
  const claimLegacy =
    pruneLegacy || legacyIsOurs(existingConfig, rendered.config);

  // Refuse to write a profile name someone else already uses.
  //
  // AWS does not error on a duplicate `[profile x]` — it resolves one and
  // ignores the other. So writing a name next to an operator's existing SSO
  // profile of the same name would silently run some calls as the wrong
  // identity, which is worse than either winning outright. Merging protects
  // their sections from being deleted; this protects them from being shadowed.
  //
  // "Someone else" now includes another Lisa project. Prefixing every name with
  // its owner should make that impossible rather than merely detectable, so
  // this arm is the backstop for the case prefixing cannot prevent — two owners
  // whose prefix and stage happen to reduce to one final name.
  //
  // Deliberately not resolved by renaming theirs: this module writes its own
  // block and nothing else. The owner of the existing entry renames it
  // (conventionally to `-sso`) and re-runs.
  const collisions = collidingProfiles(dir, rendered.profiles, {
    exists,
    read,
    owner: scope,
    // A legacy block this run is about to replace is not a collision; one it is
    // leaving in place is, because both sections would then exist and AWS would
    // resolve exactly one of them.
    includeLegacy: !claimLegacy,
  });
  if (collisions.length > 0) {
    const quoted = collisions.map(c => `"${c.name}"`).join(", ");
    const holder = collisions[0].owner;
    throw new Error(
      holder === null
        ? `~/.aws/config already defines ${quoted} outside any lisa-managed ` +
            `block.\n` +
            `Writing them would create duplicate sections, and AWS resolves ` +
            `only one — some calls would silently use the wrong identity.\n` +
            `Rename the existing entries (for example to ` +
            `"${collisions[0].name}-sso") and run this again.`
        : `~/.aws/config already defines ${quoted} for the Lisa project ` +
            `"${holder}", not "${scope}".\n` +
            `AWS resolves only one section of a duplicated name, so writing ` +
            `these would silently point "${holder}" at ${scope}'s account — ` +
            `and it would authenticate, because the credentials are real.\n` +
            `Rename one project's namespace so the two do not reduce to the ` +
            `same profile name. Nothing was changed.`
    );
  }

  // Whether the deprecated bare-named twins go in beside the owned names.
  //
  // ALL OR NOTHING. A half-written legacy family is worse than none: a bare
  // `[profile <stage>]` whose `source_profile` names a bare section belonging to
  // someone else is a profile that resolves into another project's account, and
  // it is exactly the failure the owned names exist to remove.
  const legacyHolder = noLegacy
    ? null
    : compatHolder(dir, rendered.compat, {
        exists,
        read,
        owner: scope,
        includeLegacy: !claimLegacy,
      });
  // `undefined` is the only free state. `null` means a section outside every
  // managed block already holds the name — an operator's, or an external
  // generator's — and shadowing that is the duplicate-section failure this
  // module refuses everywhere else.
  const writeCompat =
    !noLegacy && (claimLegacyNames || legacyHolder === undefined);

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
  for (const [name, body, compatBody] of [
    ["credentials", rendered.credentials, rendered.compat.credentials],
    ["config", rendered.config, rendered.compat.config],
  ]) {
    const file = join(dir, name);
    const current = exists(file) ? String(read(file, "utf8")) : "";
    // Both halves live INSIDE this owner's block. That is what keeps the
    // compatibility names owned rather than anonymous — another project's run
    // leaves them alone instead of replacing them, and this project's next run
    // regenerates the whole block, so nothing accumulates or drifts.
    const merged = writeCompat ? `${body.trimEnd()}\n\n${compatBody}` : body;
    write(file, upsertManagedBlock(current, merged, scope, claimLegacy));
  }

  return rendered.profiles;
}

/**
 * Who already holds any part of the deprecated bare-named family.
 *
 * Both files are consulted, because the family only works whole: the bare
 * `[profile <stage>]` sections in `config` are useless without the bare source
 * profile in `credentials` that they assume from.
 * @param {string} dir The `.aws` directory.
 * @param {{profiles: string[], sourceProfile: string}} compat The bare half.
 * @param {object} io `exists`, `read`, `owner`, `includeLegacy` seams.
 * @returns {string|null|undefined} The holding project, `null` when held
 *   outside any managed block, or `undefined` when nobody holds it.
 */
function compatHolder(dir, compat, io) {
  const inConfig = collidingProfiles(dir, compat.profiles, io);
  if (inConfig.length > 0) return inConfig[0].owner;
  return sourceProfileHolder(dir, compat.sourceProfile, io);
}

/**
 * Who holds a bare source-profile section in `~/.aws/credentials`.
 *
 * Separate from `collidingProfiles` because a credentials section is spelled
 * `[name]`, not `[profile name]`, and reusing the config reader here would
 * silently match nothing — a guard that always passes.
 * @param {string} dir The `.aws` directory.
 * @param {string} name The section name.
 * @param {object} io `exists`, `read`, `owner`, `includeLegacy` seams.
 * @returns {string|null|undefined} As {@link compatHolder}.
 */
export function sourceProfileHolder(dir, name, io = {}) {
  const {
    exists = existsSync,
    read = readFileSync,
    owner = null,
    includeLegacy = false,
  } = io;
  const file = join(dir, "credentials");
  if (!exists(file)) return undefined;

  const text = String(read(file, "utf8"));
  const ours = block =>
    (block.owner === owner && owner !== null) ||
    (block.owner === null && !includeLegacy);
  const header = new RegExp(
    `^\\s*\\[${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\]`,
    "m"
  );

  for (const block of familyBlocks(text, MANAGED_FAMILY)) {
    if (ours(block)) continue;
    if (header.test(block.body)) return block.owner;
  }
  // Outside every managed block: an operator's own section, or one written by a
  // generator that does not go through this module at all.
  return header.test(stripFamilyBlocks(text, MANAGED_FAMILY, () => true))
    ? null
    : undefined;
}

/**
 * The 12-digit accounts named by the role ARNs in some shared-config text.
 * @param {string} text Config text.
 * @returns {Set<string>} Account ids.
 */
function accountsIn(text) {
  return new Set(
    [...text.matchAll(/^\s*role_arn\s*=\s*arn:[^:]*:iam::(\d+):/gm)].map(
      found => found[1]
    )
  );
}

/**
 * Whether every pre-ownership block present is this project's own past output.
 *
 * Conservative on purpose. A legacy block with no role ARN at all cannot be
 * attributed, so it is not claimed; and one account belonging to someone else is
 * enough to leave the whole population alone, because a partial claim would
 * delete a block this process could not read the ownership of.
 * @param {string} current Existing config contents.
 * @param {string} ours The config body about to be written.
 * @returns {boolean} Whether the legacy blocks may be replaced.
 */
function legacyIsOurs(current, ours) {
  const legacy = familyBlocks(current, MANAGED_FAMILY).filter(
    block => block.owner === null
  );
  if (legacy.length === 0) return false;

  const mine = accountsIn(ours);
  return legacy.every(block => {
    const theirs = accountsIn(block.body);
    return theirs.size > 0 && [...theirs].every(account => mine.has(account));
  });
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
  // The namespace IS the owner. It already scopes `~/.config/<namespace>`, so
  // two repositories of one tenant share and two tenants do not — exactly the
  // sharing model the shared write paths below were missing.
  const owner = assertOwner(cfg.namespace, "the materialized credentials");

  const derived = deriveAwsEnvironment(selected, owner);
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
  const sourced = installProfileSourcing(valuesFile, { owner });

  // The environments live in separate AWS accounts, reached by assuming a role
  // per environment. Without these files `--profile <owner>-agent-dev` fails
  // with "profile not found" and everything silently falls back to the
  // bootstrap identity, which can assume roles and do nothing else.
  const profiles = installAwsProfiles(
    parseBootstrap(selected.get(BOOTSTRAP_KEY)?.value),
    { owner }
  );

  return {
    count: selected.size,
    derived: derived.size,
    dir,
    sourced,
    profiles,
    legacy: legacyManagedProfiles(join(process.env.HOME || homedir(), ".aws")),
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
    const owner = assertOwner(cfg.namespace, "~/.aws");
    const written = installAwsProfiles(bundle, { owner });

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
        `  sections were preserved — only "${owner}"'s block was replaced.\n` +
        `  Use them explicitly: aws --profile ${written[0]} ...`
    );
    reportLegacyProfiles();
    reportCompatSlot(cfg.namespace);
    return;
  }

  if (process.argv.includes("--dry-run")) {
    const selected = fetchAll(cfg);
    // Derive here too, or the preview lies in the one place it matters most:
    // the derived names are exactly the ones that override ambient host
    // credentials, so omitting them hides the most surprising effect of the run
    // and reports a smaller count than the real write produces.
    for (const [name, entry] of deriveAwsEnvironment(
      selected,
      assertOwner(cfg.namespace, "the materialized credentials")
    )) {
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
  reportLegacyProfiles();
  reportCompatSlot(cfg.namespace);
}

/**
 * Say so when the deprecated bare names went to a different project.
 *
 * Silence here would be the worst of both worlds. A caller that has not
 * migrated still names the bare profiles; if another project on this machine
 * holds them, those names resolve into that project's account and the run would
 * otherwise report success. Loud-and-wrong is recoverable, silent-and-wrong is
 * the defect this whole change is about.
 * @param {string} owner The tenant this run materialized for.
 */
function reportCompatSlot(owner) {
  const holder = sourceProfileHolder(
    join(process.env.HOME || homedir(), ".aws"),
    LEGACY_SOURCE_PROFILE,
    { owner }
  );
  if (holder === undefined || holder === owner) return;
  console.log(
    `  The deprecated bare profile names were NOT written for "${owner}".\n` +
      `  ${holder === null ? "A section outside any lisa-managed block" : `The project "${holder}"`} ` +
      `already holds "${LEGACY_SOURCE_PROFILE}".\n` +
      `  They are one shared slot, so only one project on a machine can have ` +
      `them.\n  Use the owned names — aws --profile ${owner}-<stage> — or ` +
      `re-run with\n  LISA_SECRETS_CLAIM_LEGACY_PROFILES=1 to take the bare ` +
      `names deliberately.`
  );
}

/**
 * Name any pre-ownership profiles still sitting in `~/.aws/config`.
 *
 * Reported on every run rather than once, because the population never drains
 * on its own and nothing else ever revisits this file — there is no apply, diff
 * or review that would surface it. Never deleted here: an unowned profile may
 * belong to another project on this machine, and removing it would be the same
 * silent consumption in the other direction.
 */
function reportLegacyProfiles() {
  const stale = legacyManagedProfiles(
    join(process.env.HOME || homedir(), ".aws")
  );
  if (stale.length === 0) return;
  console.log(
    `  ~/.aws/config still holds ${stale.length} profile(s) written before ` +
      `Lisa\n  recorded which project a profile belongs to: ` +
      `${stale.join(", ")}.\n` +
      `  They name a stage but no owner, so on a machine serving more than one ` +
      `\n  project they can resolve to another project's account. Review them, ` +
      `or\n  re-run with LISA_SECRETS_PRUNE_LEGACY_PROFILES=1 to remove them.`
  );
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

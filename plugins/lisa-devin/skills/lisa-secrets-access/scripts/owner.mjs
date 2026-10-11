/**
 * Which project a credential written to this machine belongs to.
 *
 * Everything this skill writes outside `~/.config/<namespace>` lands in a
 * SHARED per-user location: `~/.aws/config`, `~/.aws/credentials`, `~/.bashrc`,
 * `~/.profile`. Those paths have no tenant in them, so two Lisa projects on one
 * workstation wrote the same identifiers and the second silently replaced the
 * first. Measured with two synthetic bundles declaring the same stage names:
 * two profiles survived where four were written, the surviving `agent-dev`
 * named the second tenant's account, and every shell on the machine sourced the
 * second tenant's values — including the first tenant's sessions. Both runs
 * exited 0.
 *
 * Nothing about the surviving profile is wrong. It is a real, working profile
 * that belongs to someone else, which is why no property check on the profile
 * detects it — only a comparison against the intended owner fires. So the owner
 * has to be carried to the write point rather than inferred there.
 *
 * The owner is the **tenant namespace**, not the repository. That is deliberate
 * and it is the existing model, not a new one: `~/.config/<namespace>` is
 * already the unit of sharing, so two repositories of one tenant SHOULD see the
 * same credentials and two tenants must not. A namespace is also already
 * resolved and validated by the time any writer runs, so nothing has to be
 * guessed at the point of writing.
 *
 * Its own module because both writers need it and neither should import the
 * other: `aws-bootstrap` renders profile names, `materialize-secrets` writes
 * the shell block, and this file imports nothing.
 * @module owner
 */

/**
 * The one shape an owner may take.
 *
 * Identical to the namespace rule in `surfaces.mjs`, because it IS the
 * namespace — the same value, re-checked where it is about to become part of an
 * ini section header and a shell filename. Anything with a bracket, newline, or
 * path separator would either corrupt `~/.aws/config` or redirect a write.
 */
const OWNER_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Require an owner, and refuse to write anything without one.
 *
 * Failing closed is the whole point. A writer that fell back to an unowned name
 * when resolution came up empty would recreate the exact collision this exists
 * to remove, and it would do it on the machines least able to notice — the ones
 * where nobody declared a tenant.
 * @param {unknown} owner Candidate owner.
 * @param {string} what What is about to be written, for the message.
 * @returns {string} The owner, trimmed, when usable.
 */
export function assertOwner(owner, what) {
  const trimmed = typeof owner === "string" ? owner.trim() : "";
  if (!trimmed) {
    throw new Error(
      `cannot determine which project these credentials belong to, so ` +
        `${what} was not written.\n` +
        `Name the tenant explicitly — 'lisa environment local --tenant=<name>' ` +
        `— or set "secrets".namespace in .lisa.config.json.\n` +
        `Unowned names collide across projects on a shared machine, and the ` +
        `collision is silent: the surviving credential is valid, it just ` +
        `belongs to someone else.`
    );
  }
  if (!OWNER_SHAPE.test(trimmed) || trimmed === "..") {
    throw new Error(
      `owner "${trimmed}" is not one safe name segment, so ${what} was not ` +
        `written. Use letters, digits, dot, dash or underscore.`
    );
  }
  return trimmed;
}

/**
 * The marker fragment that records who owns a managed block.
 *
 * Written inside the existing marker text rather than as a new marker, so the
 * family recognisers keep matching blocks from every past version. A block with
 * no `owner=` predates ownership and is handled as legacy, never as ours.
 * @param {string} owner Validated owner.
 * @returns {string} The fragment to embed in a marker.
 */
export function ownerTag(owner) {
  return `owner=${owner}`;
}

/**
 * Read the owner out of one marker line.
 * @param {string} marker The matched marker text.
 * @returns {string|null} The owner, or null when the block predates ownership.
 */
export function ownerOf(marker) {
  const found = /\bowner=([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(marker);
  return found === null ? null : found[1];
}

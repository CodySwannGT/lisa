/**
 * Vitest Configuration - TMPDIR ancestor-chain trust (refusal)
 *
 * A test run under a `TMPDIR` whose ancestor chain is untrusted produces four
 * failing assertions about enforcement rate-limiting and says nothing about the
 * environment that caused them. Nobody's first hypothesis is "my temp
 * directory's ancestor has the wrong mode bits", so the failure reads as a
 * defect in the rate limiter — measured at four separate investigations, two of
 * which escalated claiming `main` was red (CodySwannGT/lisa#3691).
 *
 * The mechanism is `scripts/lisa-enforcement-fallback.sh`, which walks every
 * ancestor of the resolved `TMPDIR` before it writes its once-per-session
 * marker. When a rung fails the walk the marker is never created, the rate
 * limit stands down, and the notice speaks on every call. THAT STAND-DOWN IS
 * CORRECT — the guard is designed to fail open rather than write into an
 * untrusted state directory, and it should keep doing that. What was missing is
 * anything telling the operator why, which is what this module supplies.
 *
 * The verdict is deliberately a REFUSAL rather than a warning, and it is wired
 * into `globalSetup` rather than `setupFiles` for a measured reason: a throw
 * from a `setupFiles` module fails collection, so the suite reports zero tests
 * and the gate goes red having evaluated nothing — a result that looks like a
 * verdict and is not one. Installing that failure to fix a failure that names
 * nothing would reproduce the defect one level up. `scratch-global-setup`
 * already refuses from `setup`, where vitest honours the throw and exits 1.
 *
 * The predicate below is a second expression of the shell's arithmetic, which
 * is a real risk: two copies can drift, and the copy that decides behaviour is
 * the shell's. That risk is priced by a case in
 * `tests/unit/config/scratch-tmpdir-trust.test.ts` asserting the two agree on a
 * table of representative roots, real directories rather than fabricated modes.
 * Sharing the shell predicate directly was rejected: that script is the
 * PreToolUse dispatcher that runs on EVERY tool call and consumes stdin, so a
 * probe mode would put a test-serving branch on the hottest path in the repo.
 * @see {@link module:configs/vitest/scratch-global-setup} for the refusal path
 * @module configs/vitest/scratch-tmpdir-trust
 */
import { realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { getuid, platform } from "node:process";

/** Permission, setuid/setgid and sticky bits of `st_mode`. */
const PERMISSION_BITS = 0o7777;

/** Write access granted to group or to other. */
const SHARED_WRITE_BITS = 0o022;

/**
 * The sticky bit.
 *
 * It is what makes a shared, world-writable temp root safe to hold per-user
 * state: another uid can still CREATE a name there, but cannot unlink or rename
 * one that is not theirs. That is the whole basis on which `/tmp` is trusted.
 */
const STICKY_BIT = 0o1000;

/** The rung of the chain that failed the trust test, and why it failed. */
export interface UntrustedAncestor {
  /** Absolute path of the rejected directory. */
  readonly directory: string;
  /** Owning uid, as reported by `stat`. */
  readonly uid: number;
  /** Permission, setuid/setgid and sticky bits. */
  readonly mode: number;
  /** Operator-readable statement of which property failed. */
  readonly reason: string;
}

/**
 * Render a mode the way `ls` and `chmod` spell it, so it can be compared.
 * @param mode - Permission bits
 * @returns Four-digit octal string
 */
export const octalMode = (mode: number): string =>
  mode.toString(8).padStart(4, "0");

/**
 * Every ancestor of an absolute path, root first and the path itself last.
 * @param target - Absolute, symlink-resolved path
 * @returns The chain to walk, in the order the shell walks it
 */
export const ancestorChain = (target: string): readonly string[] =>
  target
    .split(path.sep)
    .filter(segment => segment !== "")
    .reduce<readonly string[]>(
      (chain, segment) => [
        ...chain,
        path.join(chain[chain.length - 1] ?? path.sep, segment),
      ],
      [path.sep]
    );

/**
 * Why one directory is untrusted, or `undefined` when it is trusted.
 *
 * Ownership is checked as "root or me" rather than "mine". A valid chain is
 * MOSTLY root-owned — on macOS four of the six rungs above the per-user temp
 * root are uid 0 — so a check written as "is this mine?" would reject every
 * valid root on the machine. The discriminating property is the MODE.
 * @param uid - Owning uid of the directory
 * @param mode - Its permission, setuid/setgid and sticky bits
 * @param self - The current uid
 * @returns The failing property, or undefined
 */
const untrustReason = (
  uid: number,
  mode: number,
  self: number
): string | undefined => {
  if (uid !== 0 && uid !== self) {
    return (
      `owned by uid ${String(uid)}, which is neither root nor you ` +
      `(uid ${String(self)}), so its owner can replace it underneath you`
    );
  }
  if ((mode & SHARED_WRITE_BITS) !== 0 && (mode & STICKY_BIT) === 0) {
    return (
      `mode ${octalMode(mode)} grants write access to group or other ` +
      `WITHOUT the sticky bit, so any user can replace entries in it`
    );
  }
  return undefined;
};

/**
 * The first rung of a chain that fails the trust test.
 *
 * A rung that cannot be inspected at all counts as untrusted, matching the
 * shell, whose `stat` failure returns the same verdict as a bad mode.
 * @param target - Absolute, symlink-resolved path to walk
 * @param self - The current uid
 * @returns The first failing rung, or undefined when every rung passes
 */
const firstUntrustedRung = (
  target: string,
  self: number
): UntrustedAncestor | undefined =>
  ancestorChain(target).reduce<UntrustedAncestor | undefined>(
    (found, directory) => {
      if (found !== undefined) return found;
      try {
        const stat = statSync(directory);
        const mode = stat.mode & PERMISSION_BITS;
        const reason = untrustReason(stat.uid, mode, self);
        return reason === undefined
          ? undefined
          : { directory, uid: stat.uid, mode, reason };
      } catch (error) {
        return {
          directory,
          uid: -1,
          mode: 0,
          reason: `could not be inspected: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    },
    undefined
  );

/**
 * The first untrusted ancestor of a path, if any.
 *
 * Platforms without uid ownership have nothing to check and are never refused.
 * @param target - Absolute, symlink-resolved path to walk
 * @returns The first failing rung, or undefined
 */
export const findUntrustedAncestor = (
  target: string
): UntrustedAncestor | undefined => {
  const self = getuid?.();

  return self === undefined ? undefined : firstUntrustedRung(target, self);
};

/**
 * The remedy lines, spelled for the platform the operator is actually on.
 *
 * A remedy that cannot be followed is worse than none: it reads as the guard
 * being wrong rather than the environment being wrong, and the available move
 * then is to route around the guard.
 * @returns Shell lines that produce a trusted TMPDIR
 */
const remedyLines = (): readonly string[] =>
  platform === "darwin"
    ? [
        '  root="$(getconf DARWIN_USER_TEMP_DIR)"',
        '  mkdir -p "${root}lisa" && export TMPDIR="${root}lisa"',
      ]
    : [
        '  root="${XDG_RUNTIME_DIR:-/tmp}/lisa-$(id -u)"',
        '  mkdir -p "$root" && export TMPDIR="$root"',
      ];

/**
 * The refusal text: what was rejected, which rung rejected it, and the fix.
 * @param resolved - The symlink-resolved TMPDIR that was walked
 * @param ancestor - The rung that failed
 * @returns Operator-readable failure text
 */
export const describeUntrustedTmpdir = (
  resolved: string,
  ancestor: UntrustedAncestor
): string =>
  [
    "Lisa test scratch requires a TMPDIR whose ancestor chain is trusted.",
    "",
    `  TMPDIR resolves to  ${resolved}`,
    `  rejected at         ${ancestor.directory}`,
    `                      uid ${String(ancestor.uid)}, mode ${octalMode(
      ancestor.mode
    )}`,
    `                      ${ancestor.reason}`,
    "",
    "A directory is trusted when it is owned by root or by you AND is not",
    "group- or world-writable unless it carries the sticky bit.",
    "",
    "This is the same chain scripts/lisa-enforcement-fallback.sh walks before",
    "it writes per-session state. A TMPDIR refused here would silently stand",
    "that rate limit down instead, which surfaces as four assertion failures",
    "in tests/unit/hooks/enforcement-fallback-notice-rate.test.ts that read as",
    "defects in the rate limiter and say nothing about your environment. That",
    "is the failure this refusal replaces (CodySwannGT/lisa#3691).",
    "",
    "Point TMPDIR at a directory of your own instead:",
    ...remedyLines(),
  ].join("\n");

/**
 * Why this run's TMPDIR must be refused, or `undefined` when it is trusted.
 *
 * Read through `realpathSync` because the shell resolves with `cd -P` before it
 * walks: the chain that matters is the physical one, and a symlinked TMPDIR
 * whose logical spelling looks fine can resolve onto a rung that is not.
 * @returns Refusal text, or undefined when the chain is trusted
 */
export const describeTmpdirTrustFailure = (): string | undefined => {
  const resolved = realpathSync(tmpdir());
  const ancestor = findUntrustedAncestor(resolved);

  return ancestor === undefined
    ? undefined
    : describeUntrustedTmpdir(resolved, ancestor);
};

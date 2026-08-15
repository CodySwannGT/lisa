// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * invoked-as-script — the one implementation of "was this module run as the CLI
 * entry point?", shared by every guarded `.mjs` entry point Lisa ships.
 *
 * @remarks
 * ## Why this is shared rather than copied
 *
 * The obvious spelling is `import.meta.url === pathToFileURL(process.argv[1]).href`,
 * and it is wrong in a way that cannot be seen in review. `import.meta.url` is
 * normally the REAL path — node resolves ESM through `realpath` unless
 * `--preserve-symlinks` or `--preserve-symlinks-main` is set — while `argv[1]`
 * is whatever spelling the caller typed. Naming only the first of those two
 * flags is what let a second instance of this very defect survive review here:
 * `--preserve-symlinks-main` is a SEPARATE flag that applies to the entry
 * module specifically, which is exactly the module this guard runs in, so it is
 * the one that matters most and the one easiest to leave out. See the section
 * on realpathing both sides below.
 * Reached through a symlinked checkout, a symlinked bin shim, or a
 * `/tmp` path on macOS (`/tmp` is itself a symlink to `/private/tmp`), the two
 * differ, the guard is false, `main()` never runs, and the process exits 0
 * having done nothing.
 *
 * That failure mode is not symmetric. A no-op GENERATOR usually fails closed —
 * whatever consumes its output notices the missing artifact. A no-op CHECK
 * fails **OPEN**: it prints nothing, exits 0, and the npm script "succeeds", so
 * a gate that is meant to block a merge silently stops having an opinion. Every
 * `check-*.mjs` in this tree is in the second category, and git worktrees —
 * which every Lisa-driven agent uses — put a symlinked path on that code path
 * as a matter of routine.
 *
 * ## `moduleUrl` is REQUIRED, and is the FIRST parameter
 *
 * A deliberate deviation from the obvious signature
 * `invokedAsScript(argv1 = process.argv[1], moduleUrl = import.meta.url)`. A
 * defaulted `import.meta.url` inside a SHARED module resolves to *this* file,
 * which is never anybody's `process.argv[1]` — so a caller that forgot the
 * second argument would get `false` forever and no-op silently. That is exactly
 * the fail-open defect this module exists to remove, re-introduced by its own
 * convenience default. Making it required and first means a call site cannot be
 * written wrong.
 *
 * ## Why ANY resolution error returns false
 *
 * `realpathSync` throws ENOENT, EACCES, ELOOP and ENOTDIR, not just ENOENT. A
 * fallback that narrows to ENOENT and then compares `resolve(argv1)` reinstates
 * the un-normalized comparison the realpath exists to avoid, so the symlink
 * defect survives on precisely the path meant to be the safety net.
 *
 * Returning `false` on an unresolvable `argv[1]` is sound rather than merely
 * convenient: node resolved and LOADED the entry point from that path moments
 * earlier, so a path that cannot be resolved now is not the path this module
 * was loaded through. Comparing an unnormalized spelling instead would answer
 * "maybe" with a confident "yes".
 *
 * ## Why BOTH sides are realpath'd, not just `argv[1]`
 *
 * "`import.meta.url` is always the real path" is true by default and false under
 * `--preserve-symlinks-main`, which tells node not to resolve the main entry.
 * Normalizing only `argv[1]` then compares a real path against a symlinked one
 * and answers `false` for an entry point that WAS invoked directly — the same
 * fail-open this module exists to remove, reappearing on the flag that most
 * looks like it should not matter. Measured: a symlinked entry point reports
 * `true` normally and `false` under the flag.
 *
 * Realpathing both sides is free in the ordinary case, where `moduleUrl` is
 * already canonical and `realpathSync` is the identity.
 *
 * @module scripts/lib/invoked-as-script
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * True when `moduleUrl` names the module node was asked to run.
 *
 * Both sides are realpath'd before comparison — see the module remarks for why a
 * raw comparison silently answers "no" under a symlinked path, and why
 * normalizing only `argv[1]` leaves the same hole open under
 * `--preserve-symlinks-main`.
 * @param {string} moduleUrl - The caller's own `import.meta.url`.
 * @param {string | undefined} [argv1] - Entry path; defaults to `process.argv[1]`.
 * @returns {boolean} Whether the caller should run its CLI body.
 */
export function invokedAsScript(moduleUrl, argv1 = process.argv[1]) {
  // `node -e`, `node --eval`, `node --print` and the REPL leave `argv[1]`
  // undefined. Nothing was asked to run, so nothing should.
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

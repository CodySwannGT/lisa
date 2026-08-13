/**
 * Which managed files Lisa owns outright, as opposed to files a host project
 * shares with Lisa and legitimately customises.
 *
 * The two populations sit side by side in the `copy-overwrite` trees and want
 * opposite defaults. `tsconfig.json`, `knip.json`, and `eslint.config.ts` are
 * seeded by Lisa and then edited downstream, so a non-interactive apply must
 * never replace them without being asked. `scripts/lisa-hooks/*` and
 * `scripts/lisa-enforcement-fallback.sh` are the enforcement itself — their
 * content *is* the guard — and nobody edits them downstream. Treating those two
 * populations the same is what made a released security fix undeliverable: the
 * fail-open fixes in #2374 sat in the package while installed repos kept running
 * the vulnerable guard, until someone deleted the files by hand so the create
 * path would recreate them.
 *
 * The marker is the `lisa-` namespace in the path. Lisa names everything it owns
 * outright that way — `lisa-hooks/`, `lisa-enforcement-fallback.sh`,
 * `lisa-work-item.mjs`, `lisa-command-envelope.mjs` — and its own skills and
 * hooks invoke those by exact path, which is precisely why a host cannot
 * meaningfully fork one in place. Nothing a project customises carries the
 * namespace.
 *
 * A project that genuinely wants to hold its own version of one of these still
 * can: `.lisaignore` is filtered before any strategy runs, and an ignored path
 * is never a candidate here.
 * @module core/lisa-owned-templates
 */

/** Path-segment namespace Lisa reserves for artifacts it owns outright. */
const LISA_NAMESPACE_PREFIX = "lisa-";

/**
 * Whether a managed file is Lisa's own artifact rather than shared host content.
 * @param relativePath - Repo-relative destination path of the managed file
 * @returns True when Lisa owns the file outright and may refresh it unprompted
 */
export function isLisaOwnedTemplate(relativePath: string): boolean {
  return relativePath
    .replaceAll("\\", "/")
    .split("/")
    .some(segment => segment.startsWith(LISA_NAMESPACE_PREFIX));
}

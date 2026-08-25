import { readdir } from "node:fs/promises";
import * as path from "node:path";
import { WORKTREE_ROOTS } from "../configs/worktrees.js";
import type { DoctorCheck } from "./doctor.js";

const WORKTREE_HYGIENE_CHECK_NAME = "Agent worktree hygiene?";

/**
 * Worktree count above which doctor warns.
 *
 * Not derived from a failure rate — the measurements in CodySwannGT/lisa#2490
 * varied worktree count and machine load together (27 worktrees at load ~50,
 * 38 at load ~115), so they cannot isolate a count at which suites start
 * failing. The threshold is grounded in the one quantity that IS deterministic:
 * crawl amplification. Each worktree is a full checkout, so every tool that
 * globs from the repo root sees the project's own source multiplied by the
 * worktree count. Measured in this repo at 20 worktrees: 14,389 `.ts` files
 * under `.claude/worktrees` against 1,023 in the project itself — 14x. Ten is
 * the point past which the accumulated checkouts dominate the tree by an order
 * of magnitude, which is early enough to act on and late enough that ordinary
 * parallel work does not trip it.
 */
export const WORKTREE_COUNT_WARN_THRESHOLD = 10;

/** Per-root inspection outcome. */
interface RootInspection {
  readonly count: number;
  readonly uninspectable?: string;
}

/**
 * Report how many agent worktrees have accumulated under this checkout.
 *
 * Agent worktrees are the root enabler behind the environmental unit-suite
 * failures in CodySwannGT/lisa#2490: they are never garbage-collected, each one
 * is a full checkout, and the resulting tree is what every crawler in the repo
 * has to walk past. The same cause is documented downstream three separate ways
 * in `acmeorga/frontend` (watchman crawl cost, jest's find-crawler overflowing
 * V8's max string length, an unanchored Metro blockList pattern) — all of which
 * only appeared once enough worktrees had piled up.
 *
 * Read-only and warn-only by design. Doctor reports the count and names the
 * repair; it never removes a worktree itself. What it names is now a verb
 * rather than a manual procedure: reporting a mess an agent has no sanctioned
 * way to clear is the state that produced the accumulation in the first place
 * (CodySwannGT/lisa#2993), so the repair line points at `lisa worktree prune`,
 * which answers "does this idle-looking checkout still hold work?" itself.
 *
 * Running from INSIDE a worktree naturally reports clean: the roots live in the
 * primary checkout, so a worktree has none of its own. That matches how
 * `isInsideWorktree` conditions the vitest and jest exclusions.
 * @param targetPath - Project path to inspect
 * @returns Doctor check result
 */
export async function checkWorktreeHygiene(
  targetPath: string
): Promise<DoctorCheck> {
  const inspections = await Promise.all(
    WORKTREE_ROOTS.map(root => inspectRoot(targetPath, root))
  );

  const total = inspections.reduce(
    (sum, inspection) => sum + inspection.count,
    0
  );
  const uninspectable = inspections.flatMap(inspection =>
    inspection.uninspectable === undefined ? [] : [inspection.uninspectable]
  );

  if (uninspectable.length > 0) {
    return {
      name: WORKTREE_HYGIENE_CHECK_NAME,
      status: "warn",
      detail:
        `Could not inspect worktree root(s): ${uninspectable.join(", ")}. ` +
        `Counted ${total} agent worktrees in the roots that were readable`,
    };
  }

  if (total === 0) {
    return {
      name: WORKTREE_HYGIENE_CHECK_NAME,
      status: "ok",
      detail: `No agent worktrees under ${WORKTREE_ROOTS.join(" or ")}`,
    };
  }

  if (total <= WORKTREE_COUNT_WARN_THRESHOLD) {
    return {
      name: WORKTREE_HYGIENE_CHECK_NAME,
      status: "ok",
      detail: `${describeCount(total)} under ${WORKTREE_ROOTS.join(
        " and "
      )} (threshold ${WORKTREE_COUNT_WARN_THRESHOLD})`,
    };
  }

  return {
    name: WORKTREE_HYGIENE_CHECK_NAME,
    status: "warn",
    detail:
      `${describeCount(total)} under ${WORKTREE_ROOTS.join(" and ")}, ` +
      `over the threshold of ${WORKTREE_COUNT_WARN_THRESHOLD}. ` +
      "Each one is a full checkout that every file crawler walks past, which is " +
      "what makes unit suites time out from ambient load rather than defects. " +
      "Run `lisa worktree prune` to see which of them are provably nobody's " +
      "live work: it reports by default and removes only with `--apply`, and " +
      "it refuses any worktree a process is working inside, or that holds " +
      "unpushed commits or uncommitted changes (CodySwannGT/lisa#2993). " +
      "Underneath it uses the plain `git worktree remove`, which refuses a " +
      "dirty tree, and `git worktree prune` for registrations whose directory " +
      "is already gone (CodySwannGT/lisa#2490)",
  };
}

/**
 * Count worktree directories under one repo-relative root.
 * @param targetPath - Project path to inspect
 * @param root - Repo-relative worktree root
 * @returns Count for the root, or the root name when it could not be read
 */
async function inspectRoot(
  targetPath: string,
  root: string
): Promise<RootInspection> {
  try {
    const entries = await readdir(path.join(targetPath, root), {
      withFileTypes: true,
    });
    return {
      count: entries.filter(entry => entry.isDirectory()).length,
    };
  } catch (error) {
    // A missing root is the normal case — most checkouts have neither, and a
    // worktree checkout has neither of its own. Anything else (a file where the
    // directory belongs, a permissions failure) is reported rather than counted
    // as clean, so the check never reports hygiene it did not verify.
    return isMissing(error) ? { count: 0 } : { count: 0, uninspectable: root };
  }
}

/**
 * Report whether a readdir failure means the path simply does not exist.
 * @param error - Error thrown by readdir
 * @returns True when the root is absent
 */
function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

/**
 * Render a worktree count with correct pluralization.
 * @param total - Number of worktrees counted
 * @returns Human-readable count phrase
 */
function describeCount(total: number): string {
  return `${total} agent worktree${total === 1 ? "" : "s"}`;
}

/**
 * What the in-memory platform shows as reported on a commit
 * (CodySwannGT/lisa#4993).
 *
 * `lisa controls protect` only requires a check once the platform shows a
 * result under its name: on the head of the protected branch, or on the head
 * of a recent pull request into it. This is the stand-in for those reads —
 * a commit's check runs, its commit statuses, and the list of recent pull
 * requests. It holds no state and answers reads only.
 * @module tests/unit/controls/support/fake-github-reports
 */

/** The checks every protect fixture derives, reported unless a case says otherwise. */
export const FIXTURE_CHECKS: readonly string[] = [
  "🔍 Quality Checks / 🧹 Lint",
  "🔍 Quality Checks / 🧪 Run Unit Tests",
  "🔍 Quality Checks / 🔒 Security Scan",
  "Review Bot",
];

/** What the platform shows as reported. */
export interface ReportedOptions {
  /**
   * Check-run names on the head of the default branch. Every fixture check
   * by default, so a case about anything else need not say.
   */
  readonly reported?: readonly string[];
  /** Commit status names on the head of the default branch. */
  readonly reportedStatuses?: readonly string[];
  /** Check-run names on the head of each recent pull request, newest first. */
  readonly pulls?: readonly (readonly string[])[];
  /** Make every one of these reads fail with this text. */
  readonly reportFailure?: string;
  /** Say that a commit has this many check runs, however many are listed. */
  readonly checkRunTotal?: number;
}

/** The answer to one read, before it is put in `gh`'s shape. */
export type ReportedAnswer =
  | { readonly kind: "document"; readonly value: unknown }
  | { readonly kind: "refusal"; readonly message: string };

/**
 * The commit id the stand-in gives the head of a recent pull request.
 * @param index - The pull request's position, newest first
 * @returns A commit id
 */
function pullHead(index: number): string {
  return `${String(index + 1).padStart(2, "0")}c0ffee`.padEnd(40, "0");
}

/**
 * The check-run names shown on one commit reference.
 * @param options - What the platform shows
 * @param branch - The default branch
 * @param ref - The reference as the path names it
 * @returns The names, or `undefined` for a reference that does not exist
 */
function checkRunsOn(
  options: ReportedOptions,
  branch: string,
  ref: string
): readonly string[] | undefined {
  if (ref === `heads/${branch}`) return options.reported ?? FIXTURE_CHECKS;
  return (options.pulls ?? []).find((_, index) => pullHead(index) === ref);
}

/**
 * Answer a read about what has been reported, when the path is one.
 * @param options - What the platform shows
 * @param base - `repos/owner/name`
 * @param branch - The default branch
 * @param path - The API path, with its query
 * @returns The answer, or `null` when the path is some other read
 */
export function reportedAnswer(
  options: ReportedOptions,
  base: string,
  branch: string,
  path: string
): ReportedAnswer | null {
  const [resource = "", query = ""] = path.split("?");
  const isPulls = resource === `${base}/pulls`;
  const commit = /^commits\/(.+)\/(check-runs|status)$/u.exec(
    resource.slice(base.length + 1)
  );
  if (!isPulls && commit === null) return null;
  if (options.reportFailure !== undefined) {
    return { kind: "refusal", message: options.reportFailure };
  }
  if (isPulls) {
    return {
      kind: "document",
      value: query.includes(`base=${encodeURIComponent(branch)}`)
        ? (options.pulls ?? []).map((_, index) => ({
            number: index + 1,
            head: { sha: pullHead(index) },
          }))
        : [],
    };
  }
  const [, ref = "", surface] = commit ?? [];
  const runs = checkRunsOn(options, branch, ref);
  if (runs === undefined) return { kind: "refusal", message: "Not Found" };
  if (surface === "check-runs") {
    return {
      kind: "document",
      value: {
        total_count: options.checkRunTotal ?? runs.length,
        check_runs: runs.map(name => ({ name, status: "completed" })),
      },
    };
  }
  const statuses =
    ref === `heads/${branch}` ? (options.reportedStatuses ?? []) : [];
  return {
    kind: "document",
    value: {
      total_count: statuses.length,
      statuses: statuses.map(context => ({ context, state: "success" })),
    },
  };
}

/**
 * What the in-memory platform shows as reported on a commit
 * (CodySwannGT/lisa#4993).
 *
 * `lisa controls protect` only requires a check once the platform shows a
 * result under its name from the source that would have to report it: on the
 * head of the protected branch, or on the head of a pull request that was
 * merged into it. This is the stand-in for those reads — a commit's check
 * runs with the app that reported each, its commit statuses, and the list of
 * pull requests into a branch. It holds no state and answers reads only.
 * @module tests/unit/controls/support/fake-github-reports
 */

/** The id GitHub gives its own Actions app. */
export const ACTIONS_APP_ID = 15_368;

/** The app the paved-road declaration says reports its awaited check. */
export const REVIEW_APP_ID = 4242;

/** The awaited check of the paved-road declaration. */
const REVIEW_CHECK = "Review Bot";

/** The checks every protect fixture derives, reported unless a case says otherwise. */
export const FIXTURE_CHECKS: readonly string[] = [
  "🔍 Quality Checks / 🧹 Lint",
  "🔍 Quality Checks / 🧪 Run Unit Tests",
  "🔍 Quality Checks / 🔒 Security Scan",
  REVIEW_CHECK,
];

/**
 * One check run a commit shows. A bare name is reported by the app a fixture
 * expects it from: the declared review app for the awaited check, GitHub
 * Actions for every other. `appId: null` is a run the platform names no app
 * for.
 */
export type ReportedRun =
  | string
  | { readonly name: string; readonly appId: number | null };

/** One pull request into the default branch, as the platform lists it. */
export interface ReportedPull {
  /** The check runs on its head commit. */
  readonly checks: readonly ReportedRun[];
  /** `closed` by default. */
  readonly state?: "open" | "closed";
  /** Whether it was merged. A closed one is merged unless a case says no. */
  readonly merged?: boolean;
  /** The branch it asks to be merged into; the default branch by default. */
  readonly base?: string;
}

/** What the platform shows as reported. */
export interface ReportedOptions {
  /**
   * Check runs on the head of the default branch. Every fixture check by
   * default, so a case about anything else need not say.
   */
  readonly reported?: readonly ReportedRun[];
  /** Commit status names on the head of the default branch. */
  readonly reportedStatuses?: readonly string[];
  /**
   * The pull requests into the default branch, most recently updated first.
   * A bare list of check runs is a pull request that was merged.
   */
  readonly pulls?: readonly (readonly ReportedRun[] | ReportedPull)[];
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
 * The commit id the stand-in gives the head of a pull request.
 * @param index - The pull request's position, most recently updated first
 * @returns A commit id
 */
export function pullHead(index: number): string {
  return `${String(index + 1).padStart(2, "0")}c0ffee`.padEnd(40, "0");
}

/**
 * Read one listed pull request in its full form.
 * @param pull - The pull request as a case wrote it
 * @returns Its check runs, state and whether it was merged
 */
function pullOf(
  pull: readonly ReportedRun[] | ReportedPull
): Required<Omit<ReportedPull, "base">> & { readonly base?: string } {
  const full: ReportedPull = "checks" in pull ? pull : { checks: pull };
  const state = full.state ?? "closed";
  return {
    checks: full.checks,
    state,
    merged: full.merged ?? state === "closed",
    ...(full.base === undefined ? {} : { base: full.base }),
  };
}

/**
 * One check run as the platform returns it.
 * @param run - The run as a case wrote it
 * @returns The document
 */
function runDocument(run: ReportedRun): Readonly<Record<string, unknown>> {
  const name = typeof run === "string" ? run : run.name;
  const fixtureApp = name === REVIEW_CHECK ? REVIEW_APP_ID : ACTIONS_APP_ID;
  const appId = typeof run === "string" ? fixtureApp : run.appId;
  return {
    name,
    status: "completed",
    ...(appId === null ? {} : { app: { id: appId } }),
  };
}

/**
 * The check runs shown on one commit reference.
 * @param options - What the platform shows
 * @param branch - The default branch
 * @param ref - The reference as the path names it
 * @returns The runs, or `undefined` for a reference that does not exist
 */
function checkRunsOn(
  options: ReportedOptions,
  branch: string,
  ref: string
): readonly ReportedRun[] | undefined {
  if (ref === `heads/${branch}`) return options.reported ?? FIXTURE_CHECKS;
  const pull = (options.pulls ?? []).find(
    (_, index) => pullHead(index) === ref
  );
  return pull === undefined ? undefined : pullOf(pull).checks;
}

/**
 * The list of pull requests a query asks for.
 * @param options - What the platform shows
 * @param branch - The default branch
 * @param query - The query of the request
 * @returns The pull requests the platform lists
 */
function listedPulls(
  options: ReportedOptions,
  branch: string,
  query: string
): readonly Readonly<Record<string, unknown>>[] {
  const asked = new URLSearchParams(query);
  const state = asked.get("state") ?? "open";
  return (options.pulls ?? [])
    .map((pull, index) => ({ ...pullOf(pull), index }))
    .filter(pull => (pull.base ?? branch) === asked.get("base"))
    .filter(pull => state === "all" || pull.state === state)
    .map(pull => ({
      number: pull.index + 1,
      state: pull.state,
      merged_at: pull.merged
        ? `2026-01-${String(pull.index + 1).padStart(2, "0")}T00:00:00Z`
        : null,
      head: { sha: pullHead(pull.index) },
      base: { ref: pull.base ?? branch },
    }));
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
    return { kind: "document", value: listedPulls(options, branch, query) };
  }
  const [, ref = "", surface] = commit ?? [];
  const runs = checkRunsOn(options, branch, ref);
  if (runs === undefined) return { kind: "refusal", message: "Not Found" };
  if (surface === "check-runs") {
    return {
      kind: "document",
      value: {
        total_count: options.checkRunTotal ?? runs.length,
        check_runs: runs.map(runDocument),
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

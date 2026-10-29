/** Native external check, substitute, and review-surface observations. */
export interface TerminalScenario {
  /** Exact external conclusion; null keeps a run in flight. */
  state?: string | null;
  /** Raw title or legacy description. */
  title?: string;
  /** Marker authorization, identity, or absence. */
  marker?: "current" | "stale" | "other" | "reader";
  /** Independent review surface observation. */
  surface?: "clean" | "unread" | "thread" | "objection";
  /** Exact deliberate waiver extension. */
  waive?: string;
  /** Exact deliberate proof/satisfaction extension. */
  satisfy?: string;
  /** Use a real legacy commit-status envelope instead of a check run. */
  legacy?: boolean;
  /** Duplicate successful status or older/newer run selection control. */
  selection?: "duplicate" | "newest-success" | "newest-skipped";
}
const head = "a".repeat(40);
const reviewed = "Review completed";
const paused = "Review paused";

/**
 * Build realistic raw check-run/status envelopes before the real jq projection.
 * @param scenario - External conclusion and native row ordering
 * @returns Separate check-run and legacy status lists
 */
function checkRun(scenario: TerminalScenario) {
  const state = scenario.state === undefined ? "skipped" : scenario.state;
  return {
    id: 101,
    name: "CodeRabbit",
    head_sha: head,
    status: state === null ? "in_progress" : "completed",
    conclusion: state,
    app: { id: 347564, slug: "coderabbitai" },
    created_at: "2026-10-28T10:00:00Z",
    completed_at: state === null ? null : "2026-10-28T10:01:00Z",
    output: {
      title: scenario.title ?? paused,
      summary:
        state === "skipped" && (scenario.title ?? paused) === paused
          ? "Result: Skipped - Review paused\n\nSynthetic metadata"
          : "Synthetic metadata",
    },
  };
}

/**
 * Select raw rows with explicit native creation order and legacy duplicates.
 * @param scenario - Controlled source selection observations
 * @returns Independent check-run and commit-status lists
 */
function nativeChecks(scenario: TerminalScenario) {
  const row = checkRun(scenario);
  const later = scenario.selection?.startsWith("newest-")
    ? [
        {
          ...row,
          id: 102,
          created_at: "2026-10-28T11:00:00Z",
          completed_at: "2026-10-28T11:01:00Z",
          conclusion:
            scenario.selection === "newest-success" ? "success" : "skipped",
          output: { title: reviewed, summary: "Synthetic metadata" },
        },
      ]
    : [];
  const runs = scenario.legacy ? [] : [row, ...later];
  const statuses =
    scenario.legacy || scenario.selection === "duplicate"
      ? [
          {
            context: "CodeRabbit",
            state: scenario.legacy ? scenario.state : "success",
            description: scenario.legacy ? scenario.title : reviewed,
          },
        ]
      : [];
  return { runs, statuses };
}

/**
 * Report the independent native review surface, never inferred from a title.
 * @param scenario - Clean, unreadable, or objected review surface
 * @returns Native GraphQL envelope or a controlled read refusal
 */
function reviewSurface(scenario: TerminalScenario) {
  if (scenario.surface === "unread") return null;
  const nodes =
    scenario.surface === "thread"
      ? [{ isResolved: false, isOutdated: false }]
      : [];
  return {
    data: {
      repository: {
        pullRequest: {
          reviewDecision:
            scenario.surface === "objection" ? "CHANGES_REQUESTED" : null,
          reviews: { totalCount: 0, nodes: [] },
          reviewThreads: { totalCount: nodes.length, nodes },
        },
      },
    },
  };
}

/**
 * Construct the exact first-line writer marker for its selected identity.
 * @param scenario - Marker head, reviewer, author permission or absence
 * @returns Native issue-comment rows
 */
function substituteComments(scenario: TerminalScenario) {
  if (!scenario.marker) return [];
  return [
    {
      user: { login: "writer" },
      body: `<!-- lisa:review-substitute context="${scenario.marker === "other" ? "Other" : "CodeRabbit"}" head="${scenario.marker === "stale" ? "b".repeat(40) : head}" -->\nActual controlled substitute`,
    },
  ];
}

/**
 * Supply native read envelopes for the exact inspected PR and commit.
 * @param scenario - Independent check, marker, and surface facts
 * @returns Route-keyed raw external API payloads
 */
export function terminalResponses(
  scenario: TerminalScenario
): Record<string, unknown> {
  const base = "repos/acme/code";
  const { runs, statuses } = nativeChecks(scenario);
  return {
    "pr:view": { headRefOid: head, baseRefName: "main", isDraft: false },
    [`api:${base}/commits/${head}/status`]: { sha: head, statuses },
    [`api:${base}/commits/${head}/check-runs`]: {
      total_count: runs.length,
      check_runs: runs,
    },
    [`api:${base}/pulls/1234/commits`]: [
      { sha: head, parents: [{ sha: "b".repeat(40) }] },
    ],
    [`api:${base}/pulls/1234`]: {
      head: { sha: head },
      base: { ref: "main" },
      commits: 1,
      draft: false,
    },
    [`api:${base}/commits/${head}/pulls`]: [],
    [`api:${base}/pulls/1234/reviews`]:
      scenario.surface === "objection"
        ? [
            {
              state: "CHANGES_REQUESTED",
              commit_id: head,
              user: { login: "reviewer" },
            },
          ]
        : [],
    [`api:${base}/issues/1234/comments`]: substituteComments(scenario),
    [`api:${base}/collaborators/writer/permission`]: {
      permission: scenario.marker === "reader" ? "read" : "write",
    },
    "api:graphql": reviewSurface(scenario),
  };
}

/** A bounded GitHub Issue/Projects response journal, with no provider credentials. */
import type { GitHubRead } from "../../src/cli/github-reader-wire.js";

export const OWNER = "fixture-org";
const REPOSITORY = `${OWNER}/product`;
export const REF = `${REPOSITORY}#7`;
const ISSUE = `repos/${REPOSITORY}/issues/7`;
export const PROJECT_REFUSAL =
  "gh: The 'id' field requires one of the following scopes: ['read:project']";
export const REPOSITORY_REFUSAL =
  "gh: Resource not accessible by integration (HTTP 403)";

const PRIMARY = {
  number: 7,
  title: "Fixture issue",
  body: "## Acceptance Criteria\nContent",
  state: "OPEN",
};
const LINKED_PR = {
  number: 9,
  state: "CLOSED",
  repository: { nameWithOwner: REPOSITORY },
};

/**
 * Build reusable Project settings for the fixture configs.
 * @param number - Configured Project number.
 * @param required - Whether this Project is required.
 * @returns The project coordination block.
 */
export function projectBlock(number: number, required: boolean) {
  return {
    v2: { owner: { kind: "organization", slug: OWNER }, number, required },
  };
}

/**
 * Format a native GraphQL connection and its independently supplied pages.
 * @param nodes - Records on the current page.
 * @param next - Whether this page has a successor.
 * @returns The paginated connection.
 */
function connection(nodes: object[], next = false) {
  return {
    nodes,
    pageInfo: { hasNextPage: next, endCursor: next ? "fixture-cursor" : null },
  };
}

/**
 * Format a native paginatable issue response.
 * @param fields - Selected issue fields.
 * @returns One GraphQL page.
 */
function issuePage(fields: object) {
  return { data: { repository: { issue: fields } } };
}

/**
 * Format a native execution error while preserving provider stderr exactly.
 * @param message - Synthetic refusal returned by the provider.
 * @returns A native-shaped error.
 */
function refusal(message: string): Error {
  return Object.assign(new Error("GitHub command failed"), {
    stderr: `${message}\n`,
  });
}

/**
 * Return the configured synthetic Project or its native refusal.
 * @param args - Exact arguments chosen by the reader.
 * @param denied - Whether Project access is refused.
 * @returns A Project response for the configured owner and number.
 */
function projectResponse(args: readonly string[], denied: boolean) {
  if (denied) throw refusal(PROJECT_REFUSAL);
  if (!args.includes(`login=${OWNER}`) || !args.includes("number=23"))
    return undefined;
  return {
    data: {
      organization: {
        login: OWNER,
        projectV2: {
          id: "PROJECT_FIXTURE",
          title: "Fixture Project",
          number: 23,
          url: "https://github.com/orgs/fixture-org/projects/23",
        },
      },
    },
  };
}

/**
 * Match one of the pagination queries issued against repository resources.
 * @param query - Exact query chosen by the reader.
 * @param args - Exact arguments chosen by the reader.
 * @returns A repository response for a supported resource.
 */
function repositoryGraphResponse(query: string, args: readonly string[]) {
  if (!args.includes("--paginate") || !args.includes("--slurp"))
    return undefined;
  if (query.includes("subIssues("))
    return [
      issuePage({
        parent: { number: 2 },
        subIssues: connection([{ number: 8 }], true),
      }),
      issuePage({
        parent: { number: 2 },
        subIssues: connection([{ number: 10 }]),
      }),
    ];
  if (query.includes("closedByPullRequestsReferences("))
    return [
      issuePage({ closedByPullRequestsReferences: connection([LINKED_PR]) }),
    ];
  if (query.includes("timelineItems("))
    return [
      issuePage({
        timelineItems: connection(
          [{ __typename: "CrossReferencedEvent", source: LINKED_PR }],
          true
        ),
      }),
      issuePage({
        timelineItems: connection([
          { __typename: "LabeledEvent", label: { name: "status:ready" } },
        ]),
      }),
    ];
  if (query.includes("reviewThreads("))
    return [
      {
        data: {
          repository: {
            pullRequest: {
              reviewThreads: connection([
                {
                  id: "THREAD-1",
                  isResolved: false,
                  comments: { totalCount: 2, nodes: [{ id: 41 }] },
                },
              ]),
            },
          },
        },
      },
    ];
  if (
    query.includes("on PullRequestReviewThread") &&
    args.includes("id=THREAD-1")
  ) {
    return [
      { data: { node: { comments: connection([{ id: 41 }], true) } } },
      { data: { node: { comments: connection([{ id: 42 }]) } } },
    ];
  }
  return undefined;
}

/** Conditions simulated by the recording transport. */
interface ResponseOptions {
  denyProject?: boolean;
  denyIssue?: boolean;
  denyReview?: boolean;
  commentCount?: number;
}

/**
 * Respond to the actual primary `gh` call, including the old field list.
 * @param args - Arguments chosen by the reader.
 * @param denied - Whether required issue access fails.
 * @returns Native issue metadata.
 */
function issueResponse(args: readonly string[], denied: boolean) {
  if (args.some(arg => arg.includes("projectItems")))
    throw refusal(PROJECT_REFUSAL);
  if (denied) throw refusal(REPOSITORY_REFUSAL);
  return PRIMARY;
}

/**
 * Select responses for the supported native request forms.
 * @param args - Arguments selected by the production reader.
 * @param options - Explicit failure controls.
 * @returns A recorded provider response, or undefined for an unsupported route.
 */
function response(args: readonly string[], options: ResponseOptions): unknown {
  const [command, target, value, ...rest] = args;
  const key = args.join(" ");
  const restResponses: Record<string, unknown> = {
    "auth status": null,
    [`api ${ISSUE} --jq .comments`]: options.commentCount ?? 2,
    [`api ${ISSUE}/comments --paginate --slurp`]: [[{ id: 1 }], [{ id: 2 }]],
    [`api repos/${REPOSITORY}/pulls/9/reviews --paginate --slurp`]: [
      [{ id: 11 }],
      [{ id: 12 }],
    ],
  };
  if (key in restResponses) return restResponses[key];
  if (key.startsWith(`issue view 7 --repo ${REPOSITORY} --json `))
    return issueResponse(args, options.denyIssue ?? false);
  if (key.startsWith(`pr view 9 --repo ${REPOSITORY} --json `)) {
    if (options.denyReview) throw refusal(REPOSITORY_REFUSAL);
    return {
      number: 9,
      headRefOid: "native-head",
      baseRefName: "main",
      reviewDecision: "CHANGES_REQUESTED",
    };
  }
  if (command !== "api" || target !== "graphql" || value !== "-f")
    return undefined;
  const [query = ""] = rest;
  return query.includes("projectV2(")
    ? projectResponse(args, options.denyProject ?? false)
    : repositoryGraphResponse(query, args);
}

/**
 * Create a route-bounded transport to observe actual request selection.
 * @param options - Explicit failure controls.
 * @returns The native-shaped response function and captured request journal.
 */
export function readerFixture(options: ResponseOptions = {}) {
  const requests: string[][] = [];
  const unsupported: string[][] = [];
  const read: GitHubRead = args => {
    requests.push([...args]);
    return Promise.resolve().then(() => {
      const result = response(args, options);
      if (result !== undefined) return result;
      unsupported.push([...args]);
      throw new Error(`Unexpected fixture request: ${args.join(" ")}`);
    });
  };
  return { read, requests, unsupported };
}

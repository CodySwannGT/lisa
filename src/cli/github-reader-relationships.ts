/** Repository-native issue relationships, label history, and linked PR reviews. */
import type { JsonObject } from "../sync/json-path.js";
import type { GitHubIssueRef } from "./github-reader-target.js";
import {
  connectionNodes,
  githubReadError,
  graphql,
  itemVariables,
  repositoryItem,
  responseObject,
  responseObjects,
  restPages,
  type GitHubRead,
} from "./github-reader-wire.js";

const REPO_FIELDS = "number title state url repository { nameWithOwner }";
const PULL_FIELDS = `number title state merged mergedAt url repository { nameWithOwner }`;
const PAGE = "pageInfo { hasNextPage endCursor }";
const ISSUE_QUERY =
  "query($owner:String!,$repo:String!,$number:Int!,$endCursor:String)";
const ISSUE_ROOT =
  "repository(owner:$owner,name:$repo) { issue(number:$number)";
const COMMENTS = "id url body createdAt author { login }";
const REVIEW_THREAD_COMMENTS = "review thread comments";
const PULL_METADATA =
  "number,title,state,mergedAt,url,headRefOid,baseRefName,baseRefOid,reviewDecision,reviewRequests,statusCheckRollup";

const SUB_ISSUES = `${ISSUE_QUERY} { ${ISSUE_ROOT} {
  parent { ${REPO_FIELDS} }
  subIssues(first:100,after:$endCursor) {
    nodes { ${REPO_FIELDS} labels(first:50) { nodes { name } } assignees(first:5) { nodes { login } } }
    ${PAGE}
  }
} } }`;
const CLOSING_PULLS = `${ISSUE_QUERY} { ${ISSUE_ROOT} {
  closedByPullRequestsReferences(first:100,after:$endCursor) {
    nodes { ${PULL_FIELDS} } ${PAGE}
  }
} } }`;
const TIMELINE = `${ISSUE_QUERY} { ${ISSUE_ROOT} {
  timelineItems(first:100,after:$endCursor,itemTypes:[CROSS_REFERENCED_EVENT,LABELED_EVENT,UNLABELED_EVENT]) {
    nodes {
      __typename
      ...on CrossReferencedEvent {
        createdAt actor { login } source { ...on PullRequest { ${PULL_FIELDS} } }
      }
      ...on LabeledEvent { createdAt actor { login } label { name } }
      ...on UnlabeledEvent { createdAt actor { login } label { name } }
    }
    ${PAGE}
  }
} } }`;
const THREADS = `${ISSUE_QUERY} { repository(owner:$owner,name:$repo) { pullRequest(number:$number) {
  reviewThreads(first:100,after:$endCursor) {
    nodes { id isResolved isOutdated path line originalLine comments(first:100) { totalCount nodes { ${COMMENTS} } } }
    ${PAGE}
  }
} } }`;
const THREAD_COMMENTS = `query($id:ID!,$endCursor:String) { node(id:$id) {
  ...on PullRequestReviewThread { comments(first:100,after:$endCursor) { nodes { ${COMMENTS} } ${PAGE} } }
} }`;

/**
 * Project one named connection from each paginated issue response.
 * @param read - Native GitHub reader.
 * @param ref - Repository and issue identity.
 * @param query - Issue connection query.
 * @param key - Connection field name in that query.
 * @returns Validated native connection nodes.
 */
async function issueConnection(
  read: GitHubRead,
  ref: GitHubIssueRef,
  query: string,
  key: string
) {
  const pages = await graphql(read, query, itemVariables(ref), true);
  return connectionNodes(
    pages.map(page => responseObject(repositoryItem(page, "issue")[key], key)),
    key
  );
}

/**
 * Preserve native graph coverage and the older GitHub Enterprise fallback.
 * @param read - Native GitHub reader.
 * @param ref - Repository and issue identity.
 * @returns Native parent and children or the exact unsupported-schema warning.
 */
async function issueGraph(read: GitHubRead, ref: GitHubIssueRef) {
  try {
    const pages = await graphql(read, SUB_ISSUES, itemVariables(ref), true);
    const issues = pages.map(page => repositoryItem(page, "issue"));
    const parent = issues[0]?.parent;
    const children = connectionNodes(
      issues.map(issue => responseObject(issue.subIssues, "sub-issues")),
      "sub-issues"
    );
    return {
      parent:
        parent === null ? null : responseObject(parent, "the parent issue"),
      children,
    };
  } catch (error) {
    const message = githubReadError(error);
    if (
      !/(?:Field ['"](?:parent|subIssues)['"] doesn.t exist|Cannot query field ['"](?:parent|subIssues)['"])/iu.test(
        message
      )
    )
      throw error;
    return { warning: message };
  }
}

/**
 * Keep native label history and cross-references, with its existing advisory failure behavior.
 * @param read - Native GitHub reader.
 * @param ref - Repository and issue identity.
 * @returns Timeline events or the exact read warning.
 */
async function issueTimeline(read: GitHubRead, ref: GitHubIssueRef) {
  try {
    return {
      events: await issueConnection(read, ref, TIMELINE, "timelineItems"),
    };
  } catch (error) {
    return { events: [], warning: githubReadError(error) };
  }
}

/**
 * Match the native repository/number from the PR references and deduplicate them.
 * @param references - GraphQL PR link records.
 * @returns Unique native PR identities in the first seen order.
 */
function linkedPulls(references: readonly JsonObject[]): GitHubIssueRef[] {
  const pulls = references.map(({ repository, number }) => {
    const name = responseObject(
      repository,
      "the linked PR repository"
    ).nameWithOwner;
    const pair =
      typeof name === "string"
        ? /^([a-z\d_-]+)\/((?!\.{1,2}$)[a-z\d_.-]+)$/iu.exec(name)
        : null;
    if (
      !pair?.[1] ||
      !pair[2] ||
      typeof number !== "number" ||
      !Number.isSafeInteger(number) ||
      number <= 0
    ) {
      throw new Error("GitHub did not return the linked PR identity");
    }
    const ref = { owner: pair[1], repo: pair[2], number };
    return [`${ref.owner}/${ref.repo}#${number}`.toLowerCase(), ref] as const;
  });
  return [...new Map(pulls).values()];
}

/**
 * Read every comment when a native review thread spans multiple pages.
 * @param read - Native GitHub reader.
 * @param thread - Review thread returned with its first comment page.
 * @returns The native thread with flattened comments.
 */
async function threadComments(read: GitHubRead, thread: JsonObject) {
  const first = responseObject(thread.comments, REVIEW_THREAD_COMMENTS);
  const nodes = responseObjects(first.nodes, REVIEW_THREAD_COMMENTS);
  if (first.totalCount === nodes.length) return { ...thread, comments: nodes };
  if (
    typeof first.totalCount !== "number" ||
    first.totalCount < nodes.length ||
    typeof thread.id !== "string"
  )
    throw new Error(
      "GitHub did not return the review thread pagination identity"
    );
  const pages = await graphql(read, THREAD_COMMENTS, { id: thread.id }, true);
  const connections = pages.map(page =>
    responseObject(
      responseObject(page.node, "a review thread").comments,
      REVIEW_THREAD_COMMENTS
    )
  );
  const comments = connectionNodes(connections, REVIEW_THREAD_COMMENTS);
  if (comments.length !== first.totalCount)
    throw new Error("GitHub review thread comments changed during pagination");
  return { ...thread, comments };
}

/**
 * Read linked PR revisions, review records and complete review threads.
 * @param read - Native GitHub reader.
 * @param ref - The linked PR repository and number.
 * @returns The linked PR context.
 */
async function pullContext(read: GitHubRead, ref: GitHubIssueRef) {
  const repo = `${ref.owner}/${ref.repo}`;
  const [view, reviews, pages] = await Promise.all([
    read([
      "pr",
      "view",
      String(ref.number),
      "--repo",
      repo,
      "--json",
      PULL_METADATA,
    ]),
    restPages(read, `repos/${repo}/pulls/${ref.number}/reviews`),
    graphql(read, THREADS, itemVariables(ref), true),
  ]);
  const threads = connectionNodes(
    pages.map(page =>
      responseObject(
        repositoryItem(page, "pullRequest").reviewThreads,
        "review threads"
      )
    ),
    "review threads"
  );
  return {
    repo,
    metadata: responseObject(view, "linked PR metadata"),
    reviews,
    threads: await Promise.all(
      threads.map(async thread => await threadComments(read, thread))
    ),
  };
}

/**
 * Keep inaccessible additional links visible without masking a primary-repository failure.
 * @param read - Native GitHub reader.
 * @param primary - Primary issue repository.
 * @param pull - Linked pull request identity.
 * @returns Link context or the native diagnostic for an inaccessible cross-repo link.
 */
async function linkedPullContext(
  read: GitHubRead,
  primary: GitHubIssueRef,
  pull: GitHubIssueRef
) {
  try {
    return await pullContext(read, pull);
  } catch (error) {
    const repo = `${pull.owner}/${pull.repo}`;
    if (repo.toLowerCase() === `${primary.owner}/${primary.repo}`.toLowerCase())
      throw error;
    return { repo, number: pull.number, warning: githubReadError(error) };
  }
}

/**
 * Gather native issue relationships, history and linked PR reviews.
 * @param read - Native GitHub reader.
 * @param ref - Repository and issue identity.
 * @returns Repository context independent of Projects service metadata.
 */
export async function readGitHubIssueRelationships(
  read: GitHubRead,
  ref: GitHubIssueRef
) {
  const [graph, closing, timeline] = await Promise.all([
    issueGraph(read, ref),
    issueConnection(read, ref, CLOSING_PULLS, "closedByPullRequestsReferences"),
    issueTimeline(read, ref),
  ]);
  const crossReferenced = timeline.events
    .filter(event => event.__typename === "CrossReferencedEvent")
    .flatMap(event => {
      const source = event.source;
      return source === null ||
        source === undefined ||
        typeof source !== "object" ||
        !("number" in source)
        ? []
        : [responseObject(source, "a cross-referenced PR")];
    });
  const pulls = linkedPulls([...closing, ...crossReferenced]);
  const pullRequests = await pulls.reduce<
    Promise<Awaited<ReturnType<typeof linkedPullContext>>[]>
  >(
    async (pending, pull) => [
      ...(await pending),
      await linkedPullContext(read, ref, pull),
    ],
    Promise.resolve([])
  );
  return { graph, timeline, pullRequests };
}

/** Fixed read-only request spellings used by the existing GitHub intake owner. */
export const issueFields =
  "number,title,body,state,stateReason,author,assignees,labels,milestone,createdAt,updatedAt,closedAt,url,comments,reactionGroups,projectItems";
export const relatedFields = "number,title,state,labels,assignees,url";
export const prFields =
  "number,title,state,reviewDecision,mergedAt,url,reviewRequests,reviews,comments";
export const graphQuery =
  "query($org:String!,$repo:String!,$number:Int!,$endCursor:String){repository(owner:$org,name:$repo){issue(number:$number){id parent{number title state url repository{nameWithOwner}} subIssues(first:100,after:$endCursor){pageInfo{hasNextPage endCursor} nodes{number title body state url repository{nameWithOwner} labels(first:50){nodes{name}} assignees(first:5){nodes{login}}}}}}}";
export const historyQuery =
  "query($org:String!,$repo:String!,$number:Int!,$endCursor:String){repository(owner:$org,name:$repo){issue(number:$number){timelineItems(first:100,after:$endCursor,itemTypes:[CROSS_REFERENCED_EVENT,LABELED_EVENT,UNLABELED_EVENT]){pageInfo{hasNextPage endCursor} nodes{__typename ...on CrossReferencedEvent{createdAt actor{login} source{...on PullRequest{number title state url repository{nameWithOwner}}}} ...on LabeledEvent{createdAt actor{login} label{name}} ...on UnlabeledEvent{createdAt actor{login} label{name}}}}}}}";
export const pullRequestsQuery =
  "query($org:String!,$repo:String!,$number:Int!,$endCursor:String){repository(owner:$org,name:$repo){issue(number:$number){closedByPullRequestsReferences(first:50,after:$endCursor){pageInfo{hasNextPage endCursor} nodes{number title state merged mergedAt url repository{nameWithOwner}}}}}}";
export const queries = [graphQuery, historyQuery, pullRequestsQuery];
export const intakeReads = [
  "issue",
  "comments",
  "comment-count",
  "graph",
  "history",
  "closing-prs",
  "blocked-by",
  "blocking",
  "pr",
  "review-threads",
  "thread-comments",
];

/** Strict data-only argv for the existing scoped access owner, never arbitrary gh arguments. */
export function intakeRequest(args, cfg) {
  const [mode, refFlag, ref, readFlag, operation, valueFlag, value] = args,
    g = cfg.effective?.github,
    repo = g && `${g.org}/${g.repo}`;
  if (
    args.length !== 7 ||
    mode !== "--intake-read" ||
    refFlag !== "--ref" ||
    readFlag !== "--read" ||
    !intakeReads.includes(operation) ||
    !repo ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) ||
    !ref?.startsWith(`${repo}#`) ||
    !/^[1-9]\d*$/.test(ref.slice(repo.length + 1)) ||
    (cfg.effective.tracker && cfg.effective.tracker !== "github")
  )
    return null;
  if (
    operation === "thread-comments"
      ? valueFlag !== "--thread" || !/^[A-Za-z0-9_+/=-]{1,256}$/.test(value)
      : valueFlag !== "--number" || !/^[1-9]\d*$/.test(value)
  )
    return null;
  return { ref, operation, value, repo };
}
export const reviewThreadsQuery =
  "query($org:String!,$repo:String!,$number:Int!,$endCursor:String){repository(owner:$org,name:$repo){pullRequest(number:$number){reviewThreads(first:100,after:$endCursor){pageInfo{hasNextPage endCursor} nodes{id isResolved isOutdated comments(first:100){pageInfo{hasNextPage endCursor} nodes{body author{login} createdAt url}}}}}}}";
export const threadCommentsQuery =
  "query($id:ID!,$endCursor:String){node(id:$id){...on PullRequestReviewThread{comments(first:100,after:$endCursor){pageInfo{hasNextPage endCursor} nodes{body author{login} createdAt url}}}}}";

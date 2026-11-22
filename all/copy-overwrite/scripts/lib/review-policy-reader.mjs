// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.
// Managed by Lisa. Read authenticated GitHub evidence without provider wait loops.
import { boundedExecFileSync } from "./bounded-spawn.mjs";
import {
  nativeNumber,
  REVIEW_HEAD,
  REVIEW_REPO,
} from "./review-policy-contract.mjs";
import {
  usesStatuses,
  readExternalEvidence,
} from "./review-providers/index.mjs";
import { evaluateReviewPolicy, resolveReviewPolicy } from "./review-policy.mjs";
import { readGates } from "../lisa-gates.mjs";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const NOT_REVIEWED = "not-reviewed";

/** Read the same canonical project config used by the registry. */
export function loadReviewConfig(root) {
  return readGates(root).config;
}
/** Read legacy adapter declarations consistently; an absent seed permits agent-only hosts. */
export function loadReviewDeclaration(root = process.cwd()) {
  const path = join(root, ".github/required-checks.json");
  if (!existsSync(path)) return {};
  const declaration = JSON.parse(readFileSync(path, "utf8"));
  if (
    !declaration ||
    typeof declaration !== "object" ||
    Array.isArray(declaration)
  ) {
    throw new Error("Existing review declaration must be an object");
  }
  return declaration;
}

/** Authenticated API transport. Every failed/malformed read fails closed. */
export function reviewApi(args, payload) {
  return JSON.parse(
    boundedExecFileSync("gh", ["api", ...args], {
      encoding: "utf8",
      ...(payload === undefined ? {} : { input: JSON.stringify(payload) }),
    })
  );
}

/** Read all pages, checking shape before flattening. */
function pages(api, endpoint, property) {
  const result = api([endpoint, "--paginate", "--slurp"]);
  if (!Array.isArray(result) || result.length === 0)
    throw new Error(`Malformed paginated evidence: ${endpoint}`);
  const values = result.flatMap(page => {
    const values = property ? page?.[property] : page;
    if (!Array.isArray(values))
      throw new Error(`Malformed evidence page: ${endpoint}`);
    return values;
  });
  if (
    property &&
    result.some(
      page =>
        !Number.isSafeInteger(page.total_count) ||
        page.total_count < 0 ||
        page.total_count > values.length
    )
  )
    throw new Error(`Incomplete evidence pages: ${endpoint}`);
  return values;
}

/** Find open heads, never merely associated historical commits. */
export function reviewHeadPulls(repo, head, api = reviewApi) {
  return pages(api, `repos/${repo}/commits/${head}/pulls?per_page=100`)
    .filter(
      pull =>
        pull.state === "open" &&
        pull.head?.sha === head &&
        Number.isSafeInteger(pull.number)
    )
    .map(pull => pull.number);
}

/** Read open pull requests for the GitHub-reported source owner and branch. */
export function reviewBranchPulls(repo, owner, sourceBranch, api = reviewApi) {
  const query = new URLSearchParams({
    state: "open",
    head: `${owner}:${sourceBranch}`,
    per_page: "100",
  });
  return pages(api, `repos/${repo}/pulls?${query}`);
}

const THREAD_QUERY = `query($owner:String!,$name:String!,$number:Int!,$cursor:String){
  repository(owner:$owner,name:$name){pullRequest(number:$number){
    headRefOid reviewDecision reviewThreads(first:100,after:$cursor){
      nodes{isResolved} pageInfo{hasNextPage endCursor}
    }
  }}
}`;

/** Read the complete current review surface; missing pages never mean no threads. */
function activityAtHead(api, repo, pr) {
  const [owner, name] = repo.split("/");
  let cursor;
  const seen = new Set();
  const threads = [];
  let activity;
  do {
    const args = [
      "graphql",
      "-f",
      `query=${THREAD_QUERY}`,
      "-f",
      `owner=${owner}`,
      "-f",
      `name=${name}`,
      "-F",
      `number=${pr}`,
    ];
    if (cursor) args.push("-f", `cursor=${cursor}`);
    const result = api(args);
    if (result.errors)
      throw new Error("Review-surface GraphQL read returned errors");
    const pull = result.data?.repository?.pullRequest;
    if (
      !pull ||
      !Array.isArray(pull.reviewThreads?.nodes) ||
      typeof pull.reviewThreads.pageInfo?.hasNextPage !== "boolean" ||
      typeof pull.headRefOid !== "string" ||
      !Object.hasOwn(pull, "reviewDecision") ||
      ![null, "APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"].includes(
        pull.reviewDecision
      )
    )
      throw new Error("Review surface was incomplete");
    if (
      activity &&
      (activity.headRefOid !== pull.headRefOid ||
        activity.reviewDecision !== pull.reviewDecision)
    )
      throw new Error(
        "Head or decision changed during review-surface pagination"
      );
    activity = pull;
    threads.push(...pull.reviewThreads.nodes);
    if (!pull.reviewThreads.pageInfo.hasNextPage) break;
    cursor = pull.reviewThreads.pageInfo.endCursor;
    if (!cursor || seen.has(cursor))
      throw new Error("Review-thread pagination did not advance");
    seen.add(cursor);
  } while (cursor);
  return {
    headRefOid: activity.headRefOid,
    reviewDecision: activity.reviewDecision,
    threads,
  };
}

/** Read and evaluate policy against one immutable head; re-read live head before returning. */
export function readPolicyReview({
  config,
  declaration,
  repo,
  pr,
  head,
  api = reviewApi,
}) {
  try {
    if (
      !REVIEW_REPO.test(repo ?? "") ||
      nativeNumber(pr) === null ||
      !REVIEW_HEAD.test(head ?? "")
    )
      throw new Error("A repository and PR number are required");
    const policy = resolveReviewPolicy(config, declaration);
    const endpoint = `repos/${repo}/pulls/${pr}`;
    const pull = api([endpoint]);
    if (
      !Number.isSafeInteger(pull?.user?.id) ||
      pull.user.id <= 0 ||
      typeof pull.draft !== "boolean" ||
      !Array.isArray(pull.labels) ||
      pull.labels.some(label => typeof label?.name !== "string")
    )
      throw new Error(
        "Pull-request identity, draft state or holds were incomplete"
      );
    const reviewsEndpoint = `${endpoint}/reviews?per_page=100`;
    const reviews = pages(api, reviewsEndpoint);
    const activity = activityAtHead(api, repo, pr);
    const permissions = new Map();
    const canWrite = login => {
      if (
        typeof login !== "string" ||
        !/^[A-Za-z0-9_-]+(?:\[bot\])?$/.test(login)
      )
        return false;
      if (!permissions.has(login)) {
        const permission = api([
          `repos/${repo}/collaborators/${encodeURIComponent(login)}/permission`,
        ]);
        if (typeof permission?.permission !== "string")
          throw new Error("Author permission could not be proven");
        permissions.set(
          login,
          ["admin", "maintain", "write"].includes(permission.permission)
        );
      }
      return permissions.get(login);
    };
    // Satisfied local evidence does not depend on an optional provider's API
    // availability. Required providers/counts still force their actual reads.
    const local = evaluateReviewPolicy({
      policy,
      head,
      reviews,
      activity,
      pull,
      canWrite,
    });
    const needsExternal =
      local.reasons.some(reason =>
        /^(?:required-provider:|review-count:)/u.test(reason)
      ) && policy.providers.some(usesStatuses);
    const external = needsExternal
      ? readExternalEvidence({
          policy,
          repo,
          head,
          read: (endpoint, property) => pages(api, endpoint, property),
        })
      : {};
    const verdict = needsExternal
      ? evaluateReviewPolicy({
          policy,
          head,
          reviews,
          ...external,
          activity,
          pull,
          canWrite,
          externalRead: true,
        })
      : local;
    if (verdict.outcome === "reviewed") {
      const recentReviews = pages(api, reviewsEndpoint);
      const recentActivity = activityAtHead(api, repo, pr);
      if (
        JSON.stringify(recentReviews) !== JSON.stringify(reviews) ||
        JSON.stringify(recentActivity) !== JSON.stringify(activity)
      ) {
        return {
          ...verdict,
          outcome: NOT_REVIEWED,
          reasons: ["review-evidence-changed-after-read"],
        };
      }
    }
    const final = api([endpoint]);
    const holds = value =>
      JSON.stringify((value.labels ?? []).map(label => label.name).sort());
    if (
      final.head?.sha !== head ||
      final.state !== pull.state ||
      final.draft !== pull.draft ||
      !Array.isArray(final.labels) ||
      final.user?.id !== pull.user.id ||
      holds(final) !== holds(pull)
    ) {
      return {
        ...verdict,
        outcome: NOT_REVIEWED,
        reasons: [
          ...verdict.reasons,
          "head-or-holds-changed-after-evidence-read",
        ],
      };
    }
    return verdict;
  } catch (error) {
    return {
      outcome: NOT_REVIEWED,
      sha: head,
      providers: [],
      evidence: [],
      reasons: [`unreadable-or-invalid-review-evidence: ${error.message}`],
    };
  }
}

/** Plain language shared by both CLI entrypoints and lifecycle consumers. */
export function policyReviewReport(verdict) {
  const explain = reason => {
    if (reason.startsWith("required-provider:"))
      return `required reviewer ${reason.slice(18)} has not completed a review`;
    if (reason.startsWith("review-count:"))
      return `${reason.slice(13)} completed independent reviewers (observed/required)`;
    if (reason.startsWith("human-approvals:"))
      return `${reason.slice(16)} human approvals (observed/required)`;
    return (
      {
        "standing-review-objection": "a review still asks for changes",
        "unresolved-review-thread": "review comments still need resolution",
        "explicit-review-hold": "a hold label is present",
        "draft-pull-request": "the pull request is still a draft",
        "review-evidence-changed-after-read":
          "the review changed during evaluation. Check it again",
        "malformed-native-review":
          "a submitted review record is incomplete or invalid",
      }[reason] ?? reason
    );
  };
  if (verdict.outcome === "reviewed") {
    return `REVIEWED (${verdict.providers.join(", ")}) at ${verdict.sha}`;
  }
  return [
    `REVIEW REQUIRED at ${verdict.sha}`,
    ...verdict.reasons.map(reason => `- ${explain(reason)}`),
    ...(verdict.readings ?? []).map(
      reading =>
        `- ${reading.provider} reported ${reading.condition}${reading.observed == null ? "" : ` ${JSON.stringify(reading.observed)}`}`
    ),
  ].join("\n");
}

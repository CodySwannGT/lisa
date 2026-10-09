// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Native successful responses grant only one exact canonical successor request. */
import { canonicalJson } from "../lisa-automation-provenance.mjs";
import { required } from "./npm-update-contract.mjs";
import {
  githubHierarchyArgs,
  backlinkBody,
  partitionBacklinks,
  githubBacklinkComments,
} from "../lisa-work-item.mjs";
const key = args => canonicalJson(args);
const ID = /^[1-9]\d*$/;

export function recoveryPage(subject, page) {
  const head = encodeURIComponent(
    `${subject.repository.split("/")[0]}:${subject.branch}`
  );
  return [
    "api",
    "--hostname",
    "github.com",
    `repos/${subject.repository}/pulls?state=all&head=${head}&per_page=100&page=${page}`,
  ];
}

export function createGhState(scope) {
  return {
    grants: new Map(
      scope.records
        .filter(record => record.kind !== "plain")
        .map(record => [key(record.args), record])
    ),
    requests: 0,
  };
}

/** Consume every successor before native dispatch, including a repeated response cursor. */
export function prepareGhRequest(scope, state, args) {
  required(
    Array.isArray(args) &&
      args.every(value => typeof value === "string" && !value.includes("\0")),
    "invalid literal GH request"
  );
  const serialized = key(args);
  const record =
    scope.records.find(
      value => value.kind === "plain" && key(value.args) === serialized
    ) ?? state.grants.get(serialized);
  required(
    record && state.requests < 1024,
    "unqualified or exhausted GH request"
  );
  if (record.kind !== "plain") state.grants.delete(serialized);
  state.requests++;
  return record;
}

/** Primitive and file coercions in gh's typed -F grammar are never accepted as cursors. */
function cursorValue(value) {
  required(
    typeof value === "string" &&
      value.length > 0 &&
      Buffer.byteLength(value) <= 1024 &&
      !/[\0\n\r]/.test(value) &&
      !value.startsWith("@") &&
      !/^(?:true|false|null|-?\d+(?:\.\d+)?)$/.test(value),
    "invalid typed GH hierarchy cursor"
  );
  return value;
}

/** Only an actual successful bounded response can grant the next exact request. */
export function observeGhResponse(scope, state, request, result) {
  if (
    request.kind === "plain" ||
    request.kind === "write" ||
    result.error ||
    result.signal ||
    result.status !== 0
  )
    return;
  required(
    typeof result.stdout === "string" &&
      Buffer.byteLength(result.stdout) <= 3_145_728,
    "unbounded GH response grant"
  );
  const value =
    request.kind === "comments"
      ? githubBacklinkComments(result.stdout)
      : JSON.parse(result.stdout);
  let successor;
  if (request.kind === "hierarchy") {
    const page = value.data?.repository?.issue?.subIssues;
    required(
      Array.isArray(page?.nodes) &&
        page.nodes.length <= 100 &&
        typeof page.pageInfo?.hasNextPage === "boolean",
      "invalid GH hierarchy grant"
    );
    if (page.pageInfo.hasNextPage)
      successor = {
        kind: "hierarchy",
        args: githubHierarchyArgs(
          { repository: scope.subject.tracker },
          scope.subject.issue,
          cursorValue(page.pageInfo.endCursor)
        ),
      };
  } else if (request.kind === "recovery-page") {
    required(
      Array.isArray(value) && value.length <= 100,
      "invalid GH recovery page grant"
    );
    if (value.length === 100) {
      required(request.page < 20, "incomplete GH recovery pages");
      successor = {
        kind: "recovery-page",
        page: request.page + 1,
        args: recoveryPage(scope.subject, request.page + 1),
      };
    }
  } else if (request.kind === "comments")
    successor = backlinkRequest(scope.subject, value);
  if (successor) state.grants.set(key(successor.args), successor);
}

/** Canonical marker partitioning keeps every other PR's comment outside writer authority. */
function backlinkRequest(subject, comments) {
  required(
    subject.phase === "publication-backlink" &&
      subject.pr &&
      Array.isArray(comments) &&
      comments.length <= 10000,
    "invalid GH backlink response"
  );
  const { mine } = partitionBacklinks(
    comments,
    subject.pr.url,
    comment => comment?.body
  );
  const body = backlinkBody(subject.pr.url);
  if (mine?.body === body) return null;
  required(
    !mine ||
      ((typeof mine.id === "string" || Number.isSafeInteger(mine.id)) &&
        ID.test(String(mine.id))),
    "invalid GH backlink comment ID"
  );
  const method = mine ? "PATCH" : "POST";
  const endpoint = mine
    ? `repos/${subject.tracker}/issues/comments/${mine.id}`
    : `repos/${subject.tracker}/issues/${subject.issue}/comments`;
  return {
    kind: "write",
    args: ["api", "--method", method, endpoint, "--field", `body=${body}`],
  };
}

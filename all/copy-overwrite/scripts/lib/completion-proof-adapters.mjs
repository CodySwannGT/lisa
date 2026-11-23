// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Provider-native proof discovery/publication adapters; credentials stay in CLI. */
import {
  EstimateConfigError,
  resolveEstimateGate,
} from "./work-item-estimate-config.mjs";
import {
  CompletionProofError,
  MAX_NATIVE_JSON_BYTES,
  requireProof,
} from "./completion-proof-shape.mjs";
import {
  ReleaseSwitchError,
  resolveReleaseSetting,
  switchReferences,
} from "./release-switch.mjs";

const READ_ERROR = "read-error";
const WRITE_ERROR = "write-error";

/** Construct the same strict authorizer context for supported lifecycle writers. */
/**
 * The project's token-estimate settings for the done gate
 * (CodySwannGT/lisa#4956). An unusable `workItem.estimate` is carried as an
 * error so completion refuses with the reason instead of crashing, unless the
 * project turned the gate off: then the gate never reads those settings, so
 * they cannot refuse completion either.
 */
function estimateSettings(config) {
  try {
    return resolveEstimateGate(config);
  } catch (error) {
    if (!(error instanceof EstimateConfigError)) throw error;
    return { required: true, error: error.message };
  }
}

/**
 * Where a release switch is still referenced, for the switch-removal done gate
 * (CodySwannGT/lisa#5188).
 *
 * The production branch's remote-tracking ref is searched when this checkout
 * has one, because that is what the merged pull request actually changed; the
 * checkout a finish runs from is often a feature branch that still carries the
 * switch, or is behind. Without that ref the working tree is the only tree
 * there is. A search that cannot run is a read error, never "no references".
 */
function trackedSwitchReferences(run, branch, switchName) {
  const remote = `refs/remotes/origin/${branch}`;
  const revision =
    run("git", ["rev-parse", "-q", "--verify", remote], { allowFailure: true })
      .status === 0
      ? remote
      : undefined;
  try {
    return {
      searched: revision ? `origin/${branch}` : "the working tree",
      files: switchReferences(switchName, {
        revision,
        run: args => {
          const result = run("git", args, {
            allowFailure: true,
            maxBuffer: MAX_NATIVE_JSON_BYTES,
          });
          if (result.status === 0) return result.stdout;
          throw Object.assign(new Error(result.stderr), {
            status: result.status,
            stderr: result.stderr,
          });
        },
      }),
    };
  } catch (error) {
    if (!(error instanceof ReleaseSwitchError)) throw error;
    throw new CompletionProofError(READ_ERROR, error.message);
  }
}

export function completionContext(options) {
  const { ref, contract, run, declares, hasBacklink } = options;
  const github = contract.provider === "github";
  const repository = github ? ref.split("#")[0] : options.repository;
  const number = ref.split("#")[1];
  const environment = contract.lifecycle.productionEnvironment;
  const branch = [...contract.deployBranches].find(
    ([, env]) => env === environment
  )?.[0];
  requireProof(branch, "The configured production branch cannot be resolved.");
  function linear(query, variables, purpose) {
    try {
      return options.linear(query, variables, purpose);
    } catch (error) {
      if (error instanceof CompletionProofError) throw error;
      throw new CompletionProofError(
        query.startsWith("mutation") ? WRITE_ERROR : READ_ERROR,
        `The required native ${purpose} did not complete; restore Linear access and retry canonical verification.`
      );
    }
  }
  function gh(args, { write = false, input } = {}) {
    const result = run("gh", args, {
      allowFailure: true,
      input,
      maxBuffer: MAX_NATIVE_JSON_BYTES,
    });
    if (
      result.status !== 0 ||
      result.error ||
      Buffer.byteLength(result.stdout ?? "") > MAX_NATIVE_JSON_BYTES
    )
      throw new CompletionProofError(
        write ? WRITE_ERROR : READ_ERROR,
        `The required native ${write ? "proof publication" : "work-item proof read"} did not complete.`
      );
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new CompletionProofError(
        READ_ERROR,
        "A native work-item proof response is not complete JSON."
      );
    }
  }
  function readSubject() {
    if (github) {
      const issue = gh([
        "issue",
        "view",
        number,
        "--repo",
        repository,
        "--json",
        "id,number,url,body,comments,labels,state,stateReason,assignees,updatedAt,closedByPullRequestsReferences",
      ]);
      requireProof(
        String(issue.number) === number && Array.isArray(issue.comments),
        "The native work-item proof read returned another item or unreadable comments."
      );
      return {
        native_id: issue.id,
        ref,
        body: issue.body ?? "",
        comments: issue.comments,
        labels: (issue.labels ?? []).map(row =>
          typeof row === "string" ? row : row.name
        ),
        state: issue.state,
        reason: issue.stateReason ?? "",
        assignees: issue.assignees ?? [],
        raw: issue,
      };
    }
    const issue = linear(
      "query($id:String!){issue(id:$id){id identifier description updatedAt team{key states{nodes{id name type}}} state{id name type} attachments{nodes{url}} comments(first:100){nodes{id body createdAt updatedAt user{id}} pageInfo{hasNextPage endCursor}}}}",
      { id: ref },
      "Linear completion proof read"
    ).issue;
    requireProof(
      issue?.identifier === ref && issue.team?.key === contract.teamKey,
      "The native Linear completion read returned another item or team."
    );
    return {
      native_id: issue.id,
      ref,
      body: issue.description ?? "",
      comments: issue.comments?.nodes ?? [],
      state: issue.state,
      raw: issue,
    };
  }
  function readComments() {
    if (github) {
      const pages = gh([
        "api",
        "--paginate",
        "--slurp",
        `repos/${repository}/issues/${number}/comments?per_page=100`,
      ]);
      requireProof(
        Array.isArray(pages) &&
          pages.length <= 100 &&
          pages.every(Array.isArray) &&
          pages.flat().length <= 10000 &&
          pages.flat().every(row => typeof row.body === "string"),
        "The native proof-locator comment pagination is incomplete or over its bound."
      );
      return pages.flat();
    }
    const comments = [];
    const seen = new Set();
    let after = null;
    for (let page = 0; page < 100; page += 1) {
      const result = linear(
        "query($id:String!,$after:String){issue(id:$id){comments(first:100,after:$after){nodes{id body createdAt updatedAt user{id}} pageInfo{hasNextPage endCursor}}}}",
        { id: ref, after },
        "Linear completion locator pagination"
      ).issue?.comments;
      requireProof(
        Array.isArray(result?.nodes) &&
          typeof result.pageInfo?.hasNextPage === "boolean",
        "The native Linear proof-locator pagination is incomplete."
      );
      comments.push(...result.nodes);
      requireProof(
        comments.length <= 10000,
        "The Linear proof-locator pagination exceeds its bound."
      );
      if (!result.pageInfo.hasNextPage) return comments;
      const cursor = result.pageInfo.endCursor;
      requireProof(
        typeof cursor === "string" && !seen.has(cursor),
        "Linear proof-locator pagination repeated or omitted a cursor."
      );
      seen.add(cursor);
      after = cursor;
    }
    throw new CompletionProofError(
      READ_ERROR,
      "The Linear proof-locator pagination exceeds its page bound."
    );
  }
  return {
    ref,
    provider: contract.provider,
    scope: github ? repository : `${contract.workspace}/${contract.teamKey}`,
    repository,
    environment,
    branch,
    suppliedPrUrl: options.prUrl,
    policy: options.config.verification?.completion ?? {},
    estimate: estimateSettings(options.config),
    release: resolveReleaseSetting(options.config),
    switchReferences: switchName =>
      trackedSwitchReferences(run, branch, switchName),
    run,
    declares,
    readSubject,
    readComments,
    hasBacklink: (subject, url) =>
      hasBacklink(
        {
          ...subject.raw,
          comments: github ? subject.comments : { nodes: subject.comments },
        },
        url
      ),
    trackerActor(githubActor) {
      return github
        ? String(githubActor)
        : String(
            linear("query{viewer{id}}", {}, "Linear proof publisher lookup")
              .viewer?.id
          );
    },
    postLocator(body, nativeId) {
      if (github)
        return gh(
          [
            "api",
            "--method",
            "POST",
            `repos/${repository}/issues/${number}/comments`,
            "--input",
            "-",
          ],
          { write: true, input: JSON.stringify({ body }) }
        );
      const result = linear(
        "mutation($input:CommentCreateInput!){commentCreate(input:$input){success comment{id body createdAt updatedAt user{id}}}}",
        { input: { issueId: nativeId, body } },
        "Linear completion proof publication"
      ).commentCreate;
      requireProof(
        result?.success === true && result.comment?.id,
        "The native Linear completion-proof publication failed.",
        WRITE_ERROR
      );
      return result.comment;
    },
  };
}

/** Read repository context and separately resolve configured GitHub Projects metadata. */
import type { Command } from "commander";
import { readGitHubIssueRelationships } from "./github-reader-relationships.js";
import {
  resolveGitHubReaderTarget,
  type GitHubIssueRef,
  type GitHubReaderProject,
} from "./github-reader-target.js";
import {
  githubReadError,
  graphql,
  nativeGitHubRead,
  responseObject,
  restPages,
  type GitHubRead,
} from "./github-reader-wire.js";

const ISSUE_FIELDS =
  "number,title,body,state,stateReason,author,assignees,labels,milestone,createdAt,updatedAt,closedAt,url,reactionGroups";

/**
 * Query only the configured Project and keep service failures separate.
 * @param read - Native GitHub reader.
 * @param project - Validated effective Project settings.
 * @returns Metadata with an explicit evidence status.
 */
async function readProject(
  read: GitHubRead,
  project: GitHubReaderProject | undefined
) {
  if (project === undefined) return { status: "unconfigured" } as const;
  const query = `query($login:String!,$number:Int!) {
    ${project.kind}(login:$login) { login projectV2(number:$number) { id title number url } }
  }`;
  try {
    const [page] = await graphql(read, query, {
      login: project.login,
      number: project.number,
    });
    const owner = responseObject(
      page?.[project.kind],
      "the configured Project owner"
    );
    const metadata = responseObject(
      owner.projectV2,
      "the configured Project metadata"
    );
    if (
      typeof owner.login !== "string" ||
      owner.login.toLowerCase() !== project.login.toLowerCase() ||
      metadata.number !== project.number ||
      typeof metadata.id !== "string" ||
      !metadata.id ||
      typeof metadata.title !== "string" ||
      typeof metadata.url !== "string"
    ) {
      throw new Error("GitHub did not verify the configured Project identity");
    }
    return { status: "verified", metadata } as const;
  } catch (error) {
    const message = githubReadError(error);
    if (project.required)
      throw new Error(`Required GitHub Project could not be read. ${message}`, {
        cause: error,
      });
    return { status: "unverified", warning: message } as const;
  }
}

/**
 * Read comments through all native pages and prove the number fetched.
 * @param read - Native GitHub reader.
 * @param route - Selected issue REST route.
 * @returns Complete native comments in provider order.
 */
async function issueComments(read: GitHubRead, route: string) {
  const comments = await restPages(read, `${route}/comments`);
  const total = await read(["api", route, "--jq", ".comments"]);
  if (total !== comments.length) {
    throw new Error(
      `GitHub issue comments are incomplete. Read ${comments.length} of ${String(total)}`
    );
  }
  return comments;
}

/**
 * Read core metadata through the same native issue selection on every path.
 * @param read - Native GitHub reader.
 * @param ref - Selected repository and issue number.
 * @returns Native issue metadata.
 */
async function readIssue(read: GitHubRead, ref: GitHubIssueRef) {
  const repo = `${ref.owner}/${ref.repo}`;
  const view = await read([
    "issue",
    "view",
    String(ref.number),
    "--repo",
    repo,
    "--json",
    ISSUE_FIELDS,
  ]);
  const issue = responseObject(view, "issue metadata");
  if (
    issue.number !== ref.number ||
    typeof issue.body !== "string" ||
    typeof issue.title !== "string"
  )
    throw new Error("GitHub did not verify the selected issue identity");
  return issue;
}

/**
 * Read the issue bundle without requesting any unconfigured services.
 * @param root - Current Lisa checkout.
 * @param input - Issue reference accepted by the GitHub reader.
 * @param read - Native read function, injectable for request-selection tests.
 * @returns Repository-native context and separately qualified Project metadata.
 */
export async function readGitHubIssue(
  root: string,
  input: string,
  read: GitHubRead = nativeGitHubRead(root)
) {
  const target = await resolveGitHubReaderTarget(root, input);
  const { owner, repo, number } = target.issue;
  await read(["auth", "status"]);
  const issue = await readIssue(read, target.issue);
  const project = await readProject(read, target.project);
  const [comments, relationships] = await Promise.all([
    issueComments(read, `repos/${owner}/${repo}/issues/${number}`),
    readGitHubIssueRelationships(read, target.issue),
  ]);
  return {
    ref: `${owner}/${repo}#${number}`,
    issue,
    comments,
    project,
    ...relationships,
  };
}

/**
 * Register the exact read-only command used by generated GitHub skills.
 * @param program - The Lisa CLI program.
 */
export function addGitHubReadIssueCommand(program: Command): void {
  program
    .command("github-read-issue")
    .description(
      "Read GitHub issue context and any configured Project metadata"
    )
    .argument(
      "<issue>",
      "Issue number, owner/repo#number, or a GitHub issue URL"
    )
    .action(async (issue: string) => {
      const result = await readGitHubIssue(process.cwd(), issue);
      console.log(JSON.stringify(result));
    });
}

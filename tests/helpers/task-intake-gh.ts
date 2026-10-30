/** Exact existing reader requests and complete synthetic vendor response objects. */
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  issueFields,
  prFields,
  graphQuery,
  historyQuery,
  pullRequestsQuery,
  queries,
  reviewThreadsQuery,
  threadCommentsQuery,
} from "../../plugins/src/base/skills/lisa-github-read-issue/read-contract.mjs";
import { taskFixture } from "./task-readiness-fixture.js";
export const intakeCommands = [
  `gh issue view 1 --repo fixture/project --json ${issueFields}`,
  "gh api repos/fixture/project/issues/1/comments --paginate --slurp | jq 'add // []'",
  "gh api repos/fixture/project/issues/1 --jq .comments",
  ...queries.map(
    (q: string) =>
      `gh api graphql --paginate --slurp -f query='${q}' -F org=fixture -F repo=project -F number=1`
  ),
  "gh api repos/fixture/project/issues/1/dependencies/blocked_by --paginate --slurp",
  "gh api repos/fixture/project/issues/1/dependencies/blocking --paginate --slurp",
  `gh issue view 2 --repo fixture/project --json ${issueFields}`,
  "gh api repos/fixture/project/issues/2/comments --paginate --slurp | jq 'add // []'",
  `gh pr view 3 --repo fixture/project --json ${prFields}`,
  `gh api graphql --paginate --slurp -f query='${reviewThreadsQuery}' -F org=fixture -F repo=project -F number=3`,
  `gh api graphql --paginate --slurp -f query='${threadCommentsQuery}' -F id=PRRT_fixture`,
];
const REPO = "fixture/project",
  PAGINATE = "--paginate";
export { intakeRaw } from "./task-intake-data.js";
import { intakeRaw, page } from "./task-intake-data.js";
const cases = [
  {
    argv: ["issue", "view", "1", "--repo", REPO, "--json", issueFields],
    output: intakeRaw.primary,
  },
  {
    argv: [
      "api",
      "repos/fixture/project/issues/1/comments",
      PAGINATE,
      "--slurp",
    ],
    output: intakeRaw.comments,
  },
  {
    argv: ["api", "repos/fixture/project/issues/1", "--jq", ".comments"],
    output: 2,
  },
  ...[graphQuery, historyQuery, pullRequestsQuery].map(
    (q: string, i: number) => ({
      argv: [
        "api",
        "graphql",
        PAGINATE,
        "--slurp",
        "-f",
        `query=${q}`,
        "-F",
        "org=fixture",
        "-F",
        "repo=project",
        "-F",
        "number=1",
      ],
      output: [intakeRaw.graph, intakeRaw.history, intakeRaw.pullRequests][i],
    })
  ),
  {
    argv: [
      "api",
      "repos/fixture/project/issues/1/dependencies/blocked_by",
      PAGINATE,
      "--slurp",
    ],
    output: intakeRaw.blockedBy,
  },
  {
    argv: [
      "api",
      "repos/fixture/project/issues/1/dependencies/blocking",
      PAGINATE,
      "--slurp",
    ],
    output: intakeRaw.blocking,
  },
  {
    argv: ["issue", "view", "2", "--repo", REPO, "--json", issueFields],
    output: intakeRaw.related,
  },
  {
    argv: [
      "api",
      "repos/fixture/project/issues/2/comments",
      PAGINATE,
      "--slurp",
    ],
    output: [[]],
  },
  {
    argv: ["pr", "view", "3", "--repo", REPO, "--json", prFields],
    output: {
      number: 3,
      title: "Related PR",
      state: "CLOSED",
      mergedAt: "2026-10-01T00:00:00Z",
      reviews: [],
      comments: [],
    },
  },
  {
    argv: [
      "api",
      "graphql",
      PAGINATE,
      "--slurp",
      "-f",
      `query=${reviewThreadsQuery}`,
      "-F",
      "org=fixture",
      "-F",
      "repo=project",
      "-F",
      "number=3",
    ],
    output: [
      {
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: page(false, "end"),
                nodes: [
                  {
                    id: "PRRT_fixture",
                    isResolved: false,
                    isOutdated: false,
                    comments: {
                      pageInfo: page(true, "next"),
                      nodes: [
                        {
                          body: "First full review comment",
                          author: { login: "fixture" },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      },
    ],
  },
  {
    argv: [
      "api",
      "graphql",
      PAGINATE,
      "--slurp",
      "-f",
      `query=${threadCommentsQuery}`,
      "-F",
      "id=PRRT_fixture",
    ],
    output: [
      {
        data: {
          node: {
            comments: {
              pageInfo: page(false, "end"),
              nodes: [
                {
                  body: "Second full review comment",
                  author: { login: "fixture" },
                },
              ],
            },
          },
        },
      },
    ],
  },
  { argv: ["api", "user"], output: { id: 17, login: "fixture" } },
  {
    argv: ["api", "repos/fixture/project"],
    output: {
      full_name: REPO,
      owner: { login: "fixture" },
      permissions: { pull: true },
    },
  },
];
/** Dispatch actual argv strictly; paginated/slurped raw pages remain unedited.
 * @param f - Owned installed fixture.
 * @param authenticated - Require matching synthetic native or child-environment access.
 */
export function installIntakeGh(
  f: ReturnType<typeof taskFixture>,
  authenticated = false
) {
  writeFileSync(
    path.join(f.env.PATH, "gh"),
    `#!${process.execPath}\nconst fs=require('node:fs'),cases=${JSON.stringify(cases)},a=process.argv.slice(2),r=cases.find(c=>JSON.stringify(c.argv)===JSON.stringify(a));if(!r)process.exitCode=64;else {const selected=process.env.GH_TOKEN===process.env.FIXTURE_SELECTED_GH&&!process.env.GITHUB_TOKEN,ok=!${authenticated}||selected||process.env.FIXTURE_NATIVE_AVAILABLE==='1';fs.appendFileSync(${JSON.stringify(path.join(f.root, "calls.jsonl"))},JSON.stringify({tool:'gh',label:'gh:'+a.slice(0,2).join(':'),argv:a,accepted:ok,selected_source:selected})+'\\n');if(!ok){process.stderr.write('synthetic authentication unavailable');process.exitCode=1;}else if(a[0]==='issue'&&process.env.FIXTURE_READ_FAILURE){process.stderr.write(process.env.FIXTURE_SELECTED_GH);process.exitCode=1;}else if(a[0]==='api'&&a[1]==='user'&&process.env.FIXTURE_INSTALLATION_TOKEN){process.stderr.write('synthetic installation token has no user endpoint');process.exitCode=1;}else {let output=r.output;if(a[0]==='api'&&a[1]==='user'&&process.env.FIXTURE_ACTOR_INVALID)output={id:0,login:'wrong'};if(a[0]==='api'&&a[1]==='repos/fixture/project'&&process.env.FIXTURE_GH_WRONG)output={...output,full_name:'other/project'};console.log(JSON.stringify(output));}}\n`,
    { mode: 0o755 }
  );
}

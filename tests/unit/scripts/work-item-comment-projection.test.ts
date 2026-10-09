/**
 * @file work-item-comment-projection.test.ts
 * @description Labelled fixture transport reaches the original native capture and canonical readers.
 * @remarks These disposable responses establish local behavior, never hosted provider authority.
 */
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  backlinkBody,
  githubBacklinkComments,
  githubBacklinkListArgs,
  githubIssueViewArgs,
  partitionBacklinks,
  run,
} from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";
import {
  createGhRequests,
  createGhState,
  observeGhResponse,
  prepareGhRequest,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-gh-requests.mjs";
import { cleanGitEnv } from "../../helpers/test-utils.js";
import { resolveGit } from "../../support/git-executable.js";

const repository = "acme/widgets";
const url = "https://github.com/acme/widgets/pull/12";
const sibling = "https://github.com/acme/widgets/pull/13";
const issueProjection =
  '.comments |= map(select(.body | contains("[lisa-pr-link]")))';
const pageProjection =
  '{sourceCount:length,comments:map(select(.body | contains("[lisa-pr-link]")))}';
const comments = Array.from({ length: 133 }, (_, index) => ({
  id: index + 1,
  body:
    index === 1
      ? backlinkBody(sibling)
      : index === 110
        ? `${backlinkBody(url)}\n`
        : index === 120
          ? `Human prose [lisa-pr-link] ${url} with <html>, "quotes", é and\nUnicode \u2028`
          : `[fixture checkpoint] ${"x".repeat(23_000)}`,
}));
const issue = {
  number: 42,
  url: "https://github.com/acme/widgets/issues/42",
  state: "OPEN",
  body: "Exact canonical body\n",
  labels: [{ name: "type:Bug" }, { name: "status:in-progress" }],
  comments,
  closedByPullRequestsReferences: [{ url }],
};
const subject = {
  phase: "publication-backlink",
  repository,
  tracker: repository,
  issue: "42",
  branch: `lisa/npm-${"a".repeat(64)}`,
  parent: "b".repeat(40),
  origin: { runId: "10", runAttempt: "1" },
  claim: "123",
  recovery: null,
  maintainer: "maintainer",
  pr: { number: "12", url },
  proofs: [],
};

/** The bounded source runner normalizes both streams even when native capture fails. */
interface NativeResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  error?: NodeJS.ErrnoException;
  stdout: string;
  stderr: string;
}

/** Native hierarchy responses share the same labelled issue fixture. */
type FixtureIssue = typeof issue & { children?: { state: string }[] };
let roots: string[] = [];
afterEach(() => {
  roots.forEach(root => rmSync(root, { recursive: true, force: true }));
  roots = [];
});

/** Execute only the closed query literals over labelled fixture data in a real child process. */
function fixture(value: FixtureIssue = issue, partial = false) {
  const root = mkdtempSync(join(tmpdir(), "lisa-comment-projection-"));
  const file = join(root, "gh-fixture.cjs");
  roots.push(root);
  writeFileSync(join(root, "issue.json"), JSON.stringify(value));
  writeFileSync(
    file,
    `#!${process.execPath}
const { readFileSync } = require("node:fs");
const value = JSON.parse(readFileSync(${JSON.stringify(join(root, "issue.json"))}, "utf8"));
const args = process.argv.slice(2);
const query = args.includes("--jq") ? args[args.indexOf("--jq") + 1] : null;
const select = values => values.filter(comment => comment.body.includes("[lisa-pr-link]"));
if (args[0] === "--version") process.stdout.write("gh version 2.96.0\\n");
else if (args[0] === "issue") {
  if (query && query !== ${JSON.stringify(issueProjection)}) process.exit(70);
  process.stdout.write(JSON.stringify(query ? { ...value, comments: select(value.comments) } : value));
} else if (args[1] === "graphql") process.stdout.write(JSON.stringify({ data: { repository: { issue: { subIssues: { nodes: ${JSON.stringify(value.children ?? [])}, pageInfo: { hasNextPage: false, endCursor: null } } } } } }));
else if (args[0] === "api") {
  if (query && query !== ${JSON.stringify(pageProjection)}) process.exit(70);
  const pages = Array.from({ length: Math.max(1, Math.ceil(value.comments.length / 100)) }, (_, index) => value.comments.slice(index * 100, (index + 1) * 100));
  const output = query ? pages.map(page => JSON.stringify({ sourceCount: page.length, comments: select(page) })).join("\\n") + "\\n" : JSON.stringify(pages);
  process.stdout.write(${partial} ? output.split("\\n")[0] + "\\n" : output);
  if (${partial}) process.exitCode = 1;
} else process.exit(70);
`
  );
  chmodSync(file, 0o755);
  return { root, file };
}

/** Keep the original capture and deadline, including native ENOBUFS/SIGKILL observation. */
function read(file: string, args: string[]): NativeResult {
  return run(file, args, {
    allowFailure: true,
    maxBuffer: 1_048_576,
    timeout: 30_000,
  }) as NativeResult;
}

/** Grant controls use the same completed response decoder as the canonical writer. */
function grant(result: ReturnType<typeof read>) {
  const scope = createGhRequests(subject);
  const state = createGhState(scope);
  observeGhResponse(
    scope,
    state,
    prepareGhRequest(scope, state, githubBacklinkListArgs(repository, "42")),
    result
  );
  return () =>
    prepareGhRequest(scope, state, [
      "api",
      "--method",
      "PATCH",
      "repos/acme/widgets/issues/comments/111",
      "--field",
      `body=${backlinkBody(url)}`,
    ]);
}

/** Invoke the shipped provenance entry against a disposable binding and native fixture process. */
function canonical(value: FixtureIssue = issue, foreign = false): NativeResult {
  const { root, file } = fixture(value);
  const env = cleanGitEnv(process.env);
  run(resolveGit(), ["init", "--initial-branch=feature"], { cwd: root, env });
  mkdirSync(join(root, ".git/lisa"));
  writeFileSync(
    join(root, ".git/lisa/work-item.json"),
    JSON.stringify({
      version: 1,
      branch: "feature",
      provider: "github",
      ref: "acme/widgets#42",
    })
  );
  const entry = pathToFileURL(
    resolve("all/copy-overwrite/scripts/lib/automation-provenance-local.mjs")
  ).href;
  const config = {
    tracker: "github",
    github: {
      org: "acme",
      repo: foreign ? "code" : "widgets",
      queueRepo: "widgets",
    },
    workItem: { verify: "full" },
  };
  const program = `import { canonicalContext } from ${JSON.stringify(entry)};
const result = canonicalContext("Work-Item: acme/widgets#42", ${JSON.stringify(config)}, { ghExecutable: ${JSON.stringify(file)} }, { workItem: "acme/widgets#42", queue: "acme/widgets" });
console.log(JSON.stringify(result.issue));`;
  return run(process.execPath, ["--input-type=module", "-e", program], {
    cwd: root,
    env,
    allowFailure: true,
  }) as NativeResult;
}

describe("large checkpoint history bounded canonical reads", () => {
  it("projects the original >2.9MB issue inside the unchanged native capture", () => {
    const { file } = fixture();
    expect(Buffer.byteLength(JSON.stringify(issue))).toBeGreaterThanOrEqual(
      2_900_394
    );
    const result = read(file, githubIssueViewArgs(repository, "42"));
    console.info("labelled issue native capture", {
      status: result.status,
      signal: result.signal,
      error: result.error?.code,
      bytes: Buffer.byteLength(result.stdout),
    });
    expect(result.status).toBe(0);
    expect(result.error).toBeUndefined();
    expect(JSON.parse(result.stdout)).toEqual({
      ...issue,
      comments: comments.filter(comment =>
        comment.body.includes("[lisa-pr-link]")
      ),
    });
  });

  it("projects all 133 original comments and finds only the later owned target", () => {
    const { file } = fixture();
    const result = read(file, githubBacklinkListArgs(repository, "42"));
    console.info("labelled backlink native capture", {
      status: result.status,
      signal: result.signal,
      error: result.error?.code,
      bytes: Buffer.byteLength(result.stdout),
    });
    expect(result.status).toBe(0);
    expect(result.error).toBeUndefined();
    const retained = githubBacklinkComments(result.stdout);
    expect(
      result.stdout
        .trim()
        .split("\n")
        .map(line => JSON.parse(line).sourceCount)
    ).toEqual([100, 33]);
    expect(retained).toEqual([comments[1], comments[110], comments[120]]);
    expect(
      partitionBacklinks(retained, url, comment =>
        comment && typeof comment === "object" && "body" in comment
          ? comment.body
          : undefined
      )
    ).toEqual({ mine: comments[110], others: 1 });
    expect(grant(result)().kind).toBe("write");
  });

  it("runs the actual provenance canonical resolver and preserves native closing references", () => {
    const result = canonical();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      ...issue,
      comments: [comments[1], comments[110], comments[120]],
    });
  });

  it("still refuses closed, foreign, wrong, non-leaf and unclaimed canonical issues", () => {
    const cases: [FixtureIssue, boolean, RegExp][] = [
      [{ ...issue, state: "CLOSED" }, false, /closed/],
      [issue, true, /not scoped/],
      [{ ...issue, number: 43 }, false, /wrong issue/],
      [{ ...issue, children: [{ state: "OPEN" }] }, false, /container/],
      [
        {
          ...issue,
          labels: [{ name: "type:Epic" }, { name: "status:in-progress" }],
        },
        false,
        /container/,
      ],
      [{ ...issue, labels: [{ name: "type:Bug" }] }, false, /not claimed/],
      [
        { ...issue, labels: [...issue.labels, { name: "status:ready" }] },
        false,
        /competing lifecycle/,
      ],
    ];
    for (const [value, foreign, reason] of cases) {
      const result = canonical(value, foreign);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(reason);
    }
  });

  it("refuses native partial pagination and oversized relevant bodies before granting a writer", () => {
    const partial = fixture(issue, true);
    expect(
      grant(read(partial.file, githubBacklinkListArgs(repository, "42")))
    ).toThrow(/request/);
    const oversized = fixture({
      ...issue,
      comments: [
        { id: 111, body: `${backlinkBody(url)}\n${"x".repeat(1_048_576)}` },
      ],
    });
    const result = read(
      oversized.file,
      githubBacklinkListArgs(repository, "42")
    );
    expect(result.error?.code).toBe("ENOBUFS");
    expect(grant(result)).toThrow(/request/);
    expect(
      read(oversized.file, githubIssueViewArgs(repository, "42")).error?.code
    ).toBe("ENOBUFS");
    const complete = read(
      fixture().file,
      githubBacklinkListArgs(repository, "42")
    );
    expect(grant({ ...complete, signal: "SIGKILL" })).toThrow(/request/);
    expect(grant({ ...complete, error: new Error("native failure") })).toThrow(
      /request/
    );
  });
});

describe("complete bounded JSONL candidate envelopes", () => {
  it("allows empty and exact-full final pages and native JSON escaping without changing first-target selection", () => {
    expect(githubBacklinkComments('{"sourceCount":0,"comments":[]}\n')).toEqual(
      []
    );
    const duplicate = { id: "112", body: `${backlinkBody(url)}\n` };
    const candidate = {
      id: "113",
      body: '[lisa-pr-link] prose <tag> "quoted" é\u2028\n',
    };
    const data = JSON.stringify({
      sourceCount: 100,
      comments: [comments[110], duplicate, candidate],
    })
      .replace("<tag>", "\\u003ctag\\u003e")
      .replace("é", "\\u00e9")
      .replace("\u2028", "\\u2028");
    const retained = githubBacklinkComments(`${data}\n`);
    expect(retained).toEqual([comments[110], duplicate, candidate]);
    expect(
      partitionBacklinks(retained, url, comment =>
        comment && typeof comment === "object" && "body" in comment
          ? comment.body
          : undefined
      ).mine
    ).toEqual(comments[110]);
    expect(
      githubBacklinkComments(
        Array(100).fill('{"sourceCount":100,"comments":[]}').join("\n")
      )
    ).toEqual([]);
    expect(
      githubBacklinkComments(
        '{"sourceCount":2,"comments":[]}\n{"sourceCount":33,"comments":[]}\n'
      )
    ).toEqual([]);
  });

  it("refuses malformed, missing, extra, over-bound and incomplete page evidence", () => {
    for (const output of [
      "",
      "[]",
      "{}",
      '{"sourceCount":0,"comments":[],"extra":true}',
      '{"sourceCount":101,"comments":[]}',
      '{"sourceCount":-1,"comments":[]}',
      '{"sourceCount":1.5,"comments":[]}',
      '{"sourceCount":"1","comments":[]}',
      JSON.stringify({ sourceCount: 0, comments: [comments[110]] }),
      JSON.stringify({
        sourceCount: 1,
        comments: [{ id: 0, body: backlinkBody(url) }],
      }),
      JSON.stringify({
        sourceCount: 1,
        comments: [{ id: 1, body: "checkpoint" }],
      }),
      JSON.stringify({ sourceCount: 1, comments: [{ id: 1, body: null }] }),
      JSON.stringify({
        sourceCount: 1,
        comments: [
          { id: Number.MAX_SAFE_INTEGER + 1, body: backlinkBody(url) },
        ],
      }),
      Array(101).fill('{"sourceCount":100,"comments":[]}').join("\n"),
      '{"sourceCount":100,"comments":[]}\n{"sourceCount":1',
    ]) {
      expect(() => githubBacklinkComments(output)).toThrow();
      expect(() =>
        grant({ status: 0, signal: null, stdout: output, stderr: "" })()
      ).toThrow();
    }
  });

  it("admits only the fixed projection and exact repository, ticket and phase", () => {
    const args = githubBacklinkListArgs(repository, "42");
    const issueArgs = githubIssueViewArgs(repository, "42");
    const scope = createGhRequests(subject);
    for (const altered of [
      args.map(value => (value === pageProjection ? ".[]" : value)),
      [...args, "--jq", pageProjection],
      githubBacklinkListArgs(repository, "43"),
      githubBacklinkListArgs("acme/foreign", "42"),
      issueArgs.map(value => (value === issueProjection ? ".body" : value)),
      [...issueArgs, "--json", "body"],
    ])
      expect(() =>
        prepareGhRequest(scope, createGhState(scope), altered)
      ).toThrow();
    for (const phase of [
      "stage-read",
      "hook-read",
      "publication-validate-pr",
    ]) {
      const other = createGhRequests({ ...subject, phase });
      expect(() =>
        prepareGhRequest(other, createGhState(other), args)
      ).toThrow();
    }
  });
});

/** Canonical resolver projection with synthetic provider responses grants no tracker authority. */
import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  withPrivateRoot,
  runProcess,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";
import {
  githubIssueViewArgs,
  githubHierarchyArgs,
} from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";
const repository = "acme/widgets";

describe("canonical recovery issue body", () => {
  it("shares the exact canonical issue and typed hierarchy argument grammar", () => {
    expect(githubIssueViewArgs(repository, "42")).toEqual([
      "issue",
      "view",
      "42",
      "--repo",
      repository,
      "--json",
      "number,url,state,body,labels,comments,closedByPullRequestsReferences",
      "--jq",
      '.comments |= map(select(.body | contains("[lisa-pr-link]")))',
    ]);
    const first = githubHierarchyArgs({ repository }, "42");
    expect(first.slice(0, 3)).toEqual(["api", "graphql", "-f"]);
    expect(first.slice(4)).toEqual([
      "-F",
      "owner=acme",
      "-F",
      "repo=widgets",
      "-F",
      "number=42",
    ]);
    expect(githubHierarchyArgs({ repository }, "42", "opaque-cursor")).toEqual([
      ...first,
      "-F",
      "after=opaque-cursor",
    ]);
  });
  it("requests the actual body through the existing live resolver and preserves it", async () => {
    const entry = pathToFileURL(
      resolve("all/copy-overwrite/scripts/lisa-work-item.mjs")
    ).href;
    await withPrivateRoot(async (root, env) => {
      await runProcess("git", ["init", "--initial-branch=feature"], {
        cwd: root,
        env,
      });
      mkdirSync(join(root, ".git/lisa"));
      // Disposable fixture state, not an operator claim or a real work-item binding.
      writeFileSync(
        join(root, ".git/lisa/work-item.json"),
        JSON.stringify({
          version: 1,
          branch: "feature",
          provider: "github",
          ref: "acme/widgets#42",
        })
      );
      const program = `import { resolveWorkItemContext } from ${JSON.stringify(entry)};
const fields = [];
const context = resolveWorkItemContext('Work-Item: acme/widgets#42', {
  config: { tracker: 'github', github: { org: 'acme', repo: 'widgets' }, workItem: { verify: 'full' } },
  requireLive: true,
  execute: (command, args) => {
    if (args[0] === '--version') return { status: 0, stdout: 'gh version 2.96.0' };
    if (args[0] === 'issue') {
      fields.push(args[args.indexOf('--json') + 1]);
      const issue = { number: 42, state: 'OPEN', labels: [{ name: 'type:Task' }], comments: [] };
      if (args[args.indexOf('--json') + 1].split(',').includes('body')) issue.body = 'Exact current leaf body\\n';
      return { status: 0, stdout: JSON.stringify(issue) };
    }
    return { status: 0, stdout: JSON.stringify({ data: { repository: { issue: { subIssues: { nodes: [] } } } } }) };
  },
});
console.log(JSON.stringify({ fields, body: context.issue.body }));`;
      const result = await runProcess(
        process.execPath,
        ["--input-type=module", "-e", program],
        {
          cwd: root,
          env,
        }
      );
      const projection = JSON.parse(result.stdout.toString());
      expect(projection.fields).toEqual([
        "number,url,state,body,labels,comments,closedByPullRequestsReferences",
      ]);
      expect(projection.body).toBe("Exact current leaf body\n");
    });
  });
});

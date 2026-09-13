/** Executable coverage for adapters copied from the access and repair contracts. */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const root = path.resolve("plugins/src/base");
const scratch: string[] = [];
const fixture = (): string => {
  const directory = mkdtempSync(path.join(tmpdir(), "lisa-access-doc-"));
  scratch.push(directory);
  return directory;
};
const block = (skill: string, marker: string): string => {
  const doc = readFileSync(
    path.join(root, "skills", skill, "SKILL.md"),
    "utf8"
  );
  const start = doc.indexOf(marker);
  return doc.slice(start, doc.indexOf("\n```", start));
};
const run = (cwd: string, source: string) => {
  const script = path.join(cwd, "adapter.sh");
  writeFileSync(script, source);
  return spawnSync("/bin/bash", [script], {
    cwd,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: "", PLUGIN_ROOT: "" },
    encoding: "utf8",
    timeout: 10000,
  });
};
afterEach(() => {
  for (const directory of scratch.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const page = (count: number, next: boolean, cursor: string | null) => ({
  nodes: Array.from({ length: count }, (_, id) => ({ id: String(id) })),
  pageInfo: { hasNextPage: next, endCursor: cursor },
});
const comments = (pages: unknown[], anchor = "project") => {
  const cwd = fixture();
  writeFileSync(path.join(cwd, "pages.json"), JSON.stringify(pages));
  return run(
    cwd,
    `${block("lisa-linear-access", "linear_list_comment_pages()")}
linear_graphql() {
  printf '%s\\n' "$2" >> requests.jsonl
  local index
  index=$(wc -l < requests.jsonl)
  jq -c --argjson index "$index" '.[$index - 1]' pages.json
}
linear_list_comment_pages ${anchor} example-id
`
  );
};

describe("documented complete comment reads", () => {
  it.each([0, 100])("returns all %i comments in a terminal page", count => {
    const result = comments([
      { data: { project: { comments: page(count, false, null) } } },
    ]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toHaveLength(count);
  });
  it.each(["project", "issue"])(
    "advances the cursor for %s and aggregates 101 comments",
    anchor => {
      const result = comments(
        [
          { data: { [anchor]: { comments: page(100, true, "next") } } },
          { data: { [anchor]: { comments: page(1, false, null) } } },
        ],
        anchor
      );
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toHaveLength(101);
      const requests = readFileSync(
        path.join(scratch.at(-1)!, "requests.jsonl"),
        "utf8"
      )
        .trim()
        .split("\n")
        .map(value => JSON.parse(value));
      expect(requests).toEqual([
        { id: "example-id", after: null },
        { id: "example-id", after: "next" },
      ]);
    }
  );
  it.each([
    { errors: [{ message: "later page failed" }] },
    { data: { project: { comments: page(1, true, "next") } } },
    { data: { project: { comments: page(1, true, null) } } },
    { data: { project: { comments: { nodes: [] } } } },
  ])(
    "fails without publishing partial history on an incomplete page",
    later => {
      const result = comments([
        { data: { project: { comments: page(100, true, "next") } } },
        later,
      ]);
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
    }
  );
});

describe("documented blocker module invocation", () => {
  it("imports the npm helper without a plugin root or host script", () => {
    const cwd = fixture();
    const target = path.join(
      cwd,
      "node_modules/@codyswann/lisa/plugins/lisa/scripts"
    );
    mkdirSync(target, { recursive: true });
    copyFileSync(
      path.join(root, "scripts/blocker-edge-resolution.mjs"),
      path.join(target, "blocker-edge-resolution.mjs")
    );
    writeFileSync(
      path.join(cwd, "edges.json"),
      JSON.stringify([
        { contained: true, blockerState: "closed", blockerReason: "completed" },
      ])
    );
    const result = run(
      cwd,
      `${block("lisa-repair-intake", "resolve_blocker_guard()")}
blocker_edge_decisions edges.json
`
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      proceed: true,
      decisions: [{ action: "dissolve" }],
    });
  });
  it("refuses an absent helper without producing decisions", () => {
    const result = run(
      fixture(),
      `${block("lisa-repair-intake", "resolve_blocker_guard()")}
blocker_edge_decisions edges.json
`
    );
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("refusing repair");
  });
});

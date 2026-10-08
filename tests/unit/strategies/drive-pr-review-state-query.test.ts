/** Execute the shipped merge-readiness reads against complete and failed API observations. */
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

useIoLatencyBudget();

const skill = readFileSync(
  path.resolve("plugins/src/base/skills/lisa-drive-pr-to-merge/SKILL.md"),
  "utf8"
);
const roots: string[] = [];
const CHANGES_REQUESTED = "CHANGES_REQUESTED";
const UNKNOWN_READINESS = "merge readiness is unknown";

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/**
 * Read the actual executable snippet at either merge-readiness boundary.
 * @param heading - Required section heading.
 * @returns The shipped shell read with fixture repository coordinates.
 */
function snippet(heading: string): string {
  const section = skill.indexOf(`\n### ${heading}`);
  const start = skill.indexOf("```bash\n", section) + "```bash\n".length;
  const end = skill.indexOf("\n```", start);
  expect(section).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return skill
    .slice(start, end)
    .replaceAll("<owner>", "fixture-owner")
    .replaceAll("<repo>", "fixture-repo")
    .replaceAll("<pr>", "42");
}

/**
 * One successful GraphQL page, with cursor and review metadata intact.
 * @param unresolved - Unresolved threads on this page.
 * @param hasNextPage - Whether the API has another page.
 * @returns A complete native API response shape.
 */
function page(unresolved: readonly boolean[], hasNextPage = false) {
  return {
    data: {
      repository: {
        pullRequest: {
          state: "OPEN",
          reviewDecision: CHANGES_REQUESTED,
          autoMergeRequest: { enabledAt: "2026-10-07T00:00:00Z" },
          reviewThreads: {
            nodes: unresolved.map(isUnresolved => ({
              isResolved: !isUnresolved,
              isOutdated: isUnresolved,
            })),
            pageInfo: {
              hasNextPage,
              endCursor: hasNextPage ? "next-page" : null,
            },
          },
        },
      },
    },
  };
}

/**
 * Run the documented script with a provider response or explicit API failure.
 * @param code - The actual shell snippet.
 * @param pages - Responses returned by the provider fixture.
 * @param apiExit - Provider command exit status.
 * @returns Native shell completion, including validation diagnostics.
 */
function runRead(code: string, pages: unknown, apiExit = 0) {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-pr-review-state-"));
  const script = path.join(root, "read.sh");
  const response = path.join(root, "pages.json");
  const provider = path.join(root, "gh");
  roots.push(root);
  writeFileSync(script, code);
  writeFileSync(response, JSON.stringify(pages));
  writeFileSync(
    provider,
    `#!/bin/sh
if [ "$1 $2" != "api graphql" ]; then
  printf '%s\\n' 'Unsupported provider read' >&2
  exit 77
fi
if [ "${apiExit}" != 0 ]; then
  printf '%s\\n' 'Provider access refused' >&2
  exit ${apiExit}
fi
cat "$REVIEW_FIXTURE_RESPONSE"
`
  );
  chmodSync(provider, 0o755);
  return boundedSpawnSync({
    label: "shipped PR review-state read",
    command: "/bin/bash",
    args: [script],
    cwd: root,
    env: {
      ...process.env,
      PATH: `${root}:${process.env.PATH}`,
      REVIEW_FIXTURE_RESPONSE: response,
    },
  });
}

describe.each([
  "The mergeability gate — never arm a PR that cannot merge",
  "Before you stop: never leave a PR armed and unmergeable in silence",
])("shipped review read: %s", heading => {
  const code = snippet(heading);

  it("counts unresolved threads on later pages, including outdated threads", () => {
    const result = runRead(code, [
      page(
        Array.from({ length: 100 }, () => false),
        true
      ),
      page([true]),
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      state: "OPEN",
      armed: true,
      decision: CHANGES_REQUESTED,
      unresolved: 1,
    });
  });

  it("reports a complete zero-thread read without changing the review verdict", () => {
    const result = runRead(code, [page([])]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).unresolved).toBe(0);
    expect(JSON.parse(result.stdout).decision).toBe(CHANGES_REQUESTED);
  });

  it("refuses an API command failure instead of reporting zero threads", () => {
    const result = runRead(code, [], 1);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(UNKNOWN_READINESS);
  });

  it("accepts explicit null review and auto-merge decisions", () => {
    const response = page([]);
    const pr = {
      ...response.data.repository.pullRequest,
      reviewDecision: null,
      autoMergeRequest: null,
    };
    const result = runRead(code, [
      { data: { repository: { pullRequest: pr } } },
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      state: "OPEN",
      armed: false,
      decision: null,
      unresolved: 0,
    });
  });

  it.each(["state", "reviewDecision", "autoMergeRequest"])(
    "refuses missing %s metadata",
    field => {
      const response = page([]);
      const pr = response.data.repository.pullRequest;
      const incomplete = Object.fromEntries(
        Object.entries(pr).filter(([key]) => key !== field)
      );
      const result = runRead(code, [
        { data: { repository: { pullRequest: incomplete } } },
      ]);
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(UNKNOWN_READINESS);
    }
  );

  it.each([{}, { isResolved: null }, { isResolved: false }])(
    "refuses incomplete thread metadata %j",
    thread => {
      const response = page([]);
      const pr = response.data.repository.pullRequest;
      const result = runRead(code, [
        {
          data: {
            repository: {
              pullRequest: {
                ...pr,
                reviewThreads: { ...pr.reviewThreads, nodes: [thread] },
              },
            },
          },
        },
      ]);
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(UNKNOWN_READINESS);
    }
  );

  it.each([
    { label: "empty pages", pages: [] },
    {
      label: "GraphQL errors",
      pages: [
        { errors: [{ message: "Incomplete provider response" }], ...page([]) },
      ],
    },
    {
      label: "missing pull request",
      pages: [{ data: { repository: { pullRequest: null } } }],
    },
    { label: "incomplete pagination", pages: [page([], true)] },
  ])("refuses $label", ({ pages }) => {
    const result = runRead(code, pages);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(UNKNOWN_READINESS);
  });
});

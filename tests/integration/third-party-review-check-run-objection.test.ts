/**
 * Recognising review WORK never overrides a substantive objection.
 *
 * The prover answers one question — did the declared reviewer do review work
 * at this head, or does a substitute stand in? — and nothing else
 * (CodySwannGT/lisa#4553). A `CHANGES_REQUESTED` review and an unresolved
 * thread are the caller's to weigh: the merge path's review evidence gate and
 * the merge driver's own readiness read both see them independently. These
 * controls run all three against the same head: the prover reports work,
 * reads no review object and writes nothing, and both caller surfaces still
 * report the objection.
 * @module tests/integration/third-party-review-check-run-objection
 */
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { runTerminalReview } from "../helpers/review-terminal-fixture.js";
import {
  COMPLETED_SUMMARY,
  FINISHED,
  HEAD,
  rawCheckRun,
  ROUTES,
  routesRead,
  runThirdPartyReviewCli,
} from "../helpers/third-party-review-cli-fixture.js";

useIoLatencyBudget();

const ROOT = path.resolve(import.meta.dirname, "../..");

/** A current-head objection, as the reviews API returns one. */
const OBJECTION = {
  id: 5720006794,
  state: "CHANGES_REQUESTED",
  commit_id: HEAD,
  user: { login: "coderabbitai[bot]" },
  body: "Two security objections remain in review threads.",
};

/**
 * Run the merge driver's own readiness read against one GraphQL page.
 *
 * The snippet is the executable block `lisa-drive-pr-to-merge` ships under its
 * mergeability gate, read from the skill source rather than restated here, so
 * this control exercises what the merge path actually runs.
 * @param pullRequest - The native `pullRequest` object one page returns
 * @returns The readiness summary the shipped read prints
 */
function mergeReadiness(pullRequest: object): unknown {
  const skill = fs.readFileSync(
    path.join(ROOT, "plugins/src/base/skills/lisa-drive-pr-to-merge/SKILL.md"),
    "utf8"
  );
  const section = skill.indexOf(
    "\n### The mergeability gate — never arm a PR that cannot merge"
  );
  const start = skill.indexOf("```bash\n", section) + "```bash\n".length;
  const code = skill
    .slice(start, skill.indexOf("\n```", start))
    .replaceAll("<owner>", "acme")
    .replaceAll("<repo>", "code")
    .replaceAll("<pr>", "4618");
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "merge-readiness-"));
  try {
    fs.writeFileSync(path.join(folder, "read.sh"), code);
    fs.writeFileSync(
      path.join(folder, "page.json"),
      JSON.stringify([{ data: { repository: { pullRequest } } }])
    );
    fs.writeFileSync(
      path.join(folder, "gh"),
      `#!/bin/sh\n[ "$1 $2" = "api graphql" ] || exit 77\ncat "${path.join(folder, "page.json")}"\n`,
      { mode: 0o755 }
    );
    const result = boundedSpawnSync({
      label: "the merge driver's shipped readiness read",
      command: "/bin/bash",
      args: [path.join(folder, "read.sh")],
      cwd: folder,
      env: {
        ...process.env,
        PATH: `${folder}${path.delimiter}${process.env.PATH ?? ""}`,
      },
      baseMs: 30000,
    });
    expect(result.status, String(result.stderr)).toBe(0);
    return JSON.parse(String(result.stdout));
  } finally {
    fs.removeSync(folder);
  }
}

describe("review work never overrides a substantive objection", () => {
  it("records review work only, reading no review object and writing nothing", () => {
    const result = runThirdPartyReviewCli(
      { checkRuns: [rawCheckRun()], reviews: [OBJECTION] },
      process.env
    );

    expect(result.verdict.outcome).toBe("satisfied");
    expect(routesRead(result)).not.toContain(ROUTES.reviews);
    expect(routesRead(result)).not.toContain("graphql");
    // Every call is a plain read: `api <path>`, or the paginated comment read
    // `api --paginate --slurp <path>` (#4628). Neither carries a method or a
    // field, so nothing here can write.
    for (const call of result.calls) {
      expect([
        ["api", call.argv.at(-1)],
        ["api", "--paginate", "--slurp", call.argv.at(-1)],
      ]).toContainEqual(call.argv);
    }
    expect(JSON.stringify(result.verdict)).not.toMatch(/approv|decision/iu);
  });

  it.each([
    ["passes a clean head", "clean", 0],
    ["keeps blocking a head objection", "objection", 1],
  ] as const)(
    "leaves the merge path's review evidence gate in charge: the completed run %s",
    (_name, surface, exit) => {
      const result = runTerminalReview(
        {
          state: "success",
          title: FINISHED,
          summary: COMPLETED_SUMMARY,
          surface,
        },
        process.env
      );

      expect(result.status).toBe(exit);
    }
  );

  // This case proves independence, not interaction: the merge driver's
  // readiness read takes no input from the prover at all, so the evidence
  // verdict for the same head cannot clear the objection or its threads.
  it("leaves the merge driver's readiness read, which takes nothing from the prover, reporting the objection and its threads", () => {
    const evidence = runThirdPartyReviewCli(
      { checkRuns: [rawCheckRun()], reviews: [OBJECTION] },
      process.env
    );
    const readiness = mergeReadiness({
      state: "OPEN",
      reviewDecision: "CHANGES_REQUESTED",
      autoMergeRequest: null,
      reviewThreads: {
        nodes: [
          { isResolved: false, isOutdated: false },
          { isResolved: false, isOutdated: false },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

    expect(evidence.verdict.outcome).toBe("satisfied");
    expect(readiness).toEqual({
      state: "OPEN",
      armed: false,
      decision: "CHANGES_REQUESTED",
      unresolved: 2,
    });
  });
});

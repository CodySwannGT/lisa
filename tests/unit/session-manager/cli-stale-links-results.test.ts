/**
 * The real CLI after a stale-link clean-up's writes (CodySwannGT/lisa#5065):
 * `stale-links-verify` confirms removals from a read-back and records the
 * comment as owed, `stale-links-pending` / `stale-links-posted` keep and
 * settle it, and `stale-links-report` summarizes verified results only.
 * @module tests/unit/session-manager/cli-stale-links-results
 */
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  makeSandbox,
  removeSandboxes,
  writeJson,
} from "./support/cli-harness.js";
import { runStubOnly as run } from "./support/human-sandbox.js";

afterEach(removeSandboxes);

const POSTED = "stale-links-posted";
const DONE = { name: "Done", statusCategory: { key: "done" } };

/**
 * A raw Jira item blocked by the given finished keys.
 * @param keys - Blocker keys, one link each
 * @returns Raw issue
 */
function jira(keys: string[]) {
  return {
    key: "ABC-1",
    fields: {
      status: { name: "Ready" },
      issuelinks: keys.map((key, index) => ({
        id: String(index + 1),
        type: { inward: "is blocked by" },
        inwardIssue: { key, fields: { status: DONE } },
      })),
    },
    comments: [],
  };
}

describe("stale-links-verify, pending, posted and report", () => {
  it("confirms from the read-back, owes the comment, and reports verified counts", () => {
    const sandbox = makeSandbox({
      extraConfig: {
        tracker: "jira",
        jira: { workflow: { ready: "Ready", blocked: "Blocked" } },
      },
    });
    const file = (name: string, value: unknown) => {
      const target = path.join(sandbox.root, name);
      writeJson(target, value);
      return target;
    };
    const plan = run(sandbox, [
      "stale-links-plan",
      "--input",
      file("links.json", { complete: true, items: [jira(["ABC-9", "ABC-8"])] }),
    ]);
    expect(plan.status).toBe(0);
    const [entry] = plan.json.plans;

    // Only ABC-9's deletion landed.
    const verify = run(sandbox, [
      "stale-links-verify",
      "--plan",
      file("entry.json", entry),
      "--input",
      file("after.json", jira(["ABC-8"])),
    ]);
    expect(verify.status).toBe(0);
    expect(verify.json).toMatchObject({
      confirmed: ["ABC-9"],
      stillPresent: ["ABC-8"],
      pending: true,
    });
    expect(verify.json.comment).not.toContain("blocker=ABC-8");

    const owed = run(sandbox, ["stale-links-pending"]);
    expect(owed.json.pending).toMatchObject([
      { ref: "ABC-1", removed: ["ABC-9"] },
    ]);
    const failed = run(sandbox, [POSTED, "--ref", "ABC-1", "--failed"]);
    expect(failed.json.pending[0].attempts).toBe(1);
    run(sandbox, [POSTED, "--ref", "ABC-1"]);
    expect(run(sandbox, ["stale-links-pending"]).json.pending).toEqual([]);

    const report = run(sandbox, [
      "stale-links-report",
      "--input",
      file("results.json", {
        report: plan.json.report,
        results: [verify.json],
      }),
    ]);
    expect(report.json.summary).toMatch(
      /^stale links: cleared 1 stale blocker link on 1 item; 1 now ready to start; 1 planned removal not done \(retried next cycle\);/u
    );
  });

  it("refuses missing inputs", () => {
    const sandbox = makeSandbox({ extraConfig: { tracker: "jira" } });
    expect(run(sandbox, ["stale-links-verify"]).status).toBe(2);
    expect(run(sandbox, [POSTED]).status).toBe(2);
    expect(run(sandbox, ["stale-links-report"]).status).toBe(2);
  });
});

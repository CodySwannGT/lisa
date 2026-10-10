/** Independent feature changes must merge without regenerating conflicted reports. */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import {
  FEATURE_FILES,
  aggregate,
  cli,
  expectedOutputPaths,
  git,
  makeHistory,
  reportSnapshot,
  successful,
  writeReports,
} from "./bdd/projection-merge-support.js";
import type {
  AggregateReport,
  MergeHistory,
} from "./bdd/projection-merge-support.js";
import { MAP_REL } from "./bdd/support.js";

useIoLatencyBudget();

const ORDERS = ["alpha then omega", "omega then alpha"] as const;

/** Check full union and the unchanged runtime bar, without claiming tests ran. */
function expectUnion(report: AggregateReport): void {
  expect(report.schemaVersion).toBe(3);
  expect(report.scenarios).toMatchObject({
    declared: 11,
    required: 11,
    excluded: 0,
  });
  expect(report.traceability.overall).toEqual({
    covered: 11,
    total: 11,
    percentage: 100,
    exact: 100,
  });
  expect(report.floor.ok).toBe(true);
  expect(report.floor.byPlatform.web!.floor).toBe(100);
  expect(report.execution).toMatchObject({ supplied: false, mappedTests: 11 });
  expect(report.execution).not.toHaveProperty("passed");
  expect(report.gaps).toEqual([]);
  expect(report.testInventory).toMatchObject({
    discovered: 11,
    disclosed: 11,
    undisclosed: [],
  });
}

/** Ordinary merge only: a failure is inspected before any writer can run again. */
function merge(history: MergeHistory, order: (typeof ORDERS)[number]): void {
  const { root, base, alpha, omega } = history;
  expect(successful(git(root, ["merge-base", alpha, omega]))).toBe(base);
  expect(successful(git(root, ["show", "-s", "--format=%an", alpha]))).toBe(
    "Fixture Author 0"
  );
  expect(successful(git(root, ["show", "-s", "--format=%an", omega]))).toBe(
    "Fixture Author 2"
  );
  const tips = order === ORDERS[0] ? [alpha, omega] : [omega, alpha];
  successful(git(root, ["checkout", "-q", "-b", "merge-proof", tips[0]!]));
  const result = git(root, ["merge", "--no-ff", "--no-edit", tips[1]!]);
  const unmerged = successful(
    git(root, ["diff", "--name-only", "--diff-filter=U"])
  );
  // A generated conflict cannot be blamed on the shared project-owned input.
  expect(unmerged.split("\n")).not.toContain(MAP_REL);
  expect(
    result.status,
    `ordinary ${order}; unmerged: ${unmerged}\n${result.stdout}\n${result.stderr}`
  ).toBe(0);
  expect(unmerged).toBe("");
  expect(successful(git(root, ["status", "--porcelain"]))).toBe("");
  expect(
    successful(git(root, ["show", "-s", "--format=%P", "HEAD"])).split(" ")
  ).toEqual(tips);
}

describe("BDD committed feature projection ordinary Git merges", () => {
  it.each(ORDERS)("the real input map and scenario union merge: %s", order => {
    const history = makeHistory(false);
    merge(history, order);
    expectUnion(aggregate(history.root, history.base));
  });

  it.each(ORDERS)(
    "all generated reports merge and remain byte-fresh: %s",
    order => {
      const history = makeHistory(true);
      const { root, base, alpha, omega } = history;
      // The isolated repository has no custom merge driver or BDD merge attribute.
      const drivers = git(root, ["config", "--get-regexp", "^merge\\."]);
      expect(drivers.status).toBe(1);
      expect(drivers.stdout).toBe("");
      for (const tip of [alpha, omega]) {
        const attributes = successful(
          git(root, ["check-attr", "merge", "--", ...expectedOutputPaths()])
        );
        expect(
          attributes.split("\n").every(line => line.endsWith(": unspecified"))
        ).toBe(true);
        const changed = successful(
          git(root, ["diff", "--name-only", base, tip])
        );
        expect(changed).toContain(MAP_REL);
        expect(changed).toContain(
          tip === alpha ? FEATURE_FILES[0]! : FEATURE_FILES[2]!
        );
      }
      merge(history, order);
      const committed = reportSnapshot(root);
      expect(Object.keys(committed)).toEqual(expectedOutputPaths());
      expectUnion(aggregate(root, base));
      writeReports(root, base);
      expect(reportSnapshot(root)).toEqual(committed);
      expect(successful(git(root, ["status", "--porcelain"]))).toBe("");
      const summary = path.join(root, ".git", "ci-summary.md");
      const run = cli(root, base, "check-bdd-coverage.mjs", ["--report"], {
        GITHUB_STEP_SUMMARY: summary,
      });
      expectUnion(JSON.parse(successful(run)) as AggregateReport);
      expect(run.stderr).toContain("11 scenarios declared");
      expect(fs.existsSync(summary)).toBe(true);
      const body = fs.readFileSync(summary, "utf8");
      expect(body).toContain("11/11 (100.0%)");
      expect(body).toContain("11 mapped tests exist");
      expect(body).toContain("No execution evidence was supplied");
      expect(body).toContain("completed");
    }
  );
});

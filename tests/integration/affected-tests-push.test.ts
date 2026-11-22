/**
 * Affected-test selection at push (CodySwannGT/lisa#4600), end to end: the
 * real `lisa-affected-tests.mjs` in a throwaway git repository, against a
 * stand-in `vitest` that records the command it was given.
 *
 * Pinned, each against its control:
 * - a one-module change runs only the mapped tests, and says why;
 * - a failing selected test still fails the command;
 * - a trigger file, an unmapped file, a missing map and a stale map each run
 *   the full command unchanged and print the reason;
 * - selection off, or a CI run, runs the full command unchanged;
 * - the coverage modes `full` and `changed-files` (`skip` is pinned through
 *   the gate runner in affected-tests-push-gates.test.ts);
 * - in `changed-files`, a changed file below its floor escalates the push to
 *   the full suite with whole-repo coverage, whose verdict decides it.
 * @module tests/integration/affected-tests-push
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  FULL,
  MOD,
  MOD_CHANGE,
  OTHER_CHANGE,
  change,
  fixture,
  git,
  removeFixtures,
  select,
  write,
  writeMap,
} from "./affected-tests-fixture.js";

afterAll(removeFixtures);

describe("affected tests at push", () => {
  it("runs only the mapped tests for a one-module change and says why", () => {
    const root = fixture();
    change(root, MOD_CHANGE);
    const result = select(root);
    expect(result.status, result.output).toBe(0);
    expect(result.calls).toEqual([
      [
        "related",
        "--run",
        "--exclude=**/integration/**",
        "--coverage.enabled=false",
        MOD,
        "tests/unit/mod.test.ts",
      ],
    ]);
    expect(result.output).toContain(`tests/unit/mod.test.ts  (map: ${MOD})`);
    expect(result.output).toContain("import-graph selection");
  });

  it("fails when a selected test fails", () => {
    const root = fixture();
    change(root, OTHER_CHANGE);
    const result = select(root);
    expect(result.status).toBe(1);
    expect(result.calls[0]).toEqual(
      expect.arrayContaining([
        "tests/unit/failing.test.ts",
        "tests/unit/other.test.ts",
      ])
    );
  });

  it.each([
    ["package.json", '{"name":"changed"}\n', "package.json changed"],
    ["tests/helpers/test-utils.ts", "// helper\n", "shared test helpers"],
    [
      "src/brand-new.mjs",
      "export const x = 1;\n",
      "unmapped file: src/brand-new.mjs",
    ],
  ])("runs the full suite when %s changes", (file, body, reason) => {
    const root = fixture();
    change(root, { [file]: body });
    const result = select(root);
    expect(result.calls).toEqual([FULL]);
    expect(result.output).toContain(`Running the full suite: ${reason}`);
  });

  it("runs the full suite with no map, or with a stale one", () => {
    const missing = fixture({ map: "none" });
    change(missing, MOD_CHANGE);
    const none = select(missing);
    expect(none.calls).toEqual([FULL]);
    expect(none.output).toContain("Running the full suite: missing map");

    const old = fixture();
    change(old, MOD_CHANGE);
    const stale = select(old, { LISA_ACCESS_MAP_MAX_AGE_DAYS: "0" });
    expect(stale.calls).toEqual([FULL]);
    expect(stale.output).toContain("Running the full suite: stale map");
  });

  it("runs the full command unchanged and silently when selection is off", () => {
    const root = fixture({ pushGate: { buildOnce: true } });
    change(root, MOD_CHANGE);
    const result = select(root);
    expect(result.calls).toEqual([FULL]);
    expect(result.output).not.toContain("affected tests");
  });

  it("never selects in CI", () => {
    const root = fixture();
    change(root, MOD_CHANGE);
    const result = select(root, { CI: "true" });
    expect(result.calls).toEqual([FULL]);
    expect(result.output).toContain("this is a CI run");
  });

  it("keeps the full suite by default while coverage-adequacy is declared at push", () => {
    const root = fixture({ pushGate: { affectedTests: true } });
    change(root, MOD_CHANGE);
    const result = select(root);
    expect(result.calls).toEqual([FULL]);
    expect(result.output).toContain('pushGate.affectedCoverage is "full"');
  });

  it("with --push-only, runs the full command unchanged outside the push gate (#4611)", () => {
    const root = fixture();
    change(root, MOD_CHANGE);
    const outside = select(root, {}, ["--push-only"]);
    expect(outside.status, outside.output).toBe(0);
    expect(outside.calls).toEqual([FULL]);
    expect(outside.output).not.toContain("affected tests");

    const report = path.join(root, ".lisa", "selection-report.json");
    const inside = select(root, { LISA_SELECTION_REPORT: report }, [
      "--push-only",
    ]);
    expect(inside.calls.at(-1)?.slice(0, 2)).toEqual(["related", "--run"]);
  });

  it("runs a command that is not a vitest run unchanged, with the reason (#4611)", () => {
    const root = fixture({ pushGate: { affectedTests: true } });
    change(root, MOD_CHANGE);
    const jest = ["node", "fake/vitest", "--coverage"];
    const result = select(root, {}, [], jest);
    expect(result.status, result.output).toBe(0);
    expect(result.calls).toEqual([["--coverage"]]);
    expect(result.output).toContain(
      "Running the full suite: the test command is not a `vitest run`"
    );
  });

  it("selects by default when coverage-adequacy is not declared at push", () => {
    const root = fixture({
      pushGate: { affectedTests: true },
      coverageAtPush: false,
    });
    change(root, MOD_CHANGE);
    const [call] = select(root).calls;
    expect(call?.slice(0, 2)).toEqual(["related", "--run"]);
    expect(call).toContain("--coverage.enabled=false");
  });

  it("passes a partial run whose changed files all meet the floor, and escalates one that does not", () => {
    const root = fixture({
      pushGate: { affectedTests: true, affectedCoverage: "changed-files" },
      map: "none",
    });
    change(root, {
      "vitest.thresholds.json": JSON.stringify({ global: { lines: 80 } }),
    });
    pointMainAtHead(root);
    writeMap(
      root,
      git(root, "rev-parse", "HEAD"),
      git(root, "rev-parse", "HEAD~1")
    );
    change(root, MOD_CHANGE);
    const fresh = (): void =>
      fs.rmSync(path.join(root, ".vitest-calls"), { force: true });

    write(root, "coverage.json", JSON.stringify({ [MOD]: 95 }));
    const high = select(root);
    expect(high.status, high.output).toBe(0);
    expect(high.output).toContain(
      "1 changed source file(s) meet the coverage floor"
    );
    expect(high.calls, "no escalation when every file meets it").toHaveLength(
      1
    );

    // Push is never stricter than whole-repo coverage (CodySwannGT/lisa#4600):
    // a changed file short on its own sends the push to the full suite with
    // whole-repo coverage, exactly as "full" mode runs it, and that decides.
    fresh();
    write(root, "coverage.json", JSON.stringify({ [MOD]: 50 }));
    const low = select(root);
    expect(low.status, low.output).toBe(0);
    expect(low.calls[0]).toContain("--coverage.enabled=true");
    expect(low.calls[1]).toEqual(FULL);
    expect(low.output).toContain(
      `${MOD} is below its coverage floor on its own (lines 50% is below 80%), so the full suite is running now with whole-repo coverage, and that run decides this push.`
    );
    expect(low.output).not.toContain("❌");

    fresh();
    write(root, "whole-coverage.fail", "");
    const whole = select(root);
    expect(whole.status, "the full run's verdict stands").toBe(1);
    expect(whole.calls[1]).toEqual(FULL);
  });

  it("escalates rather than fails when the partial run leaves no coverage summary", () => {
    const root = fixture({
      pushGate: { affectedTests: true, affectedCoverage: "changed-files" },
      map: "none",
    });
    change(root, {
      "vitest.thresholds.json": JSON.stringify({ global: { lines: 80 } }),
    });
    pointMainAtHead(root);
    writeMap(
      root,
      git(root, "rev-parse", "HEAD"),
      git(root, "rev-parse", "HEAD~1")
    );
    change(root, MOD_CHANGE);
    const result = select(root);
    expect(result.status, result.output).toBe(0);
    expect(result.calls[1]).toEqual(FULL);
    expect(result.output).toContain(
      "the partial run wrote no coverage summary, so the full suite is running now with whole-repo coverage"
    );
  });
});

/** A unit test the fixture map links to `MOD`. */
const MOD_TEST = "tests/unit/mod.test.ts";

/** The fixture source two unit tests read. */
const OTHER_SOURCE = "src/other.mjs";

/** The fixture test that always fails. */
const FAILING_TEST = "tests/unit/failing.test.ts";

/**
 * Point `origin/main` at the branch head.
 * @param root - Fixture root
 */
function pointMainAtHead(root: string): void {
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
}

/**
 * Move `origin/main` to the branch head and keep the map recorded for the
 * commit before it, so the map is one commit older than the base.
 * @param root - Fixture root
 */
function advanceMainPastTheMap(root: string): void {
  pointMainAtHead(root);
  writeMap(
    root,
    git(root, "rev-parse", "HEAD"),
    git(root, "rev-parse", "HEAD~1")
  );
}

/**
 * Delete files on the branch and commit.
 * @param root - Fixture root
 * @param files - Repository-relative paths
 */
function remove(root: string, ...files: string[]): void {
  for (const file of files) fs.rmSync(path.join(root, file));
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "delete");
}

describe("affected tests fail closed (review of #4887)", () => {
  it("runs the full suite when a changed file no test was recorded reading is not a document", () => {
    // A shell helper hook scripts `source`: bash reads it, Node never does.
    const root = fixture({ map: "none" });
    change(root, { "scripts/lib/helper.sh": "helper() { :; }\n" });
    pointMainAtHead(root);
    const head = git(root, "rev-parse", "HEAD");
    writeMap(root, head, head);
    change(root, {
      "scripts/lib/helper.sh": "helper() { exit 1; }\n",
      ...MOD_CHANGE,
    });
    const result = select(root);
    expect(result.calls).toEqual([FULL]);
    expect(result.output).toContain(
      "Running the full suite: unread file: scripts/lib/helper.sh"
    );
  });

  it("runs nothing for a document no test reads", () => {
    const root = fixture();
    change(root, { "docs/notes.md": "more notes\n" });
    const result = select(root);
    expect(result.status, result.output).toBe(0);
    expect(result.calls).toEqual([]);
  });

  it("selects a test added on the default branch after the map was recorded", () => {
    const root = fixture({ map: "none" });
    change(root, { "tests/unit/fresh.test.ts": "// fresh\n" });
    advanceMainPastTheMap(root);
    change(root, MOD_CHANGE);
    const [call] = select(root).calls;
    expect(call).toEqual(
      expect.arrayContaining([MOD_TEST, "tests/unit/fresh.test.ts"])
    );
  });

  it("still hands a changed file to Vitest when the map links it to no runnable test", () => {
    const root = fixture({ coverageAtPush: false });
    write(
      root,
      ".lisa/test-access-map/map.json",
      JSON.stringify({
        [MOD_TEST]: [],
        "tests/unit/other.test.ts": [OTHER_SOURCE],
        [FAILING_TEST]: [OTHER_SOURCE],
        "tests/integration/mod.test.ts": [MOD],
      })
    );
    change(root, MOD_CHANGE);
    const result = select(root);
    expect(result.status, result.output).toBe(0);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]?.slice(0, 2)).toEqual(["related", "--run"]);
    expect(result.calls[0]).toContain(MOD);
  });

  it("holds what a deleted test read to the floor through its remaining readers", () => {
    const root = fixture();
    remove(root, "tests/unit/other.test.ts");
    const [call] = select(root).calls;
    expect(call?.slice(0, 2)).toEqual(["related", "--run"]);
    expect(call).toEqual(expect.arrayContaining([OTHER_SOURCE, FAILING_TEST]));
  });

  it("runs the full suite when a deleted test was a file's only unit reader", () => {
    const root = fixture();
    remove(root, MOD_TEST);
    const result = select(root);
    expect(result.calls).toEqual([FULL]);
    expect(result.output).toContain(
      `deleted test: it was the only test that read ${MOD}`
    );
  });
});

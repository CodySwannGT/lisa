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
 *   the gate runner in affected-tests-push-gates.test.ts).
 * @module tests/integration/affected-tests-push
 */
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

  it("holds each changed source file to the floor in changed-files mode", () => {
    const root = fixture({
      pushGate: { affectedTests: true, affectedCoverage: "changed-files" },
      map: "none",
    });
    change(root, {
      "vitest.thresholds.json": JSON.stringify({ global: { lines: 80 } }),
    });
    git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
    writeMap(
      root,
      git(root, "rev-parse", "HEAD"),
      git(root, "rev-parse", "HEAD~1")
    );
    change(root, MOD_CHANGE);

    write(root, "coverage.json", JSON.stringify({ [MOD]: 50 }));
    const low = select(root);
    expect(low.status).toBe(1);
    expect(low.output).toContain(`${MOD}: lines 50% is below 80%`);
    expect(low.calls[0]).toContain("--coverage.enabled=true");

    write(root, "coverage.json", JSON.stringify({ [MOD]: 95 }));
    const high = select(root);
    expect(high.status, high.output).toBe(0);
    expect(high.output).toContain(
      "1 changed source file(s) meet the coverage floor"
    );
  });
});

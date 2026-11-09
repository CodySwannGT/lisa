/**
 * The CI-rework route CLI, the surface `lisa-track` runs.
 *
 * The skill reads one JSON line from stdout and branches on `route`, so these
 * cases pin that line for every recorded fixture under plain node (the
 * Validation Journey's own commands) and pin the usage errors.
 * @module tests/unit/scripts/lisa-ci-rework-route-cli
 */
import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

import { main } from "../../../scripts/lisa-ci-rework-route.mjs";

const SCRIPT = "scripts/lisa-ci-rework-route.mjs";
const FIXTURES = "tests/fixtures/ci-rework-route";
const NOT_NEWEST = "not-newest";
const REPO = "CodySwannGT/lisa";

/**
 * Run the CLI under plain node against one fixture for item 1.
 * @param name - Fixture file name without extension.
 * @returns Exit status and the parsed JSON line.
 */
function runFixture(name: string) {
  const result = boundedSpawnSync({
    label: `ci-rework-route CLI ${name}`,
    command: process.execPath,
    args: [SCRIPT, "--item", "1", "--payload", `${FIXTURES}/${name}.json`],
  });
  return { status: result.status, json: JSON.parse(result.stdout) };
}

describe("the CLI under plain node", () => {
  it.each([
    "trusted-marker",
    "claim-after-marker",
    "reclaim-twice",
    "untrusted-later-marker",
  ])("prints the ci-rework route for %s", name => {
    const { status, json } = runFixture(name);
    expect(status).toBe(0);
    expect(json).toMatchObject({ route: "ci-rework", pr: 101 });
    expect(json.failingChecks.length).toBeGreaterThan(0);
  });

  it.each([
    ["human-authored", "untrusted-author"],
    ["cleared-marker", "cleared"],
    ["closed-pr", "pull-request-not-open"],
    ["fork-pr", "fork-pull-request"],
    ["other-item", "other-work-item"],
    [NOT_NEWEST, NOT_NEWEST],
    ["merged-pr", "pull-request-not-open"],
    ["unbound-pr", "unbound-pull-request"],
  ])("prints route implement for %s (%s)", (name, reason) => {
    const { status, json } = runFixture(name);
    expect(status).toBe(0);
    expect(json).toMatchObject({ route: "implement", reason });
  });

  it("prints route blocked for the loop-bound fixture", () => {
    const { status, json } = runFixture("loop-bound");
    expect(status).toBe(0);
    expect(json).toMatchObject({ route: "blocked", reason: "ci-loop-bound" });
  });
});

describe("main", () => {
  const contract = { provider: "github", repository: REPO };

  it("reads the item's comments on the live path through the given runner", () => {
    const calls: string[][] = [];
    const out: string[] = [];
    const gh = (args: string[]) => {
      calls.push(args);
      return { ok: true, stdout: "[[]]", stderr: "" };
    };
    expect(
      main(["--item", "7"], { gh, contract, write: (l: string) => out.push(l) })
    ).toBe(0);
    expect(calls[0]).toEqual([
      "api",
      `repos/${REPO}/issues/7/comments`,
      "--paginate",
      "--slurp",
    ]);
    expect(JSON.parse(out[0] ?? "")).toMatchObject({
      route: "implement",
      reason: "no-marker",
    });
  });

  it("accepts a canonical item reference and an explicit --repo", () => {
    const calls: string[][] = [];
    const gh = (args: string[]) => {
      calls.push(args);
      return { ok: true, stdout: "[[]]", stderr: "" };
    };
    const out: string[] = [];
    expect(
      main(["--item", "Other/repo#9", "--repo", "Other/repo"], {
        gh,
        contract,
        write: (l: string) => out.push(l),
      })
    ).toBe(0);
    expect(calls[0]?.[1]).toBe("repos/Other/repo/issues/9/comments");
  });

  it.each([
    [[]],
    [["--item"]],
    [["--item", "1; rm -rf /"]],
    [["--item", "1", "--bogus"]],
  ])("refuses bad usage %j with exit 2", argv => {
    const out: string[] = [];
    expect(main(argv, { contract, write: (l: string) => out.push(l) })).toBe(2);
    expect(out.join("\n")).toMatch(/lisa-ci-rework-route:/u);
  });
});

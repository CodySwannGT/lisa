/**
 * Canary-first rollout plan for `lisa-update-projects` (CodySwannGT/lisa#4604).
 *
 * The fleet-update skill used to upgrade every host in `.lisa.workspaces.json`
 * at once, so a bad Lisa release reached every host at once. The plan script
 * splits the hosts into a single designated canary and "the rest", and decides
 * whether a canary result lets the rollout continue. These tests pin the four
 * acceptance scenarios: exactly-one-canary designation, legacy string values
 * keeping their branches, and the proceed/halt decision — where every
 * non-passing result (fail OR timeout) must halt.
 *
 * Fixtures use placeholder host names only (`fixture-canary`,
 * `fixture-host-a`, `fixture-host-b`); Lisa never names a real host.
 *
 * @module tests/unit/scripts/lisa-update-projects-plan
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  DESIGNATION_HELP,
  buildPlan,
  decide,
  parseWorkspaces,
  planFromText,
} from "../../../scripts/lisa-update-projects-plan.mjs";

/** Repository root, resolved from this file rather than from cwd. */
const ROOT = path.resolve(__dirname, "../../..");
const SCRIPT = path.join(ROOT, "scripts/lisa-update-projects-plan.mjs");
const FIXTURES = path.join(ROOT, "tests/fixtures/update-projects");
const WORKSPACES_FLAG = "--workspaces";
const CANARY = "fixture-canary";
const HOST_A = "fixture-host-a";

/**
 * Read one fixture workspace file as text.
 * @param name - fixture basename
 * @returns the file's text
 */
const fixture = (name: string): string =>
  readFileSync(path.join(FIXTURES, name), "utf8");

/**
 * Run the plan script as a real CLI.
 * @param args - CLI arguments
 * @returns exit status and captured streams
 */
const runCli = (args: readonly string[]) => {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: FIXTURES,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
};

/**
 * Assert a result is a refusal and return its message.
 * @param result - a plan, parse or decide result
 * @returns the refusal message
 */
const refusalOf = (result: { ok: boolean; message?: string }): string => {
  expect(result.ok).toBe(false);
  return result.message ?? "";
};

describe("planFromText: canary designation", () => {
  it("splits one canary from the rest, keeping file order and branches", () => {
    expect(planFromText(fixture("one-canary.json"))).toEqual({
      ok: true,
      plan: {
        canary: { path: CANARY, branch: "dev" },
        rest: [
          { path: HOST_A, branch: "staging" },
          { path: "fixture-host-b", branch: "main" },
        ],
      },
    });
  });

  it("refuses a file with no canary and says how to designate one", () => {
    const message = refusalOf(planFromText(fixture("no-canary.json")));
    expect(message).toContain("no canary");
    expect(message).toContain(DESIGNATION_HELP);
  });

  it("refuses two canaries, naming both, and says how to designate one", () => {
    const message = refusalOf(planFromText(fixture("two-canaries.json")));
    expect(message).toContain("2 canaries");
    expect(message).toContain(CANARY);
    expect(message).toContain(HOST_A);
    expect(message).toContain(DESIGNATION_HELP);
  });

  it("refuses a legacy string-only file, because it designates no canary", () => {
    const message = refusalOf(planFromText(fixture("legacy-strings.json")));
    expect(message).toContain(DESIGNATION_HELP);
  });

  it("shows the object form in the designation help", () => {
    expect(DESIGNATION_HELP).toContain('"canary": true');
    expect(DESIGNATION_HELP).toContain('"branch"');
  });
});

describe("parseWorkspaces: value forms", () => {
  it("accepts a string value as the legacy branch form", () => {
    expect(parseWorkspaces('{"fixture-host-a":"staging"}')).toEqual({
      ok: true,
      entries: [{ path: HOST_A, branch: "staging", canary: false }],
    });
  });

  it("accepts the object form with and without canary", () => {
    const text =
      '{"fixture-canary":{"branch":"dev","canary":true},"fixture-host-b":{"branch":"main"}}';
    expect(parseWorkspaces(text)).toEqual({
      ok: true,
      entries: [
        { path: CANARY, branch: "dev", canary: true },
        { path: "fixture-host-b", branch: "main", canary: false },
      ],
    });
  });

  it.each([
    ["a number value", '{"fixture-host-a":42}'],
    ["a null value", '{"fixture-host-a":null}'],
    ["an array value", '{"fixture-host-a":["main"]}'],
    ["an empty branch string", '{"fixture-host-a":""}'],
    ["an object without a branch", '{"fixture-host-a":{"canary":true}}'],
    ["an empty object branch", '{"fixture-host-a":{"branch":" "}}'],
    [
      "a non-boolean canary",
      '{"fixture-host-a":{"branch":"main","canary":"yes"}}',
    ],
    ["an unknown key", '{"fixture-host-a":{"branch":"main","canery":true}}'],
  ])("refuses %s, naming the entry", (_label, text) => {
    const message = refusalOf(parseWorkspaces(text));
    expect(message).toContain(JSON.stringify(HOST_A));
  });

  it("refuses invalid JSON", () => {
    const message = refusalOf(parseWorkspaces("{ not json"));
    expect(message).toContain("not valid JSON");
  });

  it.each([["[]"], ['"main"'], ["null"]])(
    "refuses a top-level %s that is not an object",
    text => {
      const message = refusalOf(parseWorkspaces(text));
      expect(message).toContain("JSON object");
    }
  );

  it("refuses an empty map", () => {
    const message = refusalOf(planFromText("{}"));
    expect(message).toContain("no hosts");
  });

  it("refuses the malformed fixture by its offending entry", () => {
    const message = refusalOf(planFromText(fixture("malformed.json")));
    expect(message).toContain(JSON.stringify(HOST_A));
  });
});

describe("buildPlan", () => {
  it("allows a canary that is the only host, leaving the rest empty", () => {
    expect(buildPlan([{ path: CANARY, branch: "dev", canary: true }])).toEqual({
      ok: true,
      plan: { canary: { path: CANARY, branch: "dev" }, rest: [] },
    });
  });
});

describe("decide: what follows a canary result", () => {
  it.each([
    ["pass", "proceed"],
    ["fail", "halt"],
    ["timeout", "halt"],
  ])("maps %s to %s", (result, decision) => {
    expect(decide(result)).toEqual({ ok: true, decision });
  });

  it.each([["passed"], [""], ["PASS"], [undefined]])(
    "refuses an unrecognised result %s rather than defaulting to proceed",
    result => {
      expect(decide(result).ok).toBe(false);
    }
  );
});

describe("CLI: plan", () => {
  it("prints the canary phase, then the rest, as JSON", () => {
    const run = runCli([
      WORKSPACES_FLAG,
      path.join(FIXTURES, "one-canary.json"),
    ]);
    expect(run.status).toBe(0);
    const plan = JSON.parse(run.stdout);
    expect(Object.keys(plan)).toEqual(["canary", "rest"]);
    expect(plan.canary).toEqual({ path: CANARY, branch: "dev" });
    expect(plan.rest).toHaveLength(2);
  });

  it.each([["no-canary.json"], ["two-canaries.json"]])(
    "refuses %s with the designation message and a non-zero exit",
    name => {
      const run = runCli([WORKSPACES_FLAG, path.join(FIXTURES, name)]);
      expect(run.status).toBe(1);
      expect(run.stdout).toBe("");
      expect(run.stderr).toContain(DESIGNATION_HELP);
    }
  );

  it("refuses a workspace file that does not exist", () => {
    const run = runCli([WORKSPACES_FLAG, path.join(FIXTURES, "absent.json")]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("cannot read");
  });

  it("reads .lisa.workspaces.json in cwd when no path is given", () => {
    const run = runCli([]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(".lisa.workspaces.json");
  });

  it("refuses an unknown flag with usage", () => {
    const run = runCli(["--bogus"]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("usage");
  });
});

describe("CLI: decide", () => {
  it.each([
    ["pass", "proceed"],
    ["fail", "halt"],
    ["timeout", "halt"],
  ])("prints %s -> %s", (result, decision) => {
    const run = runCli(["decide", "--canary-result", result]);
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe(decision);
  });

  it.each([[["decide"]], [["decide", "--canary-result", "maybe"]]])(
    "refuses %j with usage and a non-zero exit",
    args => {
      const run = runCli(args);
      expect(run.status).toBe(2);
      expect(run.stdout).toBe("");
      expect(run.stderr).toContain("usage");
    }
  );
});

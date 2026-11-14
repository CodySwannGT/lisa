/**
 * Keeps the six nightly-only suites off every pull-request and push path, and
 * on the nightly lane (CodySwannGT/lisa#4896).
 *
 * The list lives in `scripts/lib/nightly-slow-suites.mjs`. These cases pin the
 * three places that must agree with it:
 *
 * 1. `vitest.config.local.ts` excludes exactly those files — and, matched
 *    against every test file in the tree, nothing else.
 * 2. Every task a pull-request or push test gate resolves to runs Vitest under
 *    that config and does not lift the exclusion.
 * 3. `.github/workflows/nightly-slow-tests.yml` lifts it and names exactly the
 *    listed files, on a schedule and by hand only, and files an issue when red.
 *
 * Execution itself is proved in the lane, by
 * `scripts/check-test-files-executed.mjs` reading the run's own report.
 * @module tests/unit/config/nightly-slow-suites
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";

import { minimatch } from "minimatch";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  readGates,
  resolveMoment,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import {
  NIGHTLY_SLOW_SUITES,
  NIGHTLY_SLOW_SUITES_ENV,
  NIGHTLY_SLOW_SUITES_RUN,
  nightlySlowSuiteExclusions,
} from "../../../scripts/lib/nightly-slow-suites.mjs";
import localConfig from "../../../vitest.config.local.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const WORKFLOWS = path.join(REPO_ROOT, ".github", "workflows");
const NIGHTLY_WORKFLOW = path.join(WORKFLOWS, "nightly-slow-tests.yml");

/** The six files the 2026-11-14 audit moved, as the issue lists them. */
const AUDITED = [
  "tests/unit/config/test-run-supervision-wiring.test.ts",
  "tests/integration/mutation-gate-bite.test.ts",
  "tests/integration/history-secret-evidence.test.ts",
  "tests/integration/history-secret-private-report.test.ts",
  "tests/integration/vitest-nodenext-local-config.test.ts",
  "tests/integration/staged-module-formatting.test.ts",
];

/** Gates whose tasks decide which test files a moment runs. */
const TEST_GATES = [
  "test-correctness",
  "coverage-adequacy",
  "test-integration",
];

/**
 * Every test file under `tests/`, repository-relative.
 * @param directory - Directory to walk
 * @returns Test file paths
 */
const testFiles = (directory: string): readonly string[] =>
  readdirSync(path.join(REPO_ROOT, directory), { withFileTypes: true }).flatMap(
    entry => {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return testFiles(relative);
      return entry.name.endsWith(".test.ts") ? [relative] : [];
    }
  );

/**
 * A script body from this repository's own `package.json`.
 * @param name - Script name
 * @returns The command it runs
 */
const script = (name: string): string =>
  (
    JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    }
  ).scripts[name] ?? "";

/**
 * The tasks the pull-request and push test gates resolve to.
 * @returns `moment gate` labels mapped to task names
 */
const gatedTestTasks = (): ReadonlyMap<string, string> => {
  const { gates, runner } = readGates() as { gates: object; runner: string };
  return new Map(
    ["pull-request", "push"].flatMap(moment =>
      (
        resolveMoment({ gates, moment, runner }) as {
          id: string;
          task: string | null;
        }[]
      )
        .filter(entry => TEST_GATES.includes(entry.id) && entry.task !== null)
        .map(entry => [`${moment} ${entry.id}`, entry.task as string] as const)
    )
  );
};

/**
 * Sort paths or labels by locale.
 * @param values - Values
 * @returns A sorted copy
 */
const sorted = (values: readonly string[]): string[] =>
  [...values].sort((left, right) => left.localeCompare(right));

/**
 * The nightly workflow, parsed.
 * @returns Its triggers and jobs
 */
const nightly = (): {
  on: Record<string, unknown>;
  jobs: Record<
    string,
    {
      steps?: { run?: string; env?: Record<string, string>; if?: string }[];
      uses?: string;
      needs?: string;
      if?: string;
    }
  >;
} => parse(readFileSync(NIGHTLY_WORKFLOW, "utf8"));

describe("the nightly-only list", () => {
  it("is exactly the six audited files, all present", () => {
    expect(sorted(NIGHTLY_SLOW_SUITES)).toEqual(sorted(AUDITED));
    for (const file of NIGHTLY_SLOW_SUITES)
      expect(existsSync(path.join(REPO_ROOT, file)), file).toBe(true);
  });

  it("is lifted only by the nightly lane's variable", () => {
    expect(nightlySlowSuiteExclusions({})).toEqual([...NIGHTLY_SLOW_SUITES]);
    expect(
      nightlySlowSuiteExclusions({ [NIGHTLY_SLOW_SUITES_ENV]: "1" })
    ).toEqual([...NIGHTLY_SLOW_SUITES]);
    expect(
      nightlySlowSuiteExclusions({
        [NIGHTLY_SLOW_SUITES_ENV]: NIGHTLY_SLOW_SUITES_RUN,
      })
    ).toEqual([]);
  });
});

describe("the pull-request and push file sets", () => {
  it("exclude the six files in the shared Vitest config", () => {
    expect(process.env[NIGHTLY_SLOW_SUITES_ENV]).toBeUndefined();
    const exclude = localConfig.test?.exclude ?? [];
    for (const file of NIGHTLY_SLOW_SUITES)
      expect(exclude, file).toContain(file);
  });

  it("drop the six files and no other test file", () => {
    // Exact paths, matched against the whole tree: a basename glob would also
    // drop `tests/unit/scripts/history-secret-private-report.test.ts`, a
    // cheap unit suite that must keep running on every pull request.
    const exclude = nightlySlowSuiteExclusions({});
    const dropped = testFiles("tests").filter(file =>
      exclude.some(pattern => minimatch(file, pattern))
    );
    expect(sorted(dropped)).toEqual(sorted(NIGHTLY_SLOW_SUITES));
  });

  it("are decided by tasks that run Vitest under that config without lifting it", () => {
    const tasks = gatedTestTasks();
    // Every moment and gate is present, so a renamed gate cannot pass this by
    // resolving to nothing. Coverage at the pull request is proved by the
    // `test-correctness` run itself; `coverage-adequacy` is declared at push.
    expect(sorted([...tasks.keys()])).toEqual(
      sorted([
        "pull-request test-correctness",
        "pull-request test-integration",
        "push coverage-adequacy",
        "push test-correctness",
        "push test-integration",
      ])
    );
    for (const [label, task] of tasks) {
      const command = script(task);
      expect(command, label).toContain(
        "lisa-test-run -- --adapter vitest -- vitest run"
      );
      expect(command, label).not.toContain(NIGHTLY_SLOW_SUITES_ENV);
      expect(command, label).not.toMatch(/--config|(^|\s)-c\s/u);
      for (const file of NIGHTLY_SLOW_SUITES)
        expect(command, `${label} names ${file}`).not.toContain(file);
    }
  });
});

describe("the nightly lane", () => {
  it("runs on a schedule and by hand, never on a pull request or push", () => {
    const triggers = nightly().on;
    expect(sorted(Object.keys(triggers))).toEqual([
      "schedule",
      "workflow_dispatch",
    ]);
    const [entry] = triggers.schedule as { cron: string }[];
    expect(entry?.cron).toMatch(/^\d+ \d+ \* \* \*$/u);
  });

  it("takes a cron slot no other scheduled lane uses", () => {
    const own = (nightly().on.schedule as { cron: string }[])[0]?.cron;
    const others = readdirSync(WORKFLOWS)
      .filter(
        name => name !== "nightly-slow-tests.yml" && name.endsWith(".yml")
      )
      .flatMap(name => {
        const on = (
          parse(readFileSync(path.join(WORKFLOWS, name), "utf8")) as {
            on?: { schedule?: { cron: string }[] };
          }
        ).on;
        return (on?.schedule ?? []).map(slot => slot.cron);
      });
    expect(others.length).toBeGreaterThan(0);
    const minuteHour = (cron: string): string =>
      cron.split(" ").slice(0, 2).join(" ");
    expect(others.map(minuteHour)).not.toContain(minuteHour(own ?? ""));
  });

  it("lifts the exclusion and names exactly the shared list through lisa-test-run", () => {
    const steps = nightly().jobs.nightly_slow_tests?.steps ?? [];
    const runs = steps.filter(step =>
      (step.run ?? "").includes(
        "lisa-test-run -- --adapter vitest -- vitest run"
      )
    );
    expect(runs).toHaveLength(1);
    const [step] = runs;
    expect(step?.env?.[NIGHTLY_SLOW_SUITES_ENV]).toBe(NIGHTLY_SLOW_SUITES_RUN);
    const named = (step?.run ?? "")
      .split(/\s+/u)
      .filter(token => token.endsWith(".test.ts"));
    expect(named).toEqual([...NIGHTLY_SLOW_SUITES]);
  });

  it("proves each listed file ran, from the shared list", () => {
    const steps = nightly().jobs.nightly_slow_tests?.steps ?? [];
    expect(
      steps.some(
        step =>
          (step.run ?? "").includes("scripts/check-test-files-executed.mjs") &&
          (step.run ?? "").includes(
            "--list scripts/lib/nightly-slow-suites.mjs#NIGHTLY_SLOW_SUITES"
          )
      )
    ).toBe(true);
  });

  it("uploads the log even when red, and files an issue on failure", () => {
    const workflow = nightly();
    const upload = (workflow.jobs.nightly_slow_tests?.steps ?? []).find(step =>
      String((step as { uses?: string }).uses ?? "").startsWith(
        "actions/upload-artifact@"
      )
    );
    expect(upload?.if).toBe("always()");
    const issue = workflow.jobs.create_issue_on_failure;
    expect(issue?.uses).toBe(
      "./.github/workflows/create-github-issue-on-failure.yml"
    );
    expect(issue?.needs).toBe("nightly_slow_tests");
    expect(issue?.if).toContain("failure()");
  });
});

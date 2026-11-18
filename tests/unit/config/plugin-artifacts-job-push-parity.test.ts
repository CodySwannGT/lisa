/**
 * Every check the required `🧩 Plugin artifacts match source` job runs must
 * also run locally before a push (CodySwannGT/lisa#5023).
 *
 * Fifteen of that job's `bun run check:*` steps had no local arm, so a push
 * could pass every local gate and still turn its pull request red. It happened
 * on #5010: a workflow step piped a script through `tee`, the push went
 * through, and CI failed at `check:pipeline-status-reads` minutes later.
 *
 * This reads the job itself rather than a list kept beside it, so a new CI
 * step without a local arm fails here and names the check. A step counts as
 * covered when the same task runs at `push` or `commit` through a gate, or is
 * one of the `check:artifacts` sub-checks (which runs at `commit`). Steps that
 * are not `bun run check:*` (the native shell-guard shard merge, commitlint)
 * are outside this property: they are not package-script checks a push can
 * run the same way.
 * @module tests/unit/config/plugin-artifacts-job-push-parity
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { load as loadYaml } from "js-yaml";
import { describe, expect, it } from "vitest";

import {
  readGates,
  resolveMoment,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

/** Repository root, resolved from this file rather than the process cwd. */
const ROOT = path.join(import.meta.dirname, "..", "..", "..");

/** The required job's display name. */
const JOB_NAME = "🧩 Plugin artifacts match source";

/** The workflow that defines it. */
const WORKFLOW = ".github/workflows/plugins-sync.yml";

/** A whole-step package-script check: `bun run check:<name>`. */
const CHECK_STEP = /^bun run (check:[a-z0-9-]+)$/u;

/**
 * The checks the job runs as `bun run check:*` steps, in order.
 * @returns Task names, `check:` prefixed.
 */
function jobChecks(): readonly string[] {
  const workflow = loadYaml(
    readFileSync(path.join(ROOT, WORKFLOW), "utf8")
  ) as {
    jobs: Record<
      string,
      { name?: string; steps?: readonly { run?: string }[] }
    >;
  };
  const job = Object.values(workflow.jobs).find(
    candidate => candidate.name === JOB_NAME
  );
  expect(job, `${WORKFLOW} has no job named "${JOB_NAME}"`).toBeDefined();
  return (job?.steps ?? []).flatMap(step =>
    (step.run ?? "")
      .split("\n")
      .map(line => line.trim())
      .flatMap(line => {
        const match = CHECK_STEP.exec(line);
        return match ? [match[1] as string] : [];
      })
  );
}

/**
 * Tasks that run locally: every gate task at `push` and `commit`, plus the
 * `check:artifacts` sub-checks.
 * @returns Task names, `check:` prefixed.
 */
function localTasks(): ReadonlySet<string> {
  const { gates, runner } = readGates(ROOT) as {
    gates: Record<string, unknown>;
    runner: string;
  };
  const gateTasks = ["push", "commit"].flatMap(moment =>
    (
      resolveMoment({ gates, moment, runner }) as readonly {
        task: string | null;
      }[]
    ).flatMap(entry => (entry.task === null ? [] : [entry.task]))
  );
  const manifest = JSON.parse(
    readFileSync(path.join(ROOT, "package.json"), "utf8")
  ) as { scripts: Record<string, string> };
  const artifactSubChecks =
    manifest.scripts["check:artifacts"]?.match(/\bcheck:[a-z0-9-]+/gu) ?? [];
  return new Set([...gateTasks, ...artifactSubChecks]);
}

describe("the Plugin artifacts job's checks also run before a push (#5023)", () => {
  it("finds the job's package-script checks", () => {
    expect(jobChecks()).toEqual(
      expect.arrayContaining([
        "check:pipeline-status-reads",
        "check:self-pin",
        "check:artifacts",
      ])
    );
  });

  it("gives every one of them a push- or commit-moment arm", () => {
    const local = localTasks();
    const ciOnly = jobChecks().filter(check => !local.has(check));

    expect(ciOnly).toEqual([]);
  });

  it("runs the registry-dependent checks uncached, since the tree cannot key them", () => {
    const { gates } = readGates(ROOT) as {
      gates: Record<string, { push?: { run?: string; cache?: boolean } }>;
    };
    const byTask = new Map(
      Object.values(gates).flatMap(gate =>
        gate.push?.run === undefined ? [] : [[gate.push.run, gate.push]]
      )
    );

    expect(byTask.get("check:self-pin")?.cache).toBe(false);
    expect(byTask.get("check:workflow-package-paths")?.cache).toBe(false);
  });
});

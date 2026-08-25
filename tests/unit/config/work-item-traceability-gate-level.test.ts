/**
 * Tests that `gates.traceability` governs the CI job that bears its name.
 *
 * It did not (#2680). The `🔗 Work-Item Traceability` job's condition keyed on
 * `skip_jobs` and on nothing else, so the declaration reached the LOCAL runner
 * (`lisa-run-gates`, `moments: PR_ONLY`) and reached nothing in CI. Declaring
 * the gate `off` still produced a red check on every pull request; declaring it
 * `required` changed nothing, because the job already ran. One key meant two
 * different things on two surfaces, silently — a declaration that reads as a
 * decision taken and governs nothing.
 *
 * The resolution runs as inline bash inside the reusable `quality.yml`, so the
 * step's `run:` body is the actual unit under test: it is extracted from the
 * workflow and executed against fixture projects, the same way the token-scope
 * readiness gate is covered. Asserting only on the parsed YAML would not tell a
 * working resolver from a deleted one.
 * @module tests/unit/config/work-item-traceability-gate-level
 */

import type { SpawnSyncReturns } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveMoment } from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

/** The reusable workflow whose job the declaration must govern. */
const QUALITY_YML = path.join(REPO_ROOT, ".github", "workflows", "quality.yml");

/** The registry the workflow resolves declarations through. */
const GATES_SCRIPT = path.join(
  REPO_ROOT,
  "all",
  "copy-overwrite",
  "scripts",
  "lisa-gates.mjs"
);

/**
 * The directory the staged scripts reach into for their shared modules.
 *
 * A directory, not a file. This named `lib/invoked-as-script.mjs` and stopped
 * being a faithful copy the moment a staged script imported a second sibling
 * (CodySwannGT/lisa#2980) — the fixture then failed with an
 * ERR_MODULE_NOT_FOUND inside `node_modules/@codyswann/lisa/…`, which reads as
 * the published package missing a file rather than as the fixture naming what
 * it should have read. CodySwannGT/lisa#3082.
 */
const REGISTRY_LIB_DIR = path.join(
  REPO_ROOT,
  "all",
  "copy-overwrite",
  "scripts",
  "lib"
);

/** The job under test. */
const JOB = "work_item_traceability";

/** The gate id that job must resolve. */
const GATE = "traceability";

/** The moment the gate is declared at. */
const PULL_REQUEST = "pull-request";

/**
 * Absolute interpreter path — resolving `bash` through PATH could pick up a
 * fixture directory.
 */
const BASH = "/bin/bash";

/** Shape of the parsed workflow, narrowed to what these tests read. */
interface Workflow {
  readonly jobs: Record<
    string,
    {
      readonly if?: string;
      readonly steps?: readonly {
        name?: string;
        id?: string;
        if?: string;
        run?: string;
        env?: Record<string, string>;
      }[];
    }
  >;
}

const workflow = load(readFileSync(QUALITY_YML, "utf8")) as Workflow;

/** The steps of the traceability job. */
const steps = workflow.jobs[JOB]?.steps ?? [];

/**
 * One named step of the traceability job.
 * @param name - Exact step name
 * @returns The step, or undefined
 */
const stepNamed = (name: string) => steps.find(step => step.name === name);

/**
 * The gate-resolution step's shell body.
 * @returns The step's `run:` script
 */
function resolveScript(): string {
  const step = steps.find(candidate => candidate.id === "gate");
  if (!step?.run) throw new Error(`no gate resolution step in ${JOB}`);
  return step.run;
}

/** Per-test scratch state. */
interface Resources {
  dir: string;
}

const resources: Resources = { dir: "" };

beforeEach(async () => {
  resources.dir = await mkdtemp(path.join(tmpdir(), "lisa-wit-level-"));
});

afterEach(async () => {
  await rm(resources.dir, { recursive: true, force: true });
});

/**
 * Refuse a resolve step that did not complete.
 *
 * The step is `set -euo pipefail`, so a non-zero status means the resolution
 * itself broke. Reading `GITHUB_OUTPUT` anyway would report an empty file as
 * "the gate resolved to nothing" — a failed command read as a measured zero.
 * @param result - The spawn result
 */
function assertResolved(result: SpawnSyncReturns<string>): void {
  if (result.status !== 0) {
    throw new Error(
      `resolve step exited ${String(result.status)}: ${result.stderr ?? ""}`
    );
  }
}

/**
 * Run the extracted resolve step against a fixture project.
 * @param gates - The `gates` block written to `.lisa.config.json`, or null to
 *   write a config carrying no gates block at all
 * @returns The key/value lines the step wrote to `GITHUB_OUTPUT`
 */
function runResolve(gates: Record<string, unknown> | null): string {
  const project = path.join(resources.dir, "project");
  const output = path.join(resources.dir, "github-output");
  const script = path.join(resources.dir, "resolve.sh");
  const config = JSON.stringify(
    gates === null ? { tracker: "github" } : { gates }
  );
  const body = resolveScript();
  const env = {
    ...process.env,
    GATE_ID: GATE,
    GATE_MOMENT: PULL_REQUEST,
    FALLBACK_RUNNER: "npm run",
    GITHUB_OUTPUT: output,
  };

  mkdirSync(path.join(project, "scripts", "lib"), { recursive: true });
  // The host-side copy of the registry, which is what an applied project
  // carries. The step prefers the installed package and falls back to this.
  copyFileSync(GATES_SCRIPT, path.join(project, "scripts", "lisa-gates.mjs"));
  cpSync(REGISTRY_LIB_DIR, path.join(project, "scripts", "lib"), {
    recursive: true,
  });
  writeFileSync(path.join(project, ".lisa.config.json"), config);
  writeFileSync(output, "");
  writeFileSync(script, body);
  assertResolved(
    boundedSpawnSync({
      label: "the traceability job's resolve step",
      command: BASH,
      args: ["-e", script],
      cwd: project,
      env,
    })
  );
  return readFileSync(output, "utf8");
}

describe("the traceability job resolves its gate from .lisa.config.json", () => {
  it("emits configured=off when the project declared the gate off", () => {
    // The acceptance criterion of #2680: a declared level has to change what
    // CI does. Before the fix nothing in this job read the config at all.
    expect(runResolve({ traceability: { [PULL_REQUEST]: "off" } })).toContain(
      "configured=off"
    );
  });

  it("emits configured=true and the registry task when declared required", () => {
    const out = runResolve({ traceability: { [PULL_REQUEST]: "required" } });

    expect(out).toContain("configured=true");
    expect(out).toContain("task=check:work-item");
  });

  it("resolves an optional declaration exactly like a required one", () => {
    // `optional` is expressed by `contextsFor` emitting no required context,
    // NOT by the step swallowing its exit code — a step that reported green
    // while failing is the defect this façade exists to prevent.
    expect(
      runResolve({ traceability: { [PULL_REQUEST]: "optional" } })
    ).toContain("configured=true");
  });

  it("emits configured=false when the project never declared the gate", () => {
    // The fallback path: an unmigrated project keeps today's built-in
    // validator, byte for byte.
    expect(runResolve(null)).toContain("configured=false");
  });

  it("emits configured=false when the gate is declared at another moment", () => {
    expect(runResolve({ traceability: { push: "required" } })).toContain(
      "configured=false"
    );
  });
});

describe("an off declaration reaches neither branch of the job", () => {
  it("runs the project's task only on configured=true", () => {
    expect(stepNamed("🔗 Run the traceability gate")?.if).toBe(
      "steps.gate.outputs.configured == 'true'"
    );
  });

  it("runs the built-in validator only on configured=false", () => {
    // `== 'false'`, never `!= 'true'`: `off` satisfies the negative form, so
    // the built-in would keep failing pull requests the declaration disabled.
    expect(stepNamed("🔗 Validate Work-Item traceability")?.if).toBe(
      "steps.gate.outputs.configured == 'false'"
    );
  });

  it("leaves the job's own condition free of the gates block", () => {
    // A required status context that runs ZERO steps reports SATISFIED on
    // GitHub. `off` must therefore empty the job, not skip it; retiring the
    // context is `contextsFor`'s job, from the same declaration.
    const condition = workflow.jobs[JOB]?.if ?? "";
    expect(condition).toContain("github.event_name == 'pull_request'");
    expect(condition).not.toContain("lisa.config");
    expect(condition).not.toContain("gates");
  });
});

describe("the local runner and CI reach the same verdict", () => {
  it("hides an off gate from the local runner while CI reports it off", () => {
    const gates = { traceability: { [PULL_REQUEST]: "off" } };

    // Local: `lisa-run-gates` resolves without `includeOff`, so the gate is
    // absent and nothing runs it.
    expect(
      resolveMoment({ gates, moment: PULL_REQUEST }).map(gate => gate.id)
    ).toEqual([]);
    // CI: the façade asks for the off state and runs neither branch.
    expect(runResolve(gates)).toContain("configured=off");
  });

  it("gives both surfaces the same task when the gate is required", () => {
    const gates = { traceability: { [PULL_REQUEST]: "required" } };
    const local = resolveMoment({ gates, moment: PULL_REQUEST }).find(
      gate => gate.id === GATE
    );

    expect(local?.task).toBe("check:work-item");
    expect(runResolve(gates)).toContain("task=check:work-item");
  });
});

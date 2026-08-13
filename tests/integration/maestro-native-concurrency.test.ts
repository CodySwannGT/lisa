/**
 * Contract tests for the opt-in cross-run concurrency mutex on the Maestro
 * native e2e reusable workflow and its expo caller template.
 *
 * The caller template's own group is covered by maestro-caller-template.test.ts.
 *
 * Two suites that drive one backend — this workflow and the Playwright suite
 * running through quality.yml — must be able to exclude each other. The
 * mechanism is a shared `concurrency_group` string, and these tests pin the
 * two properties that make it safe:
 *
 *   1. Opting OUT must be free. An unset input resolves to a group unique to
 *      the run, so no run ever waits on another and a parent/child deadlock is
 *      impossible by construction.
 *   2. The group must never be keyed on `github.ref`. A ref-keyed group hands
 *      two branches two different groups over one database, which looks like
 *      exclusion and is not.
 *
 * The negative assertions check presence before absence: `undefined` contains
 * no "github.ref" either, so a deleted concurrency block would satisfy a bare
 * `not.toContain` and the guard would pass by doing nothing.
 */

import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REUSABLE_YML = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "maestro-native-e2e.yml"
);

/** Shape of a single `workflow_call` input declaration. */
interface WorkflowInput {
  description?: string;
  required?: boolean;
  default?: unknown;
  type?: string;
}

/** The workflow-level `concurrency` block. */
interface Concurrency {
  group?: string;
  "cancel-in-progress"?: boolean;
}

/** Root shape of the parsed reusable workflow. */
interface ReusableWorkflow {
  on: {
    workflow_call?: {
      inputs?: Record<string, WorkflowInput>;
    };
  };
  concurrency?: Concurrency;
}

describe("maestro-native-e2e cross-run concurrency mutex (opt-in)", () => {
  let workflow: ReusableWorkflow;

  beforeAll(async () => {
    workflow = yaml.load(
      await fs.readFile(REUSABLE_YML, "utf-8")
    ) as ReusableWorkflow;
  });

  it("declares a concurrency_group input defaulting to '' (no serialization)", () => {
    const input = workflow.on.workflow_call?.inputs?.concurrency_group;
    expect(input).toBeDefined();
    expect(input?.required).toBe(false);
    expect(input?.default).toBe("");
    expect(input?.type).toBe("string");
  });

  it("sets a top-level concurrency that queues rather than cancels", () => {
    // cancel-in-progress must be false so opted-in runs queue (serialize)
    // instead of cancelling each other. A native suite cancelled mid-run
    // leaves the shared backend's fixtures and test accounts in whatever
    // state the last flow left them, which poisons the next run.
    expect(workflow.concurrency).toBeDefined();
    expect(workflow.concurrency?.["cancel-in-progress"]).toBe(false);
  });

  it("falls back to a per-run unique group when the input is unset", () => {
    // Default behavior must be identical to having no concurrency: when
    // concurrency_group is empty the group resolves to a github.run_id-keyed
    // string, so no run ever waits on another (and no parent/child deadlock).
    const group = workflow.concurrency?.group ?? "";
    expect(group).toContain("inputs.concurrency_group");
    expect(group).toContain("github.run_id");
  });

  it("never keys the fallback group on github.ref", () => {
    // A ref-keyed group is not exclusion: two branches get two groups while
    // sharing one backend. The environment is what is being protected, so
    // only a caller-supplied constant may name the group.
    const group = workflow.concurrency?.group;
    expect(group).toBeTruthy();
    expect(group).not.toContain("github.ref");
  });
});

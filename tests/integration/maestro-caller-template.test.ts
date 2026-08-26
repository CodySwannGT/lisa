/**
 * Contract tests for the expo Maestro caller template
 * (`expo/create-only/.github/workflows/maestro-e2e.yml`).
 *
 * Split out of maestro-native-workflow.test.ts, which covers the reusable
 * workflow this template calls. The template is worth its own file because it
 * is COPIED into every adopting project verbatim — a defect here does not stay
 * in Lisa, it propagates. The environment-keyed concurrency group below is
 * exactly that: the template shipped `maestro-e2e-${{ github.ref }}` and every
 * adopter inherited it.
 */
import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CALLER_YML = path.join(
  REPO_ROOT,
  "expo",
  "create-only",
  ".github",
  "workflows",
  "maestro-e2e.yml"
);

/** Shape of a single job inside a workflow's `jobs:` map. */
interface WorkflowJob {
  uses?: string;
  with?: Record<string, unknown>;
  secrets?: Record<string, unknown>;
}

/** Root shape of the parsed caller template. */
interface CallerWorkflow {
  on: {
    schedule?: Array<{ cron: string }>;
    workflow_dispatch?: {
      inputs?: Record<string, { type?: string; options?: string[] }>;
    };
  };
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  jobs: Record<string, WorkflowJob>;
}

describe("expo maestro-e2e caller template", () => {
  let workflow: CallerWorkflow;

  beforeAll(async () => {
    workflow = yaml.load(
      await fs.readFile(CALLER_YML, "utf-8")
    ) as CallerWorkflow;
  });

  it("keeps the production cadence: nightly cron plus on-demand dispatch", () => {
    expect(workflow.on.schedule).toEqual([{ cron: "0 9 * * *" }]);
    const platform = workflow.on.workflow_dispatch?.inputs?.platform;
    expect(platform?.type).toBe("choice");
    expect(platform?.options).toEqual(["all", "android", "ios"]);
  });

  it("serializes runs without cancelling in-flight suites", () => {
    expect(workflow.concurrency?.["cancel-in-progress"]).toBe(false);
  });

  it("keys its own group on the environment, not on github.ref", () => {
    // Every run of this template drives the same backend regardless of which
    // branch dispatched it, so a ref-keyed group hands two branches two
    // different groups over one database — the appearance of exclusion
    // without exclusion. The group must be a constant.
    // Presence first — a deleted concurrency block contains no "github.ref"
    // either, and would otherwise satisfy these negatives by doing nothing.
    const group = workflow.concurrency?.group;
    expect(group).toBeTruthy();
    expect(group).not.toContain("github.ref");
    expect(group).not.toContain("${{");
  });

  it("delegates to the Lisa reusable workflow and forwards the platform picker", () => {
    const job = workflow.jobs.maestro;
    expect(job.uses).toBe(
      "CodySwannGT/lisa/.github/workflows/maestro-native-e2e.yml@main"
    );
    expect(job.with?.platform).toBe("${{ inputs.platform || 'all' }}");
    expect(job.secrets?.EXPO_TOKEN).toBe("${{ secrets.EXPO_TOKEN }}");
    expect(job.secrets?.MAESTRO_SECRET_ENV).toBe(
      "${{ secrets.MAESTRO_SECRET_ENV }}"
    );
  });

  it("requires reset then reseed before the native suite", () => {
    const job = workflow.jobs.maestro;

    expect(job.with?.prepare_environment).toBe("development");
    expect(job.with?.prepare_verbs).toBe("reset,reseed");
  });
});

import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Derive the repo root from this test file's location so the test is
// portable across worktrees and CI working directories.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const QUALITY_YML = path.join(REPO_ROOT, ".github", "workflows", "quality.yml");

/** Shape of a single `workflow_call` input declaration. */
interface WorkflowInput {
  description?: string;
  required?: boolean;
  default?: unknown;
  type?: string;
}

/** Shape of a single step inside a workflow job's `steps:` list. */
interface WorkflowStep {
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  with?: Record<string, unknown>;
}

/** Shape of a single job inside a workflow's `jobs:` map. */
interface WorkflowJob {
  name?: string;
  "runs-on"?: string;
  "timeout-minutes"?: number;
  needs?: string | string[];
  if?: string;
  strategy?: { matrix?: Record<string, unknown>; "fail-fast"?: boolean };
  steps?: WorkflowStep[];
}

/** Root shape of the parsed `quality.yml` reusable workflow. */
interface QualityWorkflow {
  on: {
    workflow_call?: {
      inputs?: Record<string, WorkflowInput>;
    };
  };
  jobs: Record<string, WorkflowJob>;
}

describe("quality.yml reusable workflow", () => {
  let workflow: QualityWorkflow;

  beforeAll(() => {
    const raw = fs.readFileSync(QUALITY_YML, "utf8");
    workflow = yaml.load(raw) as QualityWorkflow;
  });

  describe("SE-4551 + SE-4552 new inputs", () => {
    it("declares playwright_shards with default 1 (unchanged behavior)", () => {
      const input = workflow.on.workflow_call?.inputs?.playwright_shards;
      expect(input).toBeDefined();
      expect(input?.required).toBe(false);
      expect(input?.default).toBe(1);
      expect(input?.type).toBe("number");
    });

    it("declares cache_build with default false (unchanged behavior)", () => {
      const input = workflow.on.workflow_call?.inputs?.cache_build;
      expect(input).toBeDefined();
      expect(input?.required).toBe(false);
      expect(input?.default).toBe(false);
      expect(input?.type).toBe("boolean");
    });
  });

  describe("playwright_e2e job preservation", () => {
    it("preserves runs-on ubuntu-latest and timeout-minutes 30", () => {
      const job = workflow.jobs.playwright_e2e;
      expect(job).toBeDefined();
      expect(job["runs-on"]).toBe("ubuntu-latest");
      expect(job["timeout-minutes"]).toBe(30);
    });

    it("declares matrix strategy fed by the setup job's shards output", () => {
      const job = workflow.jobs.playwright_e2e;
      expect(job.needs).toBe("playwright_e2e_setup");
      expect(job.strategy?.["fail-fast"]).toBe(false);
      expect(job.strategy?.matrix?.shard).toContain(
        "fromJSON(needs.playwright_e2e_setup.outputs.shards)"
      );
    });
  });

  describe("artifact upload preserves unsharded behavior", () => {
    it("uploads playwright-report-<run-id> (no suffix) when playwright_shards <= 1", () => {
      const steps = workflow.jobs.playwright_e2e.steps ?? [];
      const unsharded = steps.find(
        s => s.name === "📤 Upload Playwright report (unsharded)"
      );
      expect(unsharded).toBeDefined();
      expect(unsharded?.if).toContain("inputs.playwright_shards <= 1");
      expect(unsharded?.with?.name).toBe(
        "playwright-report-${{ github.run_id }}"
      );
    });

    it("uploads per-shard blob reports when playwright_shards > 1", () => {
      const steps = workflow.jobs.playwright_e2e.steps ?? [];
      const sharded = steps.find(
        s => s.name === "📤 Upload Playwright blob (sharded)"
      );
      expect(sharded).toBeDefined();
      expect(sharded?.if).toContain("inputs.playwright_shards > 1");
      expect(sharded?.with?.name).toBe(
        "playwright-blob-${{ github.run_id }}-shard-${{ matrix.shard }}"
      );
    });
  });

  describe("merge_playwright_reports job", () => {
    it("exists and is gated on playwright_shards > 1", () => {
      const job = workflow.jobs.merge_playwright_reports;
      expect(job).toBeDefined();
      expect(job.needs).toBe("playwright_e2e");
      expect(job.if).toContain("inputs.playwright_shards > 1");
    });

    it("uploads the merged HTML as playwright-report-<run-id>-merged", () => {
      const steps = workflow.jobs.merge_playwright_reports.steps ?? [];
      const upload = steps.find(
        s => s.name === "📤 Upload merged Playwright report"
      );
      expect(upload).toBeDefined();
      expect(upload?.with?.name).toBe(
        "playwright-report-${{ github.run_id }}-merged"
      );
    });
  });
});

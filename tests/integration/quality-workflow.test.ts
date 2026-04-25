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
  id?: string;
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
    it("preserves runs-on ubuntu-latest and timeout-minutes 60", () => {
      const job = workflow.jobs.playwright_e2e;
      expect(job).toBeDefined();
      expect(job["runs-on"]).toBe("ubuntu-latest");
      expect(job["timeout-minutes"]).toBe(60);
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

  describe("matrix always uploads blob", () => {
    it("uploads per-shard blob regardless of playwright_shards value", () => {
      const steps = workflow.jobs.playwright_e2e.steps ?? [];
      const uploads = steps.filter(s =>
        s.uses?.startsWith("actions/upload-artifact")
      );
      // Exactly one upload step — the always-blob path — so unsharded and
      // sharded runs both feed the aggregator uniformly.
      expect(uploads).toHaveLength(1);
      const [blob] = uploads;
      expect(blob.name).toBe("📤 Upload Playwright blob");
      expect(blob.if).not.toContain("playwright_shards");
      expect(blob.with?.name).toBe(
        "playwright-blob-${{ github.run_id }}-shard-${{ matrix.shard }}"
      );
    });
  });

  describe("playwright_e2e_aggregate job (ruleset anchor)", () => {
    it("exists, needs the matrix, and always runs (no shard gate)", () => {
      const job = workflow.jobs.playwright_e2e_aggregate;
      expect(job).toBeDefined();
      expect(job.needs).toBe("playwright_e2e");
      // Aggregator must emit its check on every run so the unsuffixed
      // required-status-check context (`🎭 Playwright E2E Tests`) is
      // produced regardless of `playwright_shards` value.
      expect(job.if).not.toContain("inputs.playwright_shards");
      expect(job.if).toContain("always()");
    });

    it("is named `🎭 Playwright E2E Tests` to match the required check context", () => {
      // The matrix `playwright_e2e` job shares this display name, but the
      // matrix suffixes its context with `(<shard>)`, so only the
      // aggregator produces the unsuffixed context the ruleset requires.
      expect(workflow.jobs.playwright_e2e_aggregate.name).toBe(
        "🎭 Playwright E2E Tests"
      );
    });

    it("uploads the merged HTML as playwright-report-<run-id>", () => {
      const steps = workflow.jobs.playwright_e2e_aggregate.steps ?? [];
      const upload = steps.find(
        s => s.name === "📤 Upload merged Playwright report"
      );
      expect(upload).toBeDefined();
      // Preserve the original unsharded artifact name so consumers who
      // download `playwright-report-<run-id>` keep working after opt-in.
      expect(upload?.with?.name).toBe("playwright-report-${{ github.run_id }}");
    });

    it("gates merge-reports on has_config so repos without playwright skip cleanly", () => {
      // Repos with no playwright.config.* produce no blob artifacts from the
      // shard matrix (check_playwright.has_config=false in each shard). The
      // aggregator must apply the same has_config gate to its download/merge
      // steps — otherwise `npx playwright merge-reports` runs against an
      // empty directory and fails, breaking the required-status-check.
      const steps = workflow.jobs.playwright_e2e_aggregate.steps ?? [];
      const check = steps.find(s => s.id === "check_playwright");
      expect(check).toBeDefined();
      const merge = steps.find(
        s => s.name === "🎭 Merge blob reports into HTML"
      );
      expect(merge?.if).toContain(
        "steps.check_playwright.outputs.has_config == 'true'"
      );
    });
  });

  describe("matrix job keeps unified check-context display name", () => {
    it("uses `🎭 Playwright E2E Tests` so shards produce `(N)` suffix checks", () => {
      // Matrix always suffixes with `(<matrix-value>)`, giving non-blocking
      // per-shard checks that coexist with the aggregator's unsuffixed
      // context under the same display name.
      expect(workflow.jobs.playwright_e2e.name).toBe("🎭 Playwright E2E Tests");
    });
  });
});

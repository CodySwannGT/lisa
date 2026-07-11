import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Derive the repo root from this test file's location so the test is
// portable across worktrees and CI working directories.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const QUALITY_YML = path.join(REPO_ROOT, ".github", "workflows", "quality.yml");
const QUALITY_RAILS_YML = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "quality-rails.yml"
);
const RELEASE_YML = path.join(REPO_ROOT, ".github", "workflows", "release.yml");
const DEPLOY_YML = path.join(REPO_ROOT, ".github", "workflows", "deploy.yml");

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
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
}

/** Shape of a single job inside a workflow's `jobs:` map. */
interface WorkflowJob {
  name?: string;
  "runs-on"?: string;
  "timeout-minutes"?: number;
  needs?: string | string[];
  if?: string;
  environment?: unknown;
  permissions?: Record<string, unknown>;
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
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  jobs: Record<string, WorkflowJob>;
}

/** Root shape of the parsed `release.yml` reusable workflow. */
interface ReleaseWorkflow {
  jobs: Record<string, WorkflowJob>;
}

/** Root shape of the parsed `deploy.yml` workflow. */
interface DeployWorkflow {
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
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

  describe("cross-run concurrency mutex (opt-in)", () => {
    it("declares concurrency_group input defaulting to '' (no serialization)", () => {
      const input = workflow.on.workflow_call?.inputs?.concurrency_group;
      expect(input).toBeDefined();
      expect(input?.required).toBe(false);
      expect(input?.default).toBe("");
      expect(input?.type).toBe("string");
    });

    it("sets a top-level concurrency that queues rather than cancels", () => {
      // cancel-in-progress must be false so opted-in runs queue (serialize)
      // instead of cancelling each other — cancelling mid-run is what leaves
      // shared external state (e.g. a test user's server-side org) dirty.
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

  describe("verification coverage labels", () => {
    it("passes event labels to the coverage script without live GitHub context", () => {
      const job = workflow.jobs.verification_coverage;
      expect(job.permissions).toBeUndefined();

      const steps = job.steps ?? [];
      const check = steps.find(s =>
        s.run?.includes("check-verification-coverage.mjs")
      );
      expect(check).toBeDefined();
      expect(check?.env?.VERIFY_PR_NUMBER).toBeUndefined();
      expect(check?.env?.VERIFY_GITHUB_REPOSITORY).toBeUndefined();
      expect(check?.env?.VERIFY_GITHUB_TOKEN).toBeUndefined();
      expect(check?.env?.VERIFY_LABELS).toContain(
        "github.event.pull_request.labels"
      );
    });
  });

  describe("cross-repo reusable workflow token handling", () => {
    it("does not declare reserved GITHUB_* environment keys", () => {
      for (const [jobName, job] of Object.entries(workflow.jobs)) {
        for (const step of job.steps ?? []) {
          const envKeys = Object.keys(step.env ?? {});
          const reservedKeys = envKeys.filter(key => key.startsWith("GITHUB_"));
          expect(reservedKeys, `${jobName}: ${step.name ?? step.id}`).toEqual(
            []
          );
        }
      }
    });

    it("passes only SonarCloud's token to the SonarCloud action", () => {
      const steps = workflow.jobs.sonarcloud.steps ?? [];
      const scan = steps.find(
        s => s.uses === "SonarSource/sonarqube-scan-action@v6.0.0"
      );

      expect(scan).toBeDefined();
      expect(scan?.env?.SONAR_TOKEN).toBe("${{ secrets.SONAR_TOKEN }}");
      expect(scan?.env).not.toHaveProperty("GITHUB_TOKEN");
    });
  });

  describe("cross-repo reusable workflow approval gate", () => {
    it("does not bind a dynamic environment in the optional approval job", () => {
      expect(workflow.jobs.approval_gate.environment).toBeUndefined();
    });
  });

  describe("GitGuardian quota exhaustion", () => {
    it.each([
      ["quality.yml", QUALITY_YML],
      ["quality-rails.yml", QUALITY_RAILS_YML],
    ])("%s soft-fails only quota exhaustion", (_label, workflowPath) => {
      const raw = fs.readFileSync(workflowPath, "utf8");
      const parsed = yaml.load(raw) as QualityWorkflow;
      const steps = parsed.jobs.secret_scanning.steps ?? [];
      const scan = steps.find(s => s.name === "🔐 GitGuardian scan");

      expect(scan).toBeDefined();
      expect(scan?.uses).toBeUndefined();
      expect(scan?.run).toContain("ggshield secret scan ci");
      expect(scan?.run).not.toContain("--show-secrets");
      expect(scan?.run).not.toContain("--all-policies");
      expect(scan?.run).toContain("no more API calls available");
      expect(scan?.run).toContain('exit "$scan_status"');
    });
  });

  describe("bun audit allowlist handling", () => {
    it("filters bun audit JSON by GHSA, advisory id, and CVE allowlists", () => {
      const steps = workflow.jobs.npm_security_scan.steps ?? [];
      const audit = steps.find(s => s.name === "🔒 Run security audit");
      const run = audit?.run ?? "";

      // Production-scoped, matching the pre-push hook and the npm/yarn paths so
      // the local and CI audit gates agree (dev/supply-chain is Snyk's job).
      expect(run).toContain("bun audit --production --json");
      expect(run).not.toContain(
        "bun audit --audit-level=high $BUN_IGNORE_FLAGS"
      );
      expect(run).not.toContain("--ignore=$_id");
      expect(run).toContain('ghsa_id: (.url // "" | split("/") | last)');
      expect(run).toContain('advisory_id: (.id // "" | tostring)');
      expect(run).toContain("cves: ([.cve?, .cves[]?]");
      expect(run).toContain("$ghsa_ids | index($id)");
      expect(run).toContain("$cve_ids | index($cve)");
    });
  });
});

describe("release and deploy workflows", () => {
  let releaseWorkflow: ReleaseWorkflow;
  let deployWorkflow: DeployWorkflow;

  beforeAll(() => {
    releaseWorkflow = yaml.load(
      fs.readFileSync(RELEASE_YML, "utf8")
    ) as ReleaseWorkflow;
    deployWorkflow = yaml.load(
      fs.readFileSync(DEPLOY_YML, "utf8")
    ) as DeployWorkflow;
  });

  it("pushes signed release tags after creating them", () => {
    const steps = releaseWorkflow.jobs.release_signing.steps ?? [];
    const signTag = steps.find(s => s.name === "Create Signed Git Tag");
    const run = signTag?.run ?? "";

    expect(signTag).toBeDefined();
    expect(run).toContain("git tag -s");
    expect(run).toContain(
      'git push origin "refs/tags/${{ needs.version.outputs.tag }}:refs/tags/${{ needs.version.outputs.tag }}"'
    );
  });

  it("normalizes versions and bumps past existing tags before composing release tags", () => {
    // Version counters are branch-local but tags are repo-global (dev and
    // staging can compute the same next version); custom pins never bump.
    const steps = releaseWorkflow.jobs.version.steps ?? [];
    const run = steps.find(s => s.name === "Determine Version")?.run ?? "";

    expect(run).toContain("awk '{print $4}'");
    expect(run).toContain('npx semver -i patch "$VERSION"');
    expect(run).toContain('!= "custom"');

    expect(run).toContain('VERSION="${VERSION#v}"');
    const guardIndex = run.indexOf("git rev-parse -q --verify");
    expect(guardIndex).toBeGreaterThan(run.indexOf('VERSION="${VERSION#v}"'));
    expect(run.indexOf('echo "version=$VERSION"')).toBeGreaterThan(guardIndex);
    expect(run.indexOf('echo "tag=v$VERSION"')).toBeGreaterThan(guardIndex);
  });

  it("fails release creation on API errors but reuses an existing release on rerun", () => {
    const steps = releaseWorkflow.jobs.github_release.steps ?? [];
    const createRelease = steps.find(s => s.name === "Create GitHub Release");
    const run = createRelease?.run ?? "";

    expect(createRelease).toBeDefined();
    expect(run).toContain('-w "%{http_code}"');
    expect(run).toContain(
      '[ "$HTTP_CODE" -lt 200 ] || [ "$HTTP_CODE" -ge 300 ]'
    );
    expect(run).toContain("exit 1");
    expect(run).toContain('select(.code == "already_exists")');
    expect(run).toContain("releases/tags/${{ needs.version.outputs.tag }}");
    expect(run).toContain('[ "$TARGET" != "${{ github.sha }}" ]');
    expect(run).toContain("jq -e -r '.html_url'");
    expect(run).toContain("jq -e -r '.id'");
    expect(run).toContain("jq -e -r '.upload_url'");
  });

  it("queues release deploy runs instead of cancelling in-flight publishes", () => {
    expect(deployWorkflow.concurrency).toBeDefined();
    expect(deployWorkflow.concurrency?.["cancel-in-progress"]).toBe(false);
  });
});

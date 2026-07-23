/* eslint-disable max-lines -- workflow contract coverage intentionally exercises several reusable templates in one parse pass */
import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Derive the repo root from this test file's location so the test is
// portable across worktrees and CI working directories.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github", "workflows");
const DEPLOY_WORKFLOW_FILE = "deploy.yml";
const QUALITY_YML = path.join(WORKFLOWS_DIR, "quality.yml");
const QUALITY_RAILS_YML = path.join(WORKFLOWS_DIR, "quality-rails.yml");
const RELEASE_YML = path.join(WORKFLOWS_DIR, "release.yml");
const DEPLOY_YML = path.join(WORKFLOWS_DIR, DEPLOY_WORKFLOW_FILE);
/**
 * Absolute path of a stack template's create-only deploy workflow.
 * @param stack Stack template directory name.
 * @returns Path to `<stack>/create-only/.github/workflows/deploy.yml`.
 */
function stackDeployPath(stack: string): string {
  return path.join(
    REPO_ROOT,
    stack,
    "create-only",
    ".github",
    "workflows",
    DEPLOY_WORKFLOW_FILE
  );
}
const NESTJS_DEPLOY_YML = stackDeployPath("nestjs");
const EXPO_DEPLOY_YML = stackDeployPath("expo");
const EAS_BUILD_YML = path.join(WORKFLOWS_DIR, "build.yml");
const CREATE_ISSUE_ON_FAILURE_YML = path.join(
  WORKFLOWS_DIR,
  "create-issue-on-failure.yml"
);
const CREATE_GITHUB_ISSUE_ON_FAILURE_YML = path.join(
  WORKFLOWS_DIR,
  "create-github-issue-on-failure.yml"
);

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
  "working-directory"?: string;
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
  outputs?: Record<string, string>;
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
  permissions?: Record<string, unknown>;
  jobs: Record<string, WorkflowJob>;
}

/** Root shape of the parsed `release.yml` reusable workflow. */
interface ReleaseWorkflow {
  jobs: Record<string, WorkflowJob>;
}

/** Root shape of the parsed `deploy.yml` workflow. */
interface DeployWorkflow {
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  jobs?: Record<string, WorkflowJob>;
}

/** Root shape for lightweight reusable workflow contract checks. */
interface ReusableWorkflow {
  on?: {
    workflow_call?: {
      secrets?: Record<string, { required?: boolean }>;
    };
  };
  jobs?: Record<string, WorkflowJob>;
}

/**
 * Normalize GitHub Actions' scalar-or-list `needs` value for assertions.
 *
 * @param job Parsed workflow job.
 * @returns Job dependency names.
 */
function needsList(job: WorkflowJob | undefined): string[] {
  if (!job?.needs) {
    return [];
  }

  return Array.isArray(job.needs) ? job.needs : [job.needs];
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

    it("includes the source root in build cache keys", () => {
      const playwrightExpoCache = workflow.jobs.playwright_e2e.steps?.find(
        step => step.id === "expo_cache"
      );
      const buildCache = workflow.jobs.build.steps?.find(
        step => step.id === "build_cache"
      );

      expect(playwrightExpoCache?.with?.key).toContain("'**/src/**'");
      expect(buildCache?.with?.key).toContain("'**/src/**'");
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
      // The job declares no permissions of its own, so it resolves to the
      // workflow-level least-privilege floor (#1769). What must never change
      // is that it gains no `pull-requests` scope — the gate reads PR labels
      // from the event payload, not the API.
      expect(workflow.permissions).toEqual({ contents: "read" });
      expect(job.permissions?.["pull-requests"]).toBeUndefined();

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

  describe("e2e route coverage dependencies", () => {
    it("installs host dependencies after detection and before route analysis", () => {
      const steps = workflow.jobs.e2e_coverage.steps ?? [];
      const checkIndex = steps.findIndex(step => step.id === "check_script");
      const bunIndex = steps.findIndex(step => step.name === "🍞 Setup Bun");
      const installIndex = steps.findIndex(
        step => step.name === "📦 Install dependencies"
      );
      const requireIndex = steps.findIndex(
        step => step.name === "🧭 Require e2e route/screen coverage thresholds"
      );

      expect(checkIndex).toBeGreaterThanOrEqual(0);
      expect(bunIndex).toBeGreaterThan(checkIndex);
      expect(installIndex).toBeGreaterThan(bunIndex);
      expect(requireIndex).toBeGreaterThan(installIndex);

      const setupBun = steps[bunIndex];
      expect(setupBun?.if).toContain(
        "steps.check_script.outputs.exists == 'true'"
      );
      expect(setupBun?.if).toContain("inputs.package_manager == 'bun'");

      const install = steps[installIndex];
      expect(install?.if).toBe("steps.check_script.outputs.exists == 'true'");
      expect(install?.env?.PACKAGE_MANAGER).toBe(
        "${{ inputs.package_manager }}"
      );
      expect(install?.run).not.toContain("${{ inputs.package_manager }}");
      expect(install?.run).toMatch(
        /if \[\s*"\$PACKAGE_MANAGER"\s*=\s*"npm"\s*\]; then[\s\S]*npm ci/
      );
      expect(install?.run).toContain("yarn install --frozen-lockfile");
      expect(install?.run).toContain("bun install --frozen-lockfile");
      expect(install?.["working-directory"]).toBe(
        "${{ inputs.working_directory || '.' }}"
      );
    });
  });

  describe("least-privilege permissions floor", () => {
    it("declares a workflow-level contents:read floor", () => {
      // #1769: quality.yml is consumed fleet-wide via @main. Reusable-workflow
      // tokens can only be downgraded relative to the caller's grant, so a
      // read-only floor is safe for every consumer while capping consumers
      // whose caller job declares no `permissions:` block of its own.
      expect(workflow.permissions).toEqual({ contents: "read" });
    });

    it("gives summary-only jobs an empty permissions block", () => {
      // These jobs neither check out the repository nor call the API.
      for (const jobName of [
        "playwright_e2e_setup",
        "security_tools_summary",
        "compliance_validation",
        "performance_summary",
      ]) {
        expect(workflow.jobs[jobName]?.permissions, jobName).toEqual({});
      }
    });

    it("resolves every job to a scope with no write access", () => {
      // Effective scope = job-level block when present, otherwise the
      // workflow-level floor. An audit of all jobs found zero uses of `gh`,
      // `github.rest.*`, `GITHUB_TOKEN`, or `github.token`, so no job needs a
      // write scope. This assertion catches a future job silently regressing
      // the floor by declaring one.
      for (const [jobName, job] of Object.entries(workflow.jobs)) {
        const effective = job.permissions ?? workflow.permissions ?? {};
        const writeScopes = Object.entries(effective)
          .filter(([, value]) => value === "write")
          .map(([scope]) => scope);
        expect(writeScopes, `${jobName} must not hold a write scope`).toEqual(
          []
        );
      }
    });

    it("checks out without persisting the git credential", () => {
      // A persisted credential outlives the checkout step and is readable by
      // every later step (and any compromised third-party action) in the job.
      // No job in this workflow reuses the checkout credential.
      for (const [jobName, job] of Object.entries(workflow.jobs)) {
        for (const step of job.steps ?? []) {
          if (!step.uses?.startsWith("actions/checkout@")) {
            continue;
          }

          expect(step.with?.["persist-credentials"], jobName).toBe(false);
        }
      }
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

describe("learnings-budget gate (#1730)", () => {
  // The post-relocation pin must use the resolver-aware CLI and keep the marker
  // assertion so the gate cannot silently pass through a self-skipping CLI.
  it.each([QUALITY_YML, QUALITY_RAILS_YML])(
    "%s gates the resolved project learnings ledger",
    file => {
      const workflow = fs.readFileSync(file, "utf8");

      expect(workflow).toContain(
        "bunx @codyswann/lisa@2.243.0 check-learnings-budget | tee learnings-budget.out"
      );
      expect(
        workflow.match(/grep -qE "learnings budget passed\|no learnings file"/g)
      ).toHaveLength(1);
      expect(workflow).not.toContain(
        "check-learnings-budget .lisa/PROJECT_LEARNINGS.md"
      );
      expect(workflow).not.toContain("learnings-budget-relocated.out");
    }
  );
});

describe("release and deploy workflows", () => {
  let releaseWorkflow: ReleaseWorkflow;
  let deployWorkflow: DeployWorkflow;
  let nestjsDeployRaw: string;
  let nestjsDeployWorkflow: DeployWorkflow;
  let expoDeployWorkflow: DeployWorkflow;
  let easBuildWorkflow: ReusableWorkflow;
  let createIssueOnFailureWorkflow: ReusableWorkflow;
  let createGithubIssueOnFailureWorkflow: ReusableWorkflow;

  beforeAll(() => {
    releaseWorkflow = yaml.load(
      fs.readFileSync(RELEASE_YML, "utf8")
    ) as ReleaseWorkflow;
    deployWorkflow = yaml.load(
      fs.readFileSync(DEPLOY_YML, "utf8")
    ) as DeployWorkflow;
    nestjsDeployRaw = fs.readFileSync(NESTJS_DEPLOY_YML, "utf8");
    nestjsDeployWorkflow = yaml.load(nestjsDeployRaw) as DeployWorkflow;
    expoDeployWorkflow = yaml.load(
      fs.readFileSync(EXPO_DEPLOY_YML, "utf8")
    ) as DeployWorkflow;
    easBuildWorkflow = yaml.load(
      fs.readFileSync(EAS_BUILD_YML, "utf8")
    ) as ReusableWorkflow;
    createIssueOnFailureWorkflow = yaml.load(
      fs.readFileSync(CREATE_ISSUE_ON_FAILURE_YML, "utf8")
    ) as ReusableWorkflow;
    createGithubIssueOnFailureWorkflow = yaml.load(
      fs.readFileSync(CREATE_GITHUB_ISSUE_ON_FAILURE_YML, "utf8")
    ) as ReusableWorkflow;
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

  it("keeps NestJS dotenv materialization opt-in and env-driven", () => {
    const deploySteps = nestjsDeployWorkflow.jobs?.deploy.steps ?? [];
    const dotenvStep = deploySteps.find(
      step => step.name === "Materialize dotenv env file"
    );

    expect(dotenvStep).toBeDefined();
    expect(dotenvStep?.if).toBe(
      "${{ vars.DOTENV_ENV_MATERIALIZATION_KEYS != '' }}"
    );
    expect(dotenvStep?.env?.DOTENV_ENV_MATERIALIZATION_KEYS).toBe(
      "${{ vars.DOTENV_ENV_MATERIALIZATION_KEYS }}"
    );
    expect(dotenvStep?.run).toContain('printf \'%s=%s\\n\' "$key" "$value"');
    expect(dotenvStep?.run).toContain("Skipping empty dotenv key");
    expect(nestjsDeployRaw).toContain(
      "Optional project mapping for serverless-dotenv-plugin projects"
    );
  });

  it("keeps NestJS post-deploy health smoke opt-in and CloudFormation-backed", () => {
    const deploySteps = nestjsDeployWorkflow.jobs?.deploy.steps ?? [];
    const smokeStep = deploySteps.find(
      step => step.name === "Post-deploy health smoke"
    );

    expect(smokeStep).toBeDefined();
    expect(smokeStep?.if).toBe(
      "${{ vars.POST_DEPLOY_HEALTH_CHECK_ENABLED == 'true' }}"
    );
    expect(smokeStep?.env?.HEALTH_OUTPUT_KEY).toContain("HttpApiUrl");
    expect(smokeStep?.env?.HEALTH_PATH).toContain("/health");
    expect(smokeStep?.run).toContain("aws cloudformation describe-stacks");
    expect(smokeStep?.run).toContain("curl --fail --silent --show-error");
    expect(smokeStep?.run).toContain("HEALTH_EXPECTED_BODY");
  });

  it("keeps NestJS deploy output plumbing and migration skip gate valid", () => {
    const deployJob = nestjsDeployWorkflow.jobs?.deploy;
    const deployNeeds = needsList(deployJob);

    expect(deployNeeds).toEqual(
      expect.arrayContaining([
        "determine_environment",
        "release",
        "check_migration_required",
        "migrate",
        "verify_aws_credentials",
      ])
    );
    expect(deployJob?.outputs?.environment_url).toContain(
      "steps.deployment_outputs.outputs.environment_url"
    );
    expect(deployJob?.outputs?.deployment_status).toContain(
      "steps.deployment_outputs.outputs.deployment_status"
    );
    expect(deployJob?.if).toContain(
      "needs.check_migration_required.outputs.requires_migration != 'true'"
    );
    expect(deployJob?.if).toContain("needs.migrate.result == 'success'");
    expect(deployJob?.if).not.toContain(
      "needs.migrate.result == 'success' || needs.migrate.result == 'skipped'"
    );
    // A failed check_migration_required job leaves requires_migration empty
    // (which is != 'true') and its downstream jobs skipped, so without this
    // gate deploy would run despite the migration check itself failing.
    expect(deployJob?.if).toContain(
      "needs.check_migration_required.result == 'success'"
    );

    const outputStep = deployJob?.steps?.find(
      step => step.id === "deployment_outputs"
    );
    expect(outputStep).toBeDefined();
    expect(outputStep?.run).toContain("deployment_status=success");
  });

  it("does not clobber runner-provided GITHUB_OUTPUT in NestJS helper jobs", () => {
    for (const jobName of ["check_migration_required", "verify_vpn"]) {
      const job = nestjsDeployWorkflow.jobs?.[jobName];
      for (const step of job?.steps ?? []) {
        const envKeys = Object.keys(step.env ?? {});
        expect(envKeys, `${jobName}: ${step.name ?? step.id}`).not.toContain(
          "GITHUB_OUTPUT"
        );
      }
    }
  });

  it("uses explicit least-privilege permissions for read-only NestJS jobs and release caller", () => {
    expect(
      nestjsDeployWorkflow.jobs?.determine_environment.permissions
    ).toEqual({ contents: "read" });
    expect(
      nestjsDeployWorkflow.jobs?.verify_aws_credentials.permissions
    ).toEqual({ contents: "read" });
    expect(
      nestjsDeployWorkflow.jobs?.check_migration_required.permissions
    ).toEqual({ contents: "read" });
    expect(nestjsDeployWorkflow.jobs?.verify_vpn.permissions).toEqual({
      contents: "read",
    });
    expect(nestjsDeployWorkflow.jobs?.release.permissions).toEqual({
      contents: "write",
      "pull-requests": "read",
    });
  });

  it("lets Expo deploy skip EAS build cleanly when EXPO_TOKEN is absent", () => {
    const tokenSecret = easBuildWorkflow.on?.workflow_call?.secrets?.EXPO_TOKEN;
    expect(tokenSecret).toBeDefined();
    expect(tokenSecret?.required).toBe(false);

    const check = expoDeployWorkflow.jobs?.check_eas_setup;
    expect(check?.outputs?.has_eas_setup).toContain(
      "steps.check.outputs.has_eas_setup"
    );

    const trigger = expoDeployWorkflow.jobs?.trigger_eas_build;
    expect(trigger?.if).toContain(
      "needs.check_eas_setup.outputs.has_eas_setup == 'true'"
    );
    expect(trigger?.permissions).toEqual({ contents: "read" });
  });

  it("grants reusable Expo release and deploy jobs the permissions they request", () => {
    expect(expoDeployWorkflow.jobs?.release.permissions).toEqual({
      contents: "write",
      "pull-requests": "read",
    });
    expect(expoDeployWorkflow.jobs?.determine_environment.permissions).toEqual({
      contents: "read",
    });
    expect(expoDeployWorkflow.jobs?.check_eas_setup.permissions).toEqual({
      contents: "read",
    });
    expect(
      expoDeployWorkflow.jobs?.check_app_config_changes.permissions
    ).toEqual({ contents: "read" });
    expect(expoDeployWorkflow.jobs?.deploy.permissions).toEqual({
      contents: "read",
    });
  });

  it("grants GitHub issue fallback workflows enough token scope for read-only repos", () => {
    expect(
      createIssueOnFailureWorkflow.jobs?.create_github_issue.permissions
    ).toEqual({
      contents: "read",
      issues: "write",
    });
    expect(
      createGithubIssueOnFailureWorkflow.jobs?.create_issue.permissions
    ).toEqual({
      contents: "read",
      issues: "write",
    });
  });
});

describe("DSS-3 deploy environment declarations", () => {
  /** Stack templates whose create-only deploy.yml is under contract. */
  const STACKS = ["expo", "nestjs", "rails", "cdk", "harper-fabric"] as const;
  const RELEASE_RAILS_YML = path.join(WORKFLOWS_DIR, "release-rails.yml");

  /** Exact env expression for stacks with determine_environment. */
  const APPROVAL_ENV_EXPR =
    "${{ needs.determine_environment.outputs.approval_environment }}";
  /** Exact env expression for stacks without determine_environment. */
  const REF_TERNARY_EXPR =
    "${{ github.ref_name == 'main' && 'production' || github.ref_name }}";

  let stackRaw: Record<(typeof STACKS)[number], string>;
  let stackDeploy: Record<(typeof STACKS)[number], DeployWorkflow>;
  let releaseWf: ReleaseWorkflow;
  let releaseRailsWf: ReusableWorkflow;
  let buildWf: ReusableWorkflow;
  let lisaDeployWf: DeployWorkflow;

  /**
   * Read and parse a workflow file.
   * @param workflowPath Absolute workflow path.
   * @returns Parsed workflow.
   */
  function loadWorkflow<T>(workflowPath: string): T {
    return yaml.load(fs.readFileSync(workflowPath, "utf8")) as T;
  }

  beforeAll(() => {
    stackRaw = Object.fromEntries(
      STACKS.map(stack => [
        stack,
        fs.readFileSync(stackDeployPath(stack), "utf8"),
      ])
    ) as Record<(typeof STACKS)[number], string>;
    stackDeploy = Object.fromEntries(
      STACKS.map(stack => [stack, yaml.load(stackRaw[stack]) as DeployWorkflow])
    ) as Record<(typeof STACKS)[number], DeployWorkflow>;
    releaseWf = loadWorkflow<ReleaseWorkflow>(RELEASE_YML);
    releaseRailsWf = loadWorkflow<ReusableWorkflow>(RELEASE_RAILS_YML);
    buildWf = loadWorkflow<ReusableWorkflow>(EAS_BUILD_YML);
    lisaDeployWf = loadWorkflow<DeployWorkflow>(DEPLOY_YML);
  });

  /**
   * Collect the names of jobs declaring an `environment` key.
   * @param workflow Parsed workflow.
   * @param workflow.jobs Parsed jobs map.
   * @returns Job names with an environment declaration.
   */
  function jobsWithEnvironment(workflow: {
    jobs?: Record<string, WorkflowJob>;
  }): string[] {
    return Object.entries(workflow.jobs ?? {})
      .filter(([, job]) => job.environment !== undefined)
      .map(([name]) => name);
  }

  /**
   * Assert exactly one job declares the given scalar environment expression.
   * @param workflow Parsed deploy workflow.
   * @param jobName The single job expected to declare the environment.
   * @param expression Exact expected environment expression.
   */
  function expectSoleEnvironment(
    workflow: DeployWorkflow,
    jobName: string,
    expression: string
  ): void {
    expect(workflow.jobs?.[jobName]?.environment).toBe(expression);
    expect(jobsWithEnvironment(workflow)).toEqual([jobName]);
  }

  it("expo: only the deploy job declares the approval_environment expression", () => {
    expectSoleEnvironment(stackDeploy.expo, "deploy", APPROVAL_ENV_EXPR);
    // The expression depends on determine_environment's outputs — the needs
    // coupling must hold or the env name silently resolves empty.
    expect(needsList(stackDeploy.expo.jobs?.deploy)).toContain(
      "determine_environment"
    );
  });

  it("nestjs: only the deploy job declares environment, mapping form with url", () => {
    expect(stackDeploy.nestjs.jobs?.deploy.environment).toEqual({
      name: APPROVAL_ENV_EXPR,
      url: "${{ steps.deployment_outputs.outputs.environment_url }}",
    });
    expect(jobsWithEnvironment(stackDeploy.nestjs)).toEqual(["deploy"]);
  });

  it("rails: only deploy_rails declares the ref-name ternary expression", () => {
    expectSoleEnvironment(stackDeploy.rails, "deploy_rails", REF_TERNARY_EXPR);
  });

  it("harper-fabric: only the deploy job declares the ref-name ternary expression", () => {
    expectSoleEnvironment(
      stackDeploy["harper-fabric"],
      "deploy",
      REF_TERNARY_EXPR
    );
  });

  it("cdk: no job declares environment; the downstream snippet ships commented", () => {
    // cdk has no deploy job (determine_environment + release call only) —
    // downstream projects declare the environment on their project-owned
    // deploy job, per the commented snippet appended to the template.
    expect(jobsWithEnvironment(stackDeploy.cdk)).toEqual([]);
    expect(stackRaw.cdk).toContain(
      "#     environment: ${{ needs.determine_environment.outputs.approval_environment }}"
    );
  });

  it("cdk: the commented snippet uncomments into a valid jobs-level deploy job", () => {
    const lines = stackRaw.cdk.split("\n");
    const start = lines.findIndex(line => line === "#   deploy:");
    expect(start).toBeGreaterThan(-1);
    const snippet = lines
      .slice(start)
      .filter(line => line.startsWith("#"))
      .map(line => line.replace(/^# ?/, ""))
      .join("\n");
    const parsed = yaml.load(snippet) as Record<string, WorkflowJob>;
    expect(parsed.deploy?.environment).toBe(APPROVAL_ENV_EXPR);
    expect(needsList(parsed.deploy)).toEqual([
      "determine_environment",
      "release",
    ]);
  });

  it("release.yml: release_approval keeps its exact environment expression; no other job gains one", () => {
    expect(releaseWf.jobs.release_approval.environment).toEqual({
      name: "${{ inputs.approval_environment || inputs.environment }}",
    });
    expect(jobsWithEnvironment(releaseWf)).toEqual(["release_approval"]);
  });

  it("release-rails.yml, build.yml, and Lisa's own deploy.yml declare no environments", () => {
    expect(jobsWithEnvironment(releaseRailsWf)).toEqual([]);
    expect(jobsWithEnvironment(buildWf)).toEqual([]);
    // Lisa's own deploy.yml has no inline deploy job (release local-call +
    // publish_npm workflow-call) and deliberately gains no declaration.
    expect(jobsWithEnvironment(lisaDeployWf)).toEqual([]);
  });

  it("no stack deploy template introduces secrets: inherit", () => {
    for (const [stack, raw] of Object.entries(stackRaw)) {
      expect(raw, stack).not.toContain("secrets: inherit");
    }
  });
});

/* eslint-enable max-lines -- end scoped waiver for workflow contract coverage */

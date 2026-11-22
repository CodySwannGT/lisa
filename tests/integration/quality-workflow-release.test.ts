/**
 * Release and deploy reusable-workflow contracts (release, deploy, NestJS and
 * Expo deploy templates, EAS build, and issue-on-failure workflows).
 * Sibling of quality-workflow.test.ts.
 */
import * as fs from "fs-extra";
import yaml from "js-yaml";

import { jobOf } from "../helpers/workflow-job-graph.js";
import {
  RELEASE_YML,
  DEPLOY_YML,
  NESTJS_DEPLOY_YML,
  EXPO_DEPLOY_YML,
  EAS_BUILD_YML,
  CREATE_ISSUE_ON_FAILURE_YML,
  CREATE_GITHUB_ISSUE_ON_FAILURE_YML,
  type ReleaseWorkflow,
  type DeployWorkflow,
  type ReusableWorkflow,
  needsList,
} from "./quality-workflow-fixtures.js";

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

  it("never requests a scope its own callers may not hold", () => {
    // release.yml is ITSELF a called workflow (host deploy.yml invokes it), so
    // a scope requested here must be granted by EVERY host or their whole run
    // dies at startup with zero jobs — and host deploy.yml is create-only, so
    // installed repos can never self-heal. quality.yml's work_item_traceability
    // job declares no permissions of its own and is pull_request-only, so this
    // push path needs nothing beyond the long-standing baseline.
    expect(jobOf(releaseWorkflow, "quality").permissions).toEqual({
      contents: "read",
      "pull-requests": "read",
    });
  });

  it("pushes signed release tags after creating them", () => {
    const steps = jobOf(releaseWorkflow, "release_signing").steps ?? [];
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
    const steps = jobOf(releaseWorkflow, "version").steps ?? [];
    const determineVersion = steps.find(s => s.name === "Determine Version");
    const run = determineVersion?.run ?? "";

    expect(run).toContain("awk '{print $4}'");
    expect(run).toContain('npx semver -i patch "$VERSION"');
    expect(run).toContain('!= "custom"');

    expect(run).toContain('VERSION="${VERSION#v}"');

    // Environment-scoped release tags (standard-version): prod cuts a clean
    // vX.Y.Z; non-prod cuts a vX.Y.Z-<env>.<ts> pre-release tag so tag
    // namespaces never collide across branches. package.json version stays
    // clean; only the git tag carries the suffix.
    expect(determineVersion?.env).toMatchObject({
      RELEASE_ENVIRONMENT: "${{ inputs.environment }}",
      RELEASE_PRERELEASE: "${{ inputs.prerelease }}",
      RELEASE_STRATEGY: "${{ inputs.release_strategy }}",
    });
    expect(run).toContain('PRERELEASE_LABEL="$RELEASE_PRERELEASE"');
    expect(run).toContain("main|master|prod|production) PRERELEASE_LABEL=");
    expect(run).toContain('TAG="v${VERSION}-${PRERELEASE_LABEL}.$(date +%s)"');
    expect(run).toContain('echo "prerelease=true"');
    expect(run).toContain('echo "prerelease=false"');
    expect(run).toContain("git fetch --tags --force origin");
    expect(run).toContain('TAG="v$VERSION"');

    const guardIndex = run.indexOf("git rev-parse -q --verify");
    expect(guardIndex).toBeGreaterThan(run.indexOf('VERSION="${VERSION#v}"'));
    expect(run.indexOf('echo "version=$VERSION"')).toBeGreaterThan(guardIndex);
    expect(run.indexOf('echo "tag=$TAG"')).toBeGreaterThan(guardIndex);
  });

  it("fails release creation on API errors but reuses an existing release on rerun", () => {
    const steps = jobOf(releaseWorkflow, "github_release").steps ?? [];
    const createRelease = steps.find(s => s.name === "Create GitHub Release");
    const run = createRelease?.run ?? "";

    expect(createRelease).toBeDefined();
    expect(run).toContain('-w "%{http_code}"');
    expect(run).toContain(
      '[ "$HTTP_CODE" -lt 200 ] || [ "$HTTP_CODE" -ge 300 ]'
    );
    expect(run).toContain("exit 1");
    expect(run).toContain('select(.code == "already_exists")');
    // The tag and commit reach this step through `env:` since #3717; what this
    // test guards is the idempotent-rerun behaviour, not the spelling of the
    // expression, so the assertions follow the values to their new form.
    expect(createRelease?.env).toMatchObject({
      RELEASE_TAG: "${{ needs.version.outputs.tag }}",
      RELEASE_COMMIT: "${{ needs.version.outputs.release_commit }}",
    });
    expect(run).toContain("releases/tags/$RELEASE_TAG");
    expect(run).toContain('[ "$TARGET" != "$RELEASE_COMMIT" ]');
    expect(run).toContain("jq -e -r '.html_url'");
    expect(run).toContain("jq -e -r '.id'");
    expect(run).toContain("jq -e -r '.upload_url'");
  });

  it("queues release deploy runs instead of cancelling in-flight publishes", () => {
    expect(deployWorkflow.concurrency).toBeDefined();
    expect(deployWorkflow.concurrency?.["cancel-in-progress"]).toBe(false);
  });

  it("keeps NestJS dotenv materialization opt-in and env-driven", () => {
    const deploySteps = jobOf(nestjsDeployWorkflow, "deploy").steps ?? [];
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
    const deploySteps = jobOf(nestjsDeployWorkflow, "deploy").steps ?? [];
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
      jobOf(nestjsDeployWorkflow, "determine_environment").permissions
    ).toEqual({ contents: "read" });
    expect(
      jobOf(nestjsDeployWorkflow, "verify_aws_credentials").permissions
    ).toEqual({ contents: "read" });
    expect(
      jobOf(nestjsDeployWorkflow, "check_migration_required").permissions
    ).toEqual({ contents: "read" });
    expect(jobOf(nestjsDeployWorkflow, "verify_vpn").permissions).toEqual({
      contents: "read",
    });
    // No issues scope: release.yml requests none, and a host granting a scope
    // its callee never asks for is dead weight, not defense in depth.
    expect(jobOf(nestjsDeployWorkflow, "release").permissions).toEqual({
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
    expect(jobOf(expoDeployWorkflow, "release").permissions).toEqual({
      contents: "write",
      "pull-requests": "read",
    });
    expect(
      jobOf(expoDeployWorkflow, "determine_environment").permissions
    ).toEqual({
      contents: "read",
    });
    expect(jobOf(expoDeployWorkflow, "check_eas_setup").permissions).toEqual({
      contents: "read",
    });
    expect(
      jobOf(expoDeployWorkflow, "check_app_config_changes").permissions
    ).toEqual({ contents: "read" });
    expect(jobOf(expoDeployWorkflow, "deploy").permissions).toEqual({
      contents: "read",
    });
  });

  it("grants GitHub issue fallback workflows enough token scope for read-only repos", () => {
    expect(
      jobOf(createIssueOnFailureWorkflow, "create_github_issue").permissions
    ).toEqual({
      contents: "read",
      issues: "write",
    });
    expect(
      jobOf(createGithubIssueOnFailureWorkflow, "create_issue").permissions
    ).toEqual({
      contents: "read",
      issues: "write",
    });
  });
});

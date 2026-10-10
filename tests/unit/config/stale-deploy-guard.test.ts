/** Execute the shipped shell against real branch tips, including old-run retries. */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { load } from "js-yaml";
import { beforeEach, describe, expect, it } from "vitest";

import { runBoundedBash } from "../../helpers/bounded-bash.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const ROOT = resolve(__dirname, "../../..");
const STACKS = ["nestjs", "cdk", "expo", "rails", "harper-fabric"] as const;
const GUARD = "🚦 Refuse stale deployment";
const EMPTY_COMMIT = "--allow-empty";

/** Workflow step fields needed to inspect guard placement. */
interface Step {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly with?: Readonly<Record<string, string>>;
}

/** Workflow fields used to verify the seeded deployment contract. */
interface Workflow {
  readonly on: {
    readonly workflow_dispatch: {
      readonly inputs: Readonly<
        Record<string, { readonly type: string; readonly default: boolean }>
      >;
    };
  };
  readonly jobs: Readonly<
    Record<
      string,
      {
        readonly needs?: readonly string[];
        readonly steps?: readonly Step[];
        readonly with?: Readonly<Record<string, string>>;
      }
    >
  >;
}

/**
 * Read the actual create-only asset.
 * @param stack - Stack whose workflow is inspected.
 * @returns Parsed workflow.
 */
function workflow(stack: string): Workflow {
  return load(
    readFileSync(
      join(ROOT, stack, "create-only/.github/workflows/deploy.yml"),
      "utf8"
    )
  ) as Workflow;
}

/**
 * Run fixture plumbing with a deadline and no inherited hooks or signing.
 * @param cwd - Isolated repository directory.
 * @param args - Git fixture command arguments.
 * @returns Command output.
 */
function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- Git is the required fixture tool, with arguments controlled by this suite.
    "git",
    ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
    {
      cwd,
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "pipe"],
    }
  ).trim();
}

describe("seeded stale deployment protection (#4351)", () => {
  it.each(STACKS)(
    "%s guards releases and preserves a default-off manual override",
    stack => {
      const doc = workflow(stack);
      expect(doc.on.workflow_dispatch.inputs.force_stale_deploy).toMatchObject({
        type: "boolean",
        default: false,
      });
      const steps = doc.jobs.validate_deploy_commit?.steps ?? [];
      expect(steps.find(step => step.name === GUARD)?.run).toContain(
        "git ls-remote"
      );
      expect(steps[0]?.with?.ref).toBe(
        "${{ github.event_name == 'workflow_dispatch' && inputs.rollback_commit || github.sha }}"
      );
      expect(steps[1]?.run).toBe(
        workflow("cdk").jobs.validate_deploy_commit?.steps?.[1]?.run
      );
      expect(steps[1]?.env?.FORCE_STALE_DEPLOY).toBe(
        "${{ github.event_name == 'workflow_dispatch' && inputs.force_stale_deploy == true }}"
      );
      expect(doc.jobs.pre_deploy_gates?.needs).toContain(
        "validate_deploy_commit"
      );
    }
  );

  it.each([
    ["nestjs", "migrate"],
    ["nestjs", "deploy"],
    ["expo", "deploy"],
    ["rails", "deploy_rails"],
    ["harper-fabric", "deploy"],
  ])(
    "%s/%s rechecks the checked-out commit before any deploy action",
    (stack, job) => {
      const steps = workflow(stack).jobs[job]?.steps ?? [];
      const checkout = steps.findIndex(
        step => step.uses === "actions/checkout@v6"
      );
      expect(checkout).toBeGreaterThanOrEqual(0);
      if (steps[checkout]?.with?.ref?.includes("needs.release.")) {
        expect(workflow(stack).jobs[job]?.needs).toContain("release");
      }
      expect(steps[checkout + 1]?.name).toBe(GUARD);
      expect(steps[checkout + 1]?.run).toBe(
        workflow("cdk").jobs.validate_deploy_commit?.steps?.[1]?.run
      );
    }
  );

  it("protects native app submission inside the reusable job, including job-only retries", () => {
    const caller = workflow("expo").jobs.trigger_eas_build;
    const reusable = load(
      readFileSync(join(ROOT, ".github/workflows/build.yml"), "utf8")
    ) as Workflow;
    const steps = reusable.jobs.build?.steps ?? [];
    expect(caller?.needs).toContain("validate_deploy_commit");
    expect(caller?.needs).toContain("release");
    expect(caller?.with?.deployment_branch).toBe(
      "${{ needs.determine_environment.outputs.environment }}"
    );
    expect(caller?.with?.source_ref).toContain(
      "needs.release.outputs.release_commit"
    );
    expect(steps[0]?.with?.ref).toBe("${{ inputs.source_ref || github.sha }}");
    expect(steps[1]?.name).toBe(GUARD);
    expect(steps[1]?.run).toBe(
      workflow("cdk").jobs.validate_deploy_commit?.steps?.[1]?.run
    );
  });

  let fixture: string;
  let oldSha: string;
  let tipSha: string;

  beforeEach(async () => {
    fixture = await createTempDir();
    git(fixture, "init", "--initial-branch=staging");
    git(fixture, "config", "user.name", "Deploy fixture");
    git(fixture, "config", "user.email", "fixture@example.test");
    git(fixture, "commit", EMPTY_COMMIT, "-m", "old deployment");
    oldSha = git(fixture, "rev-parse", "HEAD");
    git(fixture, "commit", EMPTY_COMMIT, "-m", "new deployment");
    tipSha = git(fixture, "rev-parse", "HEAD");
    git(fixture, "remote", "add", "origin", fixture);
    return async (): Promise<void> => cleanupTempDir(fixture);
  });

  /**
   * Run the real YAML body; failures become an inspectable exit verdict.
   * @param overrides - Environment values for one deployment scenario.
   * @returns Captured guard output and exit verdict.
   */
  async function check(overrides: NodeJS.ProcessEnv = {}): Promise<string> {
    const body = workflow("cdk").jobs.validate_deploy_commit?.steps?.[1]?.run;
    const file = join(fixture, "guard.sh");
    const driver = join(fixture, "driver.sh");
    expect(body).toBeDefined();
    writeFileSync(file, body ?? "exit 99");
    writeFileSync(
      driver,
      'bash "$GUARD_FILE"; verdict=$?; echo "VERDICT=$verdict"'
    );
    return runBoundedBash(driver, {
      cwd: fixture,
      timeoutMs: 15_000,
      env: {
        ...process.env,
        GUARD_FILE: file,
        DEPLOY_BRANCH: "staging",
        DEPLOY_EVENT: "push",
        FORCE_STALE_DEPLOY: "false",
        GITHUB_STEP_SUMMARY: join(fixture, "summary.md"),
        ...overrides,
      },
    }).then(result => result.stdout + result.stderr);
  }

  it("accepts the current branch tip", async () => {
    const result = await check();
    expect(result).toContain("VERDICT=0");
    expect(result).toContain(tipSha);
  });

  it("rejects an old run even when its earlier gate already succeeded", async () => {
    git(fixture, "checkout", "--detach", oldSha);
    const result = await check();
    expect(result).toContain("VERDICT=1");
    expect(result).toContain(oldSha);
    expect(result).toContain(tipSha);
    expect(result).toContain("latest deploy run");
    expect(result).toContain("roll the environment back");
  });

  it("allows a deliberate manual rollback and records it in the summary", async () => {
    git(fixture, "checkout", "--detach", oldSha);
    const result = await check({
      DEPLOY_EVENT: "workflow_dispatch",
      FORCE_STALE_DEPLOY: "true",
    });
    expect(result).toContain("VERDICT=0");
    expect(result).toContain("::warning");
    expect(readFileSync(join(fixture, "summary.md"), "utf8")).toContain(oldSha);
  });

  it.each(["false", "TRUE", "1", ""])(
    "does not treat %j as manual approval",
    async value => {
      git(fixture, "checkout", "--detach", oldSha);
      expect(
        await check({
          DEPLOY_EVENT: "workflow_dispatch",
          FORCE_STALE_DEPLOY: value,
        })
      ).toContain("VERDICT=1");
    }
  );

  it("never lets a push enable the override", async () => {
    git(fixture, "checkout", "--detach", oldSha);
    expect(await check({ FORCE_STALE_DEPLOY: "true" })).toContain("VERDICT=1");
  });

  it("fails closed on an absent branch, even with the override", async () => {
    expect(
      await check({
        DEPLOY_BRANCH: "missing",
        DEPLOY_EVENT: "workflow_dispatch",
        FORCE_STALE_DEPLOY: "true",
      })
    ).toContain("VERDICT=1");
  });

  it("fails closed when the remote is unavailable", async () => {
    git(fixture, "remote", "remove", "origin");
    expect(await check()).toContain("VERDICT=1");
  });

  it("supports branch names with slashes without matching a different branch", async () => {
    git(fixture, "branch", "release/staging", tipSha);
    expect(await check({ DEPLOY_BRANCH: "release/staging" })).toContain(
      "VERDICT=0"
    );
    expect(await check({ DEPLOY_BRANCH: "stag*" })).toContain("VERDICT=1");
  });

  it("accepts this run's version bump when that checked-out release is the tip", async () => {
    git(fixture, "commit", EMPTY_COMMIT, "-m", "chore(release): version bump");
    const result = await check();
    expect(result).toContain("VERDICT=0");
    expect(result).toContain(git(fixture, "rev-parse", "HEAD"));
  });
});

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assembleDeployPipelineStages,
  buildDeployPipelineResult,
  createDeployPipelineProbe,
  DEPLOY_PIPELINE_PROBE_ID,
  mapEnvironmentHoldStage,
  parseDeployWorkflowStages,
  type DeployPipelineStage,
  type GithubEnvironmentsLookup,
} from "../../../src/cli/ui-deploy-pipeline.js";
import { runProbe } from "../../../src/cli/ui-cmd.js";

const PRODUCTION = "production";
const STAGING = "staging";
const MISSING = "missing-env";
const NOT_AUTHENTICATED = "not-authenticated" as const;
const GITHUB_NOT_AUTHENTICATED = "GitHub CLI is not authenticated";

const SAMPLE_DEPLOY_YML = `
name: Release and Deploy
jobs:
  determine_environment:
    name: Determine Environment
    runs-on: ubuntu-latest
  release:
    name: Release
    uses: ./.github/workflows/release.yml
  deploy:
    name: Deploy
    runs-on: ubuntu-latest
`;

/**
 * Build a hold stage fixture for assemble tests.
 * @param environment - Environment name
 * @param active - Active column value
 * @returns Stage row
 */
function hold(
  environment: string,
  active: DeployPipelineStage["active"]
): DeployPipelineStage {
  return {
    id: `hold:${environment}`,
    name: `Release approval — ${environment}`,
    description: "hold",
    environment,
    active,
    reason: active === true ? "" : "reason",
  };
}

/**
 * Build a job stage fixture for assemble tests.
 * @param id - Job id
 * @param name - Display name
 * @returns Stage row
 */
function job(id: string, name: string): DeployPipelineStage {
  return {
    id: `job:${id}`,
    name,
    description: "job",
    environment: "",
    active: true,
    reason: "",
  };
}

describe("parseDeployWorkflowStages", () => {
  it("emits job stages in deploy.yml order with name fields", () => {
    expect(parseDeployWorkflowStages(SAMPLE_DEPLOY_YML)).toEqual([
      {
        id: "job:determine_environment",
        name: "Determine Environment",
        description: "Workflow job `determine_environment` from deploy.yml",
        environment: "",
        active: true,
        reason: "",
      },
      {
        id: "job:release",
        name: "Release",
        description: "Workflow job `release` from deploy.yml",
        environment: "",
        active: true,
        reason: "",
      },
      {
        id: "job:deploy",
        name: "Deploy",
        description: "Workflow job `deploy` from deploy.yml",
        environment: "",
        active: true,
        reason: "",
      },
    ]);
  });

  it("returns an empty list for invalid YAML documents", () => {
    expect(parseDeployWorkflowStages("not: a: workflow")).toEqual([]);
  });
});

describe("mapEnvironmentHoldStage", () => {
  it("shows an approval hold when GitHub has required reviewers", () => {
    const lookup: GithubEnvironmentsLookup = {
      status: "ok",
      environments: [{ name: PRODUCTION, hasRequiredReviewers: true }],
    };
    const stage = mapEnvironmentHoldStage(PRODUCTION, lookup);
    expect(stage.active).toBe(true);
    expect(stage.reason).toBe("");
    expect(stage.name).toContain(PRODUCTION);
  });

  it("shows no hold when the environment exists without reviewers", () => {
    const lookup: GithubEnvironmentsLookup = {
      status: "ok",
      environments: [{ name: STAGING, hasRequiredReviewers: false }],
    };
    const stage = mapEnvironmentHoldStage(STAGING, lookup);
    expect(stage.active).toBe(false);
    expect(stage.reason).toContain("No required reviewers");
  });

  it("reports unknown with environment-not-found for configured-but-absent envs", () => {
    const lookup: GithubEnvironmentsLookup = {
      status: "ok",
      environments: [{ name: PRODUCTION, hasRequiredReviewers: true }],
    };
    const stage = mapEnvironmentHoldStage(MISSING, lookup);
    expect(stage.active).toBe("unknown");
    expect(stage.reason).toContain("environment-not-found");
    expect(stage.reason).toContain(MISSING);
    expect(stage.active).not.toBe(false);
  });

  it("never fabricates a hold state when gh is not authenticated", () => {
    const lookup: GithubEnvironmentsLookup = {
      status: NOT_AUTHENTICATED,
      message: GITHUB_NOT_AUTHENTICATED,
    };
    const stage = mapEnvironmentHoldStage(PRODUCTION, lookup);
    expect(stage.active).toBe("unknown");
    expect(stage.reason).toContain(NOT_AUTHENTICATED);
    expect(stage.active).not.toBe(true);
    expect(stage.active).not.toBe(false);
  });
});

describe("assembleDeployPipelineStages", () => {
  it("inserts approval holds before the release job", () => {
    const stages = assembleDeployPipelineStages(
      [
        job("determine_environment", "Determine Environment"),
        job("release", "Release"),
        job("deploy", "Deploy"),
      ],
      [hold(PRODUCTION, true)]
    );
    expect(stages.map(stage => stage.id)).toEqual([
      "job:determine_environment",
      "hold:production",
      "job:release",
      "job:deploy",
    ]);
  });

  it("does not assume a fixed env triple when only one hold exists", () => {
    const stages = assembleDeployPipelineStages(
      [job("release", "Release")],
      [hold(PRODUCTION, true)]
    );
    expect(stages.filter(stage => stage.environment.length > 0)).toHaveLength(
      1
    );
    expect(stages.map(stage => stage.environment)).toEqual([PRODUCTION, ""]);
  });
});

describe("buildDeployPipelineResult", () => {
  it("returns not-applicable when there is no workflow and no environments", () => {
    expect(
      buildDeployPipelineResult(null, [], {
        status: "ok",
        environments: [],
      })
    ).toEqual({ state: "not-applicable" });
  });

  it("keeps job stages when environments are absent", () => {
    const result = buildDeployPipelineResult(SAMPLE_DEPLOY_YML, [], {
      status: "ok",
      environments: [],
    });
    expect(result.state).toBe("value");
    if (result.state !== "value") {
      return;
    }
    expect(result.value.stages.every(stage => stage.environment === "")).toBe(
      true
    );
    expect(result.value.stages.length).toBeGreaterThan(0);
  });

  it("marks environment-derived stages unknown when unauthenticated", () => {
    const result = buildDeployPipelineResult(SAMPLE_DEPLOY_YML, [PRODUCTION], {
      status: NOT_AUTHENTICATED,
      message: GITHUB_NOT_AUTHENTICATED,
    });
    expect(result.state).toBe("value");
    if (result.state !== "value") {
      return;
    }
    const holdStage = result.value.stages.find(
      stage => stage.id === "hold:production"
    );
    expect(holdStage?.active).toBe("unknown");
    expect(holdStage?.reason).toContain(NOT_AUTHENTICATED);
    const jobStage = result.value.stages.find(stage =>
      stage.id.startsWith("job:")
    );
    expect(jobStage?.active).toBe(true);
  });
});

describe("createDeployPipelineProbe", () => {
  it("registers under the stable deploy-pipeline-stages id", () => {
    expect(createDeployPipelineProbe("/tmp").id).toBe(DEPLOY_PIPELINE_PROBE_ID);
  });

  it("joins deploy.yml jobs with live environment holds", async () => {
    const listGithubEnvironments = vi.fn(
      async (): Promise<GithubEnvironmentsLookup> => ({
        status: "ok",
        environments: [
          { name: PRODUCTION, hasRequiredReviewers: true },
          { name: STAGING, hasRequiredReviewers: false },
        ],
      })
    );
    const result = await runProbe(
      createDeployPipelineProbe("/project", {
        readDeployWorkflow: async () => SAMPLE_DEPLOY_YML,
        readConfiguredEnvironments: async () => [PRODUCTION, STAGING, MISSING],
        listGithubEnvironments,
      })
    );
    expect(result.state).toBe("value");
    if (result.state !== "value") {
      return;
    }
    const byId = Object.fromEntries(
      result.value.stages.map(stage => [stage.id, stage])
    );
    expect(byId["hold:production"]?.active).toBe(true);
    expect(byId["hold:staging"]?.active).toBe(false);
    expect(byId["hold:missing-env"]?.active).toBe("unknown");
    expect(byId["hold:missing-env"]?.reason).toContain("environment-not-found");
    expect(listGithubEnvironments).toHaveBeenCalledOnce();
  });

  it("skips the GitHub API when no environments are configured", async () => {
    const listGithubEnvironments = vi.fn(
      async (): Promise<GithubEnvironmentsLookup> => ({
        status: "ok",
        environments: [],
      })
    );
    await runProbe(
      createDeployPipelineProbe("/project", {
        readDeployWorkflow: async () => SAMPLE_DEPLOY_YML,
        readConfiguredEnvironments: async () => [],
        listGithubEnvironments,
      })
    );
    expect(listGithubEnvironments).not.toHaveBeenCalled();
  });

  it("degrades oversized deploy workflow evidence without parsing it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lisa-ui-deploy-confined-"));
    try {
      await mkdir(path.join(root, ".github/workflows"), { recursive: true });
      await writeFile(
        path.join(root, ".github/workflows/deploy.yml"),
        "x".repeat(512 * 1024 + 1)
      );

      const result = await runProbe(createDeployPipelineProbe(root));

      expect(result).toMatchObject({
        state: "unknown",
        reason: "probe-failed",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

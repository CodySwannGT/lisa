import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CI_QUALITY_JOBS_PROBE_ID,
  computeCiQualityJobs,
  createCiQualityJobsProbe,
  parseCiWorkflowInputs,
  type CiWorkflowInputs,
  type RepoSecretsPresence,
} from "../../../src/cli/ui-ci-quality-jobs.js";
import { runProbe } from "../../../src/cli/ui-cmd.js";
import type { JsonObject } from "../../../src/sync/json-path.js";

/** Per-test temp directory. */
interface Resources {
  dir: string;
}

const resources: Resources = { dir: "" };
const MUTATION_GATE_DISABLED = "mutation gate is disabled";
const MUTATION_JOB_ID = "test:mutation";

beforeEach(async () => {
  resources.dir = await mkdtemp(path.join(tmpdir(), "lisa-ci-quality-"));
});

afterEach(async () => {
  await rm(resources.dir, { recursive: true, force: true });
});

/**
 * Write a minimal calling `ci.yml` that forwards quality inputs.
 * @param withBlock - YAML fragment for the quality job `with:` map
 */
async function writeCiYml(withBlock: string): Promise<void> {
  const workflows = path.join(resources.dir, ".github", "workflows");
  await mkdir(workflows, { recursive: true });
  await writeFile(
    path.join(workflows, "ci.yml"),
    [
      "name: CI",
      "on: pull_request",
      "jobs:",
      "  quality:",
      "    uses: ./.github/workflows/quality.yml",
      "    with:",
      withBlock,
      "    secrets: inherit",
      "",
    ].join("\n"),
    "utf8"
  );
}

/**
 * Locate one job entry by id inside a computed value.
 * @param jobs - Computed job list
 * @param id - Stable job id
 * @returns The matching job
 */
function jobOf(
  jobs: ReturnType<typeof computeCiQualityJobs>["jobs"],
  id: string
): (typeof jobs)[number] {
  const found = jobs.find(entry => entry.id === id);
  if (found === undefined) {
    throw new Error(`Missing job ${id}`);
  }
  return found;
}

describe("parseCiWorkflowInputs", () => {
  it("reads skip_jobs and gate inputs from the quality caller with-block", async () => {
    await writeCiYml(
      [
        "      skip_jobs: 'snyk,sonarcloud'",
        "      verify_enforced: true",
        "      compliance_framework: soc2",
        "      require_approval: true",
        "      zap_target_url: 'https://example.test'",
      ].join("\n")
    );

    const inputs = await parseCiWorkflowInputs(resources.dir);

    expect(inputs).toEqual({
      skipJobs: ["snyk", "sonarcloud"],
      verifyEnforced: true,
      complianceFramework: "soc2",
      requireApproval: true,
      zapTargetUrl: "https://example.test",
    } satisfies CiWorkflowInputs);
  });

  it("returns empty skip list and defaults when with-block omits optional keys", async () => {
    await writeCiYml("      skip_jobs: ''\n");

    const inputs = await parseCiWorkflowInputs(resources.dir);

    expect(inputs.skipJobs).toEqual([]);
    expect(inputs.verifyEnforced).toBe(false);
    expect(inputs.complianceFramework).toBe("none");
    expect(inputs.requireApproval).toBe(false);
    expect(inputs.zapTargetUrl).toBe("");
  });
});

describe("computeCiQualityJobs", () => {
  const baseInputs: CiWorkflowInputs = {
    skipJobs: [],
    verifyEnforced: false,
    complianceFramework: "none",
    requireApproval: false,
    zapTargetUrl: "",
  };
  const secretsPresent: RepoSecretsPresence = {
    state: "value",
    names: new Set(["GITGUARDIAN_API_KEY"]),
  };
  const configMutationOff: JsonObject = {
    quality: { mutation: { gate: { enabled: false } } },
  };

  it("marks Snyk off naming SNYK_TOKEN when the secret is absent", () => {
    const value = computeCiQualityJobs(
      baseInputs,
      configMutationOff,
      secretsPresent
    );

    expect(jobOf(value.jobs, "snyk")).toEqual({
      id: "snyk",
      label: "🛡️ Snyk",
      active: false,
      reason: "SNYK_TOKEN secret is not set",
    });
  });

  it("marks Mutation Testing Gate off when the gate config is disabled", () => {
    const value = computeCiQualityJobs(
      baseInputs,
      configMutationOff,
      secretsPresent
    );

    expect(jobOf(value.jobs, MUTATION_JOB_ID)).toMatchObject({
      active: false,
      reason: MUTATION_GATE_DISABLED,
    });
  });

  it("marks a skip_jobs entry off with a ci.yml reason", () => {
    const value = computeCiQualityJobs(
      { ...baseInputs, skipJobs: ["lint"] },
      configMutationOff,
      secretsPresent
    );

    expect(jobOf(value.jobs, "lint")).toMatchObject({
      active: false,
      reason: "ci.yml skip_jobs includes lint",
    });
  });

  it("never claims a secret is missing when gh is unauthenticated", () => {
    const value = computeCiQualityJobs(baseInputs, configMutationOff, {
      state: "unknown",
      reason: "not-authenticated",
      message: "GitHub CLI is not authenticated",
    });

    const snyk = jobOf(value.jobs, "snyk");
    expect(snyk.active).toBeNull();
    expect(snyk.reason).toMatch(/not authenticated/iu);
    expect(snyk.reason.toLowerCase()).not.toContain("not set");
    expect(snyk.reason).not.toMatch(/\boff\b/iu);

    const mutation = jobOf(value.jobs, MUTATION_JOB_ID);
    expect(mutation.active).toBe(false);
    expect(mutation.reason).toBe(MUTATION_GATE_DISABLED);
  });

  it("reports secret-backed jobs active only when the secret name is present", () => {
    const value = computeCiQualityJobs(baseInputs, configMutationOff, {
      state: "value",
      names: new Set(["SNYK_TOKEN", "GITGUARDIAN_API_KEY"]),
    });

    expect(jobOf(value.jobs, "snyk").active).toBe(true);
    expect(jobOf(value.jobs, "snyk").reason).toBe("");
    expect(jobOf(value.jobs, "license_compliance")).toMatchObject({
      active: false,
      reason: "FOSSA_API_KEY secret is not set",
    });
  });

  it("never embeds secret values in reasons or labels", () => {
    const secretValue = "super-secret-token-value-9f3a";
    const value = computeCiQualityJobs(baseInputs, configMutationOff, {
      state: "value",
      names: new Set(["SNYK_TOKEN"]),
    });
    const serialized = JSON.stringify(value);

    expect(serialized).not.toContain(secretValue);
    expect(serialized).not.toMatch(/"value"\s*:\s*"[^"]*token/iu);
    for (const entry of value.jobs) {
      expect(entry.reason).not.toContain("=");
      expect(entry.reason).not.toMatch(/gho_|ghp_|github_pat_/u);
    }
  });
});

describe("createCiQualityJobsProbe", () => {
  it("registers under the ci-quality-jobs id with a bounded timeout", () => {
    const probe = createCiQualityJobsProbe(resources.dir, {});

    expect(probe.id).toBe(CI_QUALITY_JOBS_PROBE_ID);
    expect(probe.timeoutMs).toBeGreaterThan(0);
    expect(Number.isFinite(probe.timeoutMs)).toBe(true);
  });

  it("joins filesystem inputs with injectable secret presence", async () => {
    await writeCiYml(
      ["      skip_jobs: 'snyk'", "      verify_enforced: false"].join("\n")
    );
    const listSecrets = vi.fn(async () => ({
      state: "value" as const,
      names: new Set<string>(),
    }));

    const result = await runProbe(
      createCiQualityJobsProbe(
        resources.dir,
        { quality: { mutation: { gate: { enabled: false } } } },
        { listSecrets }
      )
    );

    expect(result.state).toBe("value");
    if (result.state !== "value") {
      return;
    }
    const jobs = result.value.jobs as readonly {
      readonly id: string;
      readonly active: boolean | null;
      readonly reason: string;
    }[];
    expect(jobOf(jobs, "snyk")).toMatchObject({
      active: false,
      reason: "ci.yml skip_jobs includes snyk",
    });
    expect(jobOf(jobs, MUTATION_JOB_ID)).toMatchObject({
      active: false,
      reason: MUTATION_GATE_DISABLED,
    });
    expect(listSecrets).toHaveBeenCalledOnce();
  });

  it("surfaces secret-derived unknown when the secret lister is unauthenticated", async () => {
    await writeCiYml("      skip_jobs: ''\n");
    const result = await runProbe(
      createCiQualityJobsProbe(
        resources.dir,
        { quality: { mutation: { gate: { enabled: true } } } },
        {
          listSecrets: async () => ({
            state: "unknown",
            reason: "not-authenticated",
            message: "GitHub CLI is not authenticated",
          }),
        }
      )
    );

    expect(result.state).toBe("value");
    if (result.state !== "value") {
      return;
    }
    const jobs = result.value.jobs as readonly {
      readonly id: string;
      readonly active: boolean | null;
      readonly reason: string;
    }[];
    const snyk = jobOf(jobs, "snyk");
    expect(snyk.active).toBeNull();
    expect(snyk.reason.toLowerCase()).toContain("not authenticated");
  });

  it("degrades to unknown when ci.yml cannot be read", async () => {
    const result = await runProbe(
      createCiQualityJobsProbe(
        resources.dir,
        {},
        {
          listSecrets: async () => ({ state: "value", names: new Set() }),
        }
      )
    );

    expect(result.state).toBe("unknown");
    if (result.state === "unknown") {
      expect(result.reason).toMatch(/ci-yml|missing|not found/iu);
      expect(result.message.trim().length).toBeGreaterThan(0);
    }
  });
});

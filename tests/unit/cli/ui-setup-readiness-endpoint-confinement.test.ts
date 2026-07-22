/** Endpoint red leg for setup-readiness config confinement. */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSetupReadinessReader } from "../../../src/cli/ui-setup-readiness.js";
import { readWorkflowSecretNames } from "../../../src/cli/ui-setup-readiness-local.js";
import type { HealthResult } from "../../../src/health/contract.js";

const roots: string[] = [];
const SCHEDULER_PREFIX = "lisa-auto-external-repo-";
const SCHEDULER_ID = `${SCHEDULER_PREFIX}intake-tickets`;
const SCHEDULER_TOML = "automation.toml";

/**
 * Create and track one disposable fixture root.
 * @param prefix - Temporary-directory prefix.
 * @returns Absolute fixture root path.
 */
async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

/**
 * Build the minimal deterministic Health fixture for endpoint probes.
 * @returns Stable deterministic Health result.
 */
function health(): HealthResult {
  return {
    schemaVersion: 1,
    runId: "endpoint-confinement-health",
    mode: "deterministic",
    startedAt: "2026-07-21T13:00:00.000Z",
    completedAt: "2026-07-21T13:00:01.000Z",
    findings: [],
    summary: {
      verdict: "out of band",
      counts: { pass: 0, warn: 0, fail: 0 },
    },
  };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map(root => rm(root, { recursive: true, force: true }))
  );
});

describe("GET /api/setup-readiness confinement", () => {
  it("fails config-backed rows closed for an external config symlink", async () => {
    const projectRoot = await temporaryRoot("lisa-ui-setup-project-");
    const outside = await temporaryRoot("lisa-ui-setup-outside-");
    const target = path.join(outside, "config.json");
    await writeFile(
      target,
      JSON.stringify({
        tracker: "github",
        source: "github",
        github: { org: "external", repo: "external" },
        starter: { templates: [{ repo: "external/repo", ref: "main" }] },
      })
    );
    await symlink(target, path.join(projectRoot, ".lisa.config.json"));
    const unavailable = {
      state: "unknown" as const,
      reason: "fixture-unavailable",
      message: "Unavailable fixture",
    };
    const readReadiness = createSetupReadinessReader(projectRoot, {
      readHealth: async () => health(),
      readGithub: async () => unavailable,
      readDeployPipeline: async () => unavailable,
      readAutomations: async () => unavailable,
      readExpectedAutomationIds: async () => [],
      readExpectedSecretNames: async () => [],
    });
    const body = await readReadiness();
    const statuses = new Map(
      body.findings.map((finding: { check: string; status: string }) => [
        finding.check,
        finding.status,
      ])
    );

    expect(statuses.get("setup.tracker")).not.toBe("pass");
    expect(statuses.get("setup.prd-source")).not.toBe("pass");
    expect(statuses.get("setup.starter-provenance")).not.toBe("pass");
  });

  it("does not import unsafe or oversized workflow secret evidence", async () => {
    const projectRoot = await temporaryRoot("lisa-ui-workflow-project-");
    const outside = await temporaryRoot("lisa-ui-workflow-outside-");
    const workflowRoot = path.join(projectRoot, ".github/workflows");
    const externalWorkflow = path.join(outside, "external.yml");
    await mkdir(workflowRoot, { recursive: true });
    await writeFile(externalWorkflow, "run: ${{ secrets.EXTERNAL_TOKEN }}\n");
    await symlink(externalWorkflow, path.join(workflowRoot, "external.yml"));
    execFileSync("/usr/bin/mkfifo", [path.join(workflowRoot, "pipe.yml")]);
    await writeFile(
      path.join(workflowRoot, "oversized.yml"),
      "x".repeat(256 * 1024 + 1)
    );

    await expect(readWorkflowSecretNames(projectRoot)).resolves.toEqual([]);
  });

  it.each(["external-symlink", "fifo", "oversized"] as const)(
    "keeps setup.automations non-pass for default %s scheduler evidence",
    async evidenceKind => {
      const projectRoot = await temporaryRoot("lisa-ui-scheduler-project-");
      const codexHome = await temporaryRoot("lisa-ui-scheduler-home-");
      const automationsRoot = path.join(codexHome, "automations");
      const automationRoot = path.join(automationsRoot, SCHEDULER_ID);
      const automationToml = [
        "version = 1",
        `id = "${SCHEDULER_ID}"`,
        'kind = "cron"',
        'status = "ACTIVE"',
        'rrule = "FREQ=HOURLY;INTERVAL=1"',
        'prompt = "Use the Lisa intake skill."',
        "",
      ].join("\n");
      await mkdir(automationRoot, { recursive: true });
      await writeFile(
        path.join(projectRoot, ".lisa.config.json"),
        JSON.stringify({
          tracker: "github",
          source: "github",
          github: { org: "external", repo: "repo" },
        })
      );
      if (evidenceKind === "external-symlink") {
        const outside = await temporaryRoot("lisa-ui-scheduler-outside-");
        const target = path.join(outside, SCHEDULER_TOML);
        await writeFile(target, automationToml);
        await symlink(target, path.join(automationRoot, SCHEDULER_TOML));
      } else {
        await writeFile(
          path.join(automationRoot, SCHEDULER_TOML),
          evidenceKind === "oversized"
            ? "x".repeat(256 * 1024 + 1)
            : automationToml
        );
      }
      if (evidenceKind === "fifo") {
        execFileSync("/usr/bin/mkfifo", [
          path.join(automationRoot, "memory.md"),
        ]);
      }
      vi.stubEnv("CODEX_HOME", codexHome);
      const unavailable = {
        state: "unknown" as const,
        reason: "fixture-unavailable",
        message: "Unavailable fixture",
      };
      const readReadiness = createSetupReadinessReader(projectRoot, {
        readHealth: async () => health(),
        readGithub: async () => unavailable,
        readDeployPipeline: async () => unavailable,
        readExpectedAutomationIds: async () => [SCHEDULER_ID],
        readExpectedSecretNames: async () => [],
      });

      const result = await readReadiness();

      expect(
        result.findings.find(finding => finding.check === "setup.automations")
      ).toMatchObject({ status: expect.not.stringMatching(/^pass$/u) });
    }
  );
});

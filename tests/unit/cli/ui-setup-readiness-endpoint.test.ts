import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runUi } from "../../../src/cli/ui-cmd.js";
import type { AutomationsProbeValue } from "../../../src/cli/ui-automations.js";
import type { GithubRepoPanelValue } from "../../../src/cli/ui-github-repo.js";
import { SETUP_READINESS_CHECKS } from "../../../src/cli/ui-setup-readiness.js";
import type { HealthResult } from "../../../src/health/contract.js";

const ENDPOINT = "/api/setup-readiness";
let projectRoot = "";
let server: Server | undefined;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(tmpdir(), "lisa-ui-setup-endpoint-"));
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (server !== undefined) {
    server.closeAllConnections();
    await new Promise(resolve => server?.close(resolve));
    server = undefined;
  }
  await rm(projectRoot, { recursive: true, force: true });
});

/**
 * Build passing deterministic Health evidence for endpoint fixtures.
 * @returns Stable deterministic Health result.
 */
function health(): HealthResult {
  const checks = [
    "project.state",
    "templates.managed",
    "package.conformance",
    "hooks.managed",
    "plugins.current",
    "config.required",
    "config.sync",
    "instructions.canonical",
    "ci.workflows",
    "github.rulesets",
    "project.wiki",
  ];
  return {
    schemaVersion: 1,
    runId: "endpoint-health",
    mode: "deterministic",
    startedAt: "2026-07-21T13:00:00.000Z",
    completedAt: "2026-07-21T13:00:01.000Z",
    findings: checks.map(check => ({
      check,
      layer: "deterministic" as const,
      status: "pass" as const,
      reason: "Observed fixture evidence.",
    })),
    summary: {
      verdict: "in band",
      counts: { pass: checks.length, warn: 0, fail: 0 },
    },
  };
}

/**
 * Build a governed GitHub repository fixture.
 * @returns Passing GitHub repository panel value.
 */
function github(): GithubRepoPanelValue {
  return {
    owner: "owner",
    repo: "repo",
    settings: {
      allow_merge_commit: false,
      allow_squash_merge: true,
      allow_rebase_merge: false,
      allow_auto_merge: true,
      allow_update_branch: true,
      delete_branch_on_merge: true,
      merge_commit_title: "PR_TITLE",
      has_issues: true,
      has_wiki: false,
      secret_scanning: true,
      default_branch: "main",
    },
    rulesets: [
      {
        name: "main",
        appliesTo: "default",
        enforces: "pull_request",
        active: true,
        targetsDefaultBranch: true,
        requiresPullRequest: true,
        requiresStatusChecks: true,
      },
    ],
    labels: [],
    secrets: [
      { name: "DEPLOY_KEY", purpose: "release", set: true },
      { name: "SONAR_TOKEN", purpose: "quality", set: true },
    ],
  } as GithubRepoPanelValue;
}

/**
 * Build the complete expected scheduler fixture.
 * @returns Active automation observations.
 */
function automations(): AutomationsProbeValue {
  const prefix = "lisa-auto-repo-";
  const suffixes = [
    "intake-repair",
    "intake-prd",
    "intake-tickets",
    "monitor",
    "exploratory-prds",
    "exploratory-bugs",
  ];
  return {
    prefix,
    runtime: "codex",
    automations: suffixes.map(suffix => ({
      id: `${prefix}${suffix}`,
      cadence: "daily",
      runtime: "codex",
      status: "active",
      lastRunAt: null,
    })),
  };
}

/**
 * Read the bound loopback server port.
 * @returns Current server port, or zero before binding.
 */
function port(): number {
  const address = server?.address();
  return typeof address === "object" && address !== null ? address.port : 0;
}

describe("GET /api/setup-readiness", () => {
  it("returns current state on first open without Health storage or mutation", async () => {
    const sentinel = path.join(projectRoot, "sentinel.txt");
    await writeFile(sentinel, "unchanged\n");
    const beforeFiles = (await readdir(projectRoot, { recursive: true })).sort(
      (left, right) => left.localeCompare(right)
    );
    const readHealth = vi.fn(async () => health());
    const readGithub = vi.fn(async () => ({
      state: "value" as const,
      value: github(),
    }));
    const readAutomations = vi.fn(async () => ({
      state: "value" as const,
      value: automations(),
    }));
    const readDeployPipeline = vi.fn(async () => ({
      state: "value" as const,
      value: {
        stages: [
          {
            id: "hold:production",
            name: "Release approval",
            description: "Observed approval hold",
            environment: "production",
            active: true as const,
            reason: "",
          },
        ],
      },
    }));
    server = await runUi(
      projectRoot,
      { port: "0", sync: false },
      {
        probes: [],
        setupReadiness: {
          readConfig: async () => ({
            tracker: "github",
            source: "github",
            github: { org: "owner", repo: "repo" },
          }),
          readHealth,
          readGithub,
          readDeployPipeline,
          readAutomations,
          readExpectedAutomationIds: async () =>
            automations().automations.map(entry =>
              typeof entry === "object" && entry !== null
                ? String(Reflect.get(entry, "id"))
                : ""
            ),
          readExpectedSecretNames: async () => ["SONAR_TOKEN"],
          now: () => new Date("2026-07-21T13:00:02.000Z"),
        },
      }
    );

    const response = await fetch(`http://127.0.0.1:${port()}${ENDPOINT}`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(
      body.findings.map((finding: { check: string }) => finding.check)
    ).toEqual(SETUP_READINESS_CHECKS);
    expect(
      body.findings.find(
        (finding: { check: string }) =>
          finding.check === "setup.github-governance"
      )
    ).toMatchObject({ status: "pass" });
    expect(readHealth).toHaveBeenCalledOnce();
    expect(readGithub).toHaveBeenCalledOnce();
    expect(readDeployPipeline).toHaveBeenCalledOnce();
    expect(readAutomations).toHaveBeenCalledOnce();
    expect(await readFile(sentinel, "utf8")).toBe("unchanged\n");
    expect(
      (await readdir(projectRoot, { recursive: true })).sort((left, right) =>
        left.localeCompare(right)
      )
    ).toEqual(beforeFiles);
    expect(beforeFiles).not.toContain(".lisa/health/latest.json");
  });

  it("supports HEAD, rejects mutation methods, and never invokes readers", async () => {
    const readHealth = vi.fn(async () => health());
    server = await runUi(
      projectRoot,
      { port: "0", sync: false },
      { probes: [], setupReadiness: { readHealth } }
    );
    const base = `http://127.0.0.1:${port()}${ENDPOINT}`;

    const head = await fetch(base, { method: "HEAD" });
    const post = await fetch(base, { method: "POST" });

    expect(head.status).toBe(200);
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
    expect(readHealth).not.toHaveBeenCalled();
  });

  it("recomputes current config-backed findings after each settled read", async () => {
    let trackerConfigured = false;
    const readConfig = vi.fn(async () => ({
      ...(trackerConfigured ? { tracker: "github" } : {}),
      source: "github",
      github: { org: "owner", repo: "repo" },
    }));
    const unavailable = {
      state: "unknown" as const,
      reason: "fixture-unavailable",
      message: "Unavailable fixture",
    };
    server = await runUi(
      projectRoot,
      { port: "0", sync: false },
      {
        probes: [],
        setupReadiness: {
          readConfig,
          readHealth: async () => health(),
          readGithub: async () => unavailable,
          readDeployPipeline: async () => unavailable,
          readAutomations: async () => unavailable,
          readExpectedAutomationIds: async () => [],
          readExpectedSecretNames: async () => [],
        },
      }
    );
    const endpoint = `http://127.0.0.1:${port()}${ENDPOINT}`;
    const trackerStatus = async (): Promise<string> => {
      const response = await fetch(endpoint);
      const body = await response.json();
      return body.findings.find(
        (finding: { check: string }) => finding.check === "setup.tracker"
      ).status as string;
    };

    expect(await trackerStatus()).toBe("fail");
    trackerConfigured = true;
    expect(await trackerStatus()).toBe("pass");
    expect(readConfig).toHaveBeenCalledTimes(2);
  });
});

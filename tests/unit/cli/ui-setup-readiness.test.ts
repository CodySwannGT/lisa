/* eslint-disable jsdoc/require-jsdoc, sonarjs/no-duplicate-string, max-lines -- explicit contract fixtures favor local readability */
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { HealthResult } from "../../../src/health/contract.js";
import type { JsonObject } from "../../../src/sync/json-path.js";
import {
  prdSourceFinding,
  trackerFinding,
} from "../../../src/cli/ui-setup-readiness-config.js";
import {
  agentReadyFinding,
  readWorkflowSecretNames,
  standardsFinding,
} from "../../../src/cli/ui-setup-readiness-local.js";
import {
  expectedCodexManagedFiles,
  installFinding,
} from "../../../src/cli/ui-setup-readiness-install.js";
import type { Harness } from "../../../src/core/config.js";
import {
  automationsFinding,
  githubGovernanceFinding,
  secretsFinding,
} from "../../../src/cli/ui-setup-readiness-remote.js";
import {
  SETUP_READINESS_CHECKS,
  projectSetupReadiness,
  validateSetupReadinessResult,
} from "../../../src/cli/ui-setup-readiness.js";
import type { GithubRepoPanelValue } from "../../../src/cli/ui-github-repo.js";
import type { ProbeResult } from "../../../src/cli/ui-status.js";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

function healthResult(status: "pass" | "warn" = "pass"): HealthResult {
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
    runId: "setup-test",
    mode: "deterministic",
    startedAt: "2026-07-21T12:00:00.000Z",
    completedAt: "2026-07-21T12:00:01.000Z",
    findings: checks.map(check => ({
      check,
      layer: "deterministic" as const,
      status,
      reason: "Stable fixture observation.",
    })),
    summary: {
      verdict: "in band",
      counts: {
        pass: status === "pass" ? checks.length : 0,
        warn: status === "warn" ? checks.length : 0,
        fail: 0,
      },
    },
  };
}

function unknown(reason: string): ProbeResult<never> {
  return { state: "unknown", reason, message: "Unavailable fixture" };
}

async function writeManagedSurface(
  root: string,
  configDir: ".codex" | ".opencode",
  files: readonly string[] = ["agents/lisa.md"]
): Promise<void> {
  await Promise.all(
    files.map(async file => {
      await mkdir(path.dirname(path.join(root, configDir, file)), {
        recursive: true,
      });
      await writeFile(path.join(root, configDir, file), "managed\n");
    })
  );
  await writeFile(
    path.join(root, configDir, ".lisa-managed.json"),
    JSON.stringify({ files })
  );
}

async function writeHarnessSurfaces(
  root: string,
  harness: Harness
): Promise<void> {
  const includes = (agent: Exclude<Harness, "cursor" | "fleet">): boolean =>
    harness === "fleet" || harness === agent;
  if (
    includes("claude") ||
    includes("codex") ||
    includes("agy") ||
    includes("copilot") ||
    includes("opencode")
  ) {
    await writeFile(path.join(root, "AGENTS.md"), "# Project agent rules\n");
  }
  if (includes("claude")) {
    await writeFile(path.join(root, "CLAUDE.md"), "@AGENTS.md\n");
  }
  if (includes("codex")) {
    await writeManagedSurface(
      root,
      ".codex",
      await expectedCodexManagedFiles(root, { harness })
    );
  }
  if (includes("copilot")) {
    await mkdir(path.join(root, ".github"), { recursive: true });
    await writeFile(
      path.join(root, ".github/copilot-instructions.md"),
      "Read AGENTS.md\n"
    );
  }
  if (includes("opencode")) {
    await writeManagedSurface(root, ".opencode");
    await writeFile(path.join(root, "opencode.json"), "{}\n");
  }
}

function healthWithStatus(
  check: string,
  status: "pass" | "warn" | "fail"
): HealthResult {
  const base = healthResult();
  return {
    ...base,
    findings: base.findings.map(finding =>
      finding.check === check ? { ...finding, status } : finding
    ),
  };
}

function githubValue(
  setSecrets: readonly string[] = []
): ProbeResult<GithubRepoPanelValue> {
  return {
    state: "value",
    value: {
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
          enforces: "pull_request, required_status_checks",
          active: true,
          targetsDefaultBranch: true,
          requiresPullRequest: true,
          requiresStatusChecks: true,
        },
      ],
      labels: [],
      secrets: ["DEPLOY_KEY", "SONAR_TOKEN", "SNYK_TOKEN", "FOSSA_API_KEY"].map(
        name => ({
          name,
          purpose: "fixture",
          set: setSecrets.includes(name),
        })
      ),
    } as GithubRepoPanelValue,
  };
}

describe("Setup readiness contract", () => {
  it("returns exactly the twelve stable checklist IDs in order", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "lisa-setup-contract-"));

    const result = await projectSetupReadiness(tempDir, {
      config: {},
      health: healthResult(),
      github: unknown("not-authenticated"),
      deployPipeline: unknown("not-authenticated"),
      automations: unknown("scheduler-unavailable"),
      expectedSecretNames: [],
      observedAt: new Date("2026-07-21T12:00:02.000Z"),
    });

    expect(result.findings.map(finding => finding.check)).toEqual(
      SETUP_READINESS_CHECKS
    );
    expect(result.findings).toHaveLength(12);
    expect(
      result.findings.every(finding => finding.layer === "deterministic")
    ).toBe(true);
  });

  it("rejects missing, reordered, or extra checklist findings", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "lisa-setup-contract-"));
    const valid = await projectSetupReadiness(tempDir, {
      config: {},
      health: healthResult(),
      github: unknown("not-authenticated"),
      deployPipeline: unknown("not-authenticated"),
      automations: unknown("scheduler-unavailable"),
      expectedSecretNames: [],
      observedAt: new Date("2026-07-21T12:00:02.000Z"),
    });
    const reversed = [...valid.findings].reverse();

    expect(() =>
      validateSetupReadinessResult({
        ...valid,
        findings: valid.findings.slice(1),
      })
    ).toThrow(/12 entries/u);
    expect(() =>
      validateSetupReadinessResult({ ...valid, findings: reversed })
    ).toThrow(/expected setup.install/u);
    expect(() =>
      validateSetupReadinessResult({
        ...valid,
        findings: [...valid.findings, valid.findings[0]],
      })
    ).toThrow(/12 entries/u);
  });
});

describe("independent config readiness", () => {
  it("reverses tracker and PRD source independently", () => {
    const trackerOnly: JsonObject = {
      tracker: "github",
      github: { org: "owner", repo: "repo" },
    };
    const sourceOnly: JsonObject = {
      source: "notion",
      notion: { workspaceId: "workspace", prdDatabaseId: "database" },
    };

    expect(trackerFinding(trackerOnly).status).toBe("pass");
    expect(prdSourceFinding(trackerOnly)).toMatchObject({
      status: "fail",
      check: "setup.prd-source",
      reason: expect.stringContaining("PRD source"),
    });
    expect(trackerFinding(sourceOnly)).toMatchObject({
      status: "fail",
      check: "setup.tracker",
    });
    expect(prdSourceFinding(sourceOnly).status).toBe("pass");
  });
});

describe("review red legs", () => {
  it("requires config.required as well as config.sync", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "lisa-setup-sync-"));
    const result = await projectSetupReadiness(tempDir, {
      config: {},
      health: healthWithStatus("config.required", "fail"),
      github: unknown("not-authenticated"),
      deployPipeline: unknown("not-authenticated"),
      automations: unknown("scheduler-unavailable"),
      expectedSecretNames: [],
      observedAt: new Date("2026-07-21T12:00:02.000Z"),
    });

    expect(
      result.findings.find(finding => finding.check === "setup.sync")
    ).toMatchObject({ status: "fail" });
  });

  it("keeps standards explicitly non-pass without current execution proof", () => {
    expect(standardsFinding(healthResult())).toMatchObject({
      status: "warn",
      reason: expect.stringContaining("lint, test, and behavior-preservation"),
    });
  });

  it("requires only authoritative project and external evidence per harness", async () => {
    const pluginUnavailable = healthWithStatus("plugins.current", "warn");
    tempDir = await mkdtemp(path.join(tmpdir(), "lisa-install-harnesses-"));
    const expectations: ReadonlyArray<readonly [Harness, "pass" | "warn"]> = [
      ["claude", "pass"],
      ["codex", "pass"],
      ["cursor", "warn"],
      ["agy", "warn"],
      ["copilot", "warn"],
      ["opencode", "warn"],
      ["fleet", "warn"],
    ];
    for (const [harness, expected] of expectations) {
      const root = path.join(tempDir, harness);
      await mkdir(root);
      await writeHarnessSurfaces(root, harness);
      const finding = await installFinding(root, { harness }, healthResult());
      expect(finding.status, harness).toBe(expected);
    }

    const claude = path.join(tempDir, "claude");
    expect((await installFinding(claude, {}, pluginUnavailable)).status).toBe(
      "warn"
    );
    expect((await installFinding(claude, {}, healthResult())).status).toBe(
      "pass"
    );
  });

  it("fails closed when managed harness evidence is missing, unsafe, or invalid", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "lisa-install-managed-"));
    const root = path.join(tempDir, "codex");
    await mkdir(root);
    await writeHarnessSurfaces(root, "codex");
    expect(
      (await installFinding(root, { harness: "codex" }, healthResult())).status
    ).toBe("pass");

    await rm(path.join(root, ".codex/config.toml"));
    expect(
      (await installFinding(root, { harness: "codex" }, healthResult())).status
    ).toBe("fail");

    await writeFile(path.join(root, ".codex/config.toml"), "managed\n");
    await writeFile(
      path.join(root, ".codex/.lisa-managed.json"),
      JSON.stringify({ files: ["config.toml"] })
    );
    expect(
      (await installFinding(root, { harness: "codex" }, healthResult())).status
    ).toBe("fail");

    await writeFile(
      path.join(root, ".codex/.lisa-managed.json"),
      JSON.stringify({ files: [] })
    );
    expect(
      (await installFinding(root, { harness: "codex" }, healthResult())).status
    ).toBe("fail");

    await writeFile(
      path.join(root, ".codex/.lisa-managed.json"),
      JSON.stringify({ files: ["../outside.md"] })
    );
    expect(
      (await installFinding(root, { harness: "codex" }, healthResult())).status
    ).toBe("fail");

    await rm(path.join(root, ".codex/.lisa-managed.json"));
    await symlink(
      path.join(root, ".codex/config.toml"),
      path.join(root, ".codex/.lisa-managed.json")
    );
    expect(
      (await installFinding(root, { harness: "codex" }, healthResult())).status
    ).toBe("fail");
  });

  it("keeps OpenCode non-pass and fails obvious declared-file drift", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "lisa-install-opencode-"));
    await writeHarnessSurfaces(tempDir, "opencode");
    expect(
      (await installFinding(tempDir, { harness: "opencode" }, healthResult()))
        .status
    ).toBe("warn");

    await rm(path.join(tempDir, ".opencode/agents/lisa.md"));
    expect(
      (await installFinding(tempDir, { harness: "opencode" }, healthResult()))
        .status
    ).toBe("fail");
  });

  it("does not invent a project-local Cursor surface to manufacture a pass", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "lisa-install-cursor-"));
    const finding = await installFinding(
      tempDir,
      { harness: "cursor" },
      healthResult()
    );
    expect(finding).toMatchObject({
      status: "warn",
      reason: expect.stringContaining("cannot yet be observed authoritatively"),
    });
  });

  it("requires default-branch PR and status-check governance semantics", () => {
    const github = githubValue(["DEPLOY_KEY"]);
    const deploy = {
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
    };
    expect(githubGovernanceFinding(healthResult(), github, deploy).status).toBe(
      "pass"
    );
    if (github.state !== "value") throw new Error("Fixture must be concrete");
    const wrongBranch = {
      ...github,
      value: {
        ...github.value,
        rulesets: github.value.rulesets.map(row => ({
          ...row,
          targetsDefaultBranch: false,
        })),
      } as GithubRepoPanelValue,
    };

    expect(
      githubGovernanceFinding(healthResult(), wrongBranch, deploy)
    ).toMatchObject({
      status: "warn",
      reason: expect.stringContaining("default-branch"),
    });
  });

  it("requires canonical ruleset Health evidence despite plausible live data", () => {
    const github = githubValue(["DEPLOY_KEY"]);
    const deploy = {
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
    };

    for (const status of ["warn", "fail"] as const) {
      const finding = githubGovernanceFinding(
        healthWithStatus("github.rulesets", status),
        github,
        deploy
      );
      expect(finding.status).not.toBe("pass");
      expect(finding.reason).toContain("canonical github.rulesets");
      expect(finding.reason).not.toContain("Stable fixture observation");
    }
  });

  it("requires only automation entries applicable to detected stacks", () => {
    const prefix = "lisa-auto-repo-";
    const expected = [
      "intake-repair",
      "intake-prd",
      "intake-tickets",
      "monitor",
      "exploratory-prds",
    ].map(suffix => `${prefix}${suffix}`);
    const result = {
      state: "value" as const,
      value: {
        prefix,
        runtime: "codex" as const,
        automations: expected.map(id => ({
          id,
          cadence: "daily",
          runtime: "codex",
          status: "active",
          lastRunAt: null,
        })),
      },
    };

    expect(automationsFinding(result, expected).status).toBe("pass");
  });
});

describe("truthful unavailable and reversible evidence", () => {
  it("never marks missing capabilities complete", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "lisa-setup-missing-"));
    const result = await projectSetupReadiness(tempDir, {
      config: {},
      github: unknown("not-authenticated"),
      deployPipeline: unknown("not-authenticated"),
      automations: unknown("scheduler-unavailable"),
      expectedSecretNames: [],
      observedAt: new Date("2026-07-21T12:00:02.000Z"),
    });
    const status = new Map(
      result.findings.map(finding => [finding.check, finding.status])
    );

    [
      "setup.install",
      "setup.agent-ready",
      "setup.tracker",
      "setup.prd-source",
      "setup.github-governance",
      "setup.secrets",
      "setup.automations",
      "setup.exploration",
      "setup.wiki",
      "setup.starter-provenance",
    ].forEach(check => expect(status.get(check)).not.toBe("pass"));
  });

  it("moves agent-ready pending to pass and back from its own files", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "lisa-agent-ready-"));
    expect((await agentReadyFinding(tempDir)).status).toBe("warn");
    await mkdir(path.join(tempDir, "wiki/state/agent-ready"), {
      recursive: true,
    });
    await mkdir(path.join(tempDir, "wiki/sources/repository"), {
      recursive: true,
    });
    await writeFile(
      path.join(tempDir, "wiki/sources/repository/source.md"),
      "# Sanitized source\n"
    );
    await writeFile(
      path.join(tempDir, "wiki/state/agent-ready/sources.json"),
      JSON.stringify({
        schema_version: 1,
        updated_at: "2026-07-21T12:00:00.000Z",
        sources: [
          {
            source_id: "repository",
            scope: "local repository and full git history",
            read_only_probe: {
              command: "git log --all",
              observed: "history read successfully",
            },
            terminal_status: "complete",
            sanitized_evidence: ["wiki/sources/repository/source.md"],
            open_gap: null,
          },
        ],
      })
    );
    await writeFile(path.join(tempDir, "wiki/gaps.md"), "# Gaps\n\nNone.\n");
    expect((await agentReadyFinding(tempDir)).status).toBe("pass");

    await writeFile(
      path.join(tempDir, "wiki/gaps.md"),
      "### missing-owner\n- **Status**: open\n"
    );
    expect((await agentReadyFinding(tempDir)).status).toBe("warn");

    await rm(path.join(tempDir, "wiki/sources/repository/source.md"));
    expect((await agentReadyFinding(tempDir)).status).toBe("fail");
  });

  it("rejects traversal outside wiki/sources even when the target is a file", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "lisa-agent-ready-traversal-"));
    await mkdir(path.join(tempDir, "wiki/state/agent-ready"), {
      recursive: true,
    });
    await writeFile(path.join(tempDir, "package.json"), "{}\n");
    await writeFile(path.join(tempDir, "wiki/gaps.md"), "# Gaps\n\nNone.\n");
    await writeFile(
      path.join(tempDir, "wiki/state/agent-ready/sources.json"),
      JSON.stringify({
        schema_version: 1,
        updated_at: "2026-07-21T12:00:00.000Z",
        sources: [
          {
            source_id: "repository",
            scope: "local repository",
            read_only_probe: { command: "git log", observed: "read" },
            terminal_status: "complete",
            sanitized_evidence: ["wiki/../package.json"],
            open_gap: null,
          },
        ],
      })
    );

    expect(await agentReadyFinding(tempDir)).toMatchObject({ status: "fail" });
  });

  it("rejects a wiki/sources evidence symlink to another file", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "lisa-agent-ready-symlink-"));
    await mkdir(path.join(tempDir, "wiki/state/agent-ready"), {
      recursive: true,
    });
    await mkdir(path.join(tempDir, "wiki/sources/repository"), {
      recursive: true,
    });
    await writeFile(path.join(tempDir, "package.json"), "{}\n");
    await symlink(
      path.join(tempDir, "package.json"),
      path.join(tempDir, "wiki/sources/repository/source.md")
    );
    await writeFile(path.join(tempDir, "wiki/gaps.md"), "# Gaps\n\nNone.\n");
    await writeFile(
      path.join(tempDir, "wiki/state/agent-ready/sources.json"),
      JSON.stringify({
        schema_version: 1,
        updated_at: "2026-07-21T12:00:00.000Z",
        sources: [
          {
            source_id: "repository",
            scope: "local repository",
            read_only_probe: { command: "git log", observed: "read" },
            terminal_status: "complete",
            sanitized_evidence: ["wiki/sources/repository/source.md"],
            open_gap: null,
          },
        ],
      })
    );

    expect(await agentReadyFinding(tempDir)).toMatchObject({ status: "fail" });
  });

  it("requires only workflow-established secret names and never values", () => {
    const finding = secretsFinding(githubValue(["SONAR_TOKEN"]), [
      "SONAR_TOKEN",
    ]);

    expect(finding.status).toBe("pass");
    expect(finding.reason).not.toContain("SNYK_TOKEN");
    expect(finding.reason).not.toContain("FOSSA_API_KEY");
    expect(JSON.stringify(finding)).not.toContain("sensitive-value");
  });

  it("derives secret names from workflows and excludes implicit GITHUB_TOKEN", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "lisa-workflow-secrets-"));
    await mkdir(path.join(tempDir, ".github/workflows"), { recursive: true });
    await writeFile(
      path.join(tempDir, ".github/workflows/ci.yml"),
      "env:\n  BUILTIN: ${{ secrets.GITHUB_TOKEN }}\n  SONAR: ${{ secrets.SONAR_TOKEN }}\n"
    );

    expect(await readWorkflowSecretNames(tempDir)).toEqual(["SONAR_TOKEN"]);
  });
});

/* eslint-enable jsdoc/require-jsdoc, sonarjs/no-duplicate-string, max-lines -- end explicit contract fixture exceptions */

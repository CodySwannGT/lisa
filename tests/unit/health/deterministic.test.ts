/* eslint-disable sonarjs/no-duplicate-string, jsdoc/require-jsdoc, max-lines, @eslint-community/eslint-comments/disable-enable-pair -- repeated fixture identifiers make the finding matrix explicit */
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  configPresent: true,
  settings: {} as Record<string, unknown> | undefined,
  texts: new Map<string, string | undefined>(),
  sync: {
    actions: [] as { key: string; kind: string; detail: string }[],
    missingRequired: [] as { key: string; setupHint: string }[],
    dryRun: true,
  },
  drift: {
    managed: [] as string[],
    hooks: [] as string[],
    workflows: [] as string[],
  },
  missingWorkflows: [] as string[],
  staleWorkflowInputs: [] as string[],
  packageConforms: true,
  rulesetsPresent: true,
  runConfigSync: vi.fn(),
}));

vi.mock("../../../src/sync/config-sync.js", () => ({
  runConfigSync: mocks.runConfigSync,
}));

vi.mock("../../../src/core/lisa-plugin-selection.js", () => ({
  selectProjectLisaPlugins: vi.fn(async () => ["lisa"]),
}));

vi.mock("../../../src/cli/version.js", () => ({
  getPackageVersion: vi.fn(() => "2.999.0"),
}));

vi.mock("../../../src/health/read-only-fs.js", () => ({
  projectPathKind: vi.fn(async (_root: string, relativePath: string) =>
    relativePath === ".lisa.config.json" && mocks.configPresent
      ? "file"
      : "missing"
  ),
  readProjectJsonObject: vi.fn(async (_root: string, relativePath: string) =>
    relativePath === ".lisa.config.json" ? mocks.config : mocks.settings
  ),
  readProjectText: vi.fn(async (_root: string, relativePath: string) =>
    mocks.texts.get(relativePath)
  ),
}));

vi.mock("../../../src/health/template-inspection.js", () => ({
  detectHealthProjectShape: vi.fn(async () => ({
    types: ["typescript"],
    packageJson: { name: "fixture", devDependencies: { typescript: "5.9.3" } },
  })),
  detectHealthProjectTypes: vi.fn(async () => []),
  inspectCreateOnlyWorkflows: vi.fn(async () => mocks.missingWorkflows),
  inspectWorkflowInputs: vi.fn(async () => ({
    stale: mocks.staleWorkflowInputs,
    unknown: [],
  })),
  inspectManagedTemplates: vi.fn(
    async (
      _lisaRoot: string,
      _projectRoot: string,
      _types: readonly string[],
      category: "managed" | "hooks" | "workflows"
    ) => mocks.drift[category]
  ),
  packageJsonConforms: vi.fn(async () => mocks.packageConforms),
}));

vi.mock("../../../src/health/hook-inspection.js", () => ({
  readCoreHooksPath: vi.fn(async () => ".husky"),
  inspectHookInstallation: vi.fn(async () => ({ status: "pass", drift: [] })),
}));

vi.mock("../../../src/health/plugin-inspection.js", () => ({
  readInstalledClaudePlugins: vi.fn(async () => ["lisa@lisa"]),
  inspectPlugins: vi.fn(async () => {
    const marker = mocks.texts.get(
      path.join(".claude", ".lisa-plugins-synced")
    );
    if (mocks.settings === undefined) {
      return { status: "warn", drift: ["unsupported harness"] };
    }
    return marker === "2.999.0\n"
      ? { status: "pass", drift: [] }
      : { status: "fail", drift: ["plugin version marker"] };
  }),
}));

vi.mock("../../../src/health/ruleset-inspection.js", () => ({
  readGithubRulesets: vi.fn(async () => []),
  rulesetFinding: vi.fn(
    async (
      _lisaRoot: string,
      _projectRoot: string,
      _types: readonly string[],
      _config: Record<string, unknown>,
      reader: () => Promise<unknown>
    ) => {
      try {
        await reader();
      } catch {
        return {
          check: "github.rulesets",
          layer: "deterministic",
          status: "warn",
          reason:
            "GitHub rulesets could not be observed within the deterministic deadline.",
        };
      }
      return mocks.rulesetsPresent
        ? {
            check: "github.rulesets",
            layer: "deterministic",
            status: "pass",
            reason:
              "Required GitHub rulesets are active and materially current.",
          }
        : {
            check: "github.rulesets",
            layer: "deterministic",
            status: "fail",
            reason: "GitHub ruleset drift: Base missing",
          };
    }
  ),
}));

import { runDeterministicHealth } from "../../../src/health/deterministic.js";

const CHECK_ORDER = [
  "project.state",
  "project.wiki",
  "starters.remote",
  "config.required",
  "config.sync",
  "templates.managed",
  "package.conformance",
  "instructions.canonical",
  "hooks.managed",
  "plugins.current",
  "ci.workflows",
  "github.rulesets",
] as const;

let projectRoot: string;

function resetMocks(): void {
  mocks.config = {
    tracker: "github",
    github: { org: "example", repo: "project" },
  };
  mocks.configPresent = true;
  mocks.settings = { enabledPlugins: { "lisa@lisa": true } };
  mocks.texts = new Map([
    ["AGENTS.md", "Canonical project instructions."],
    ["CLAUDE.md", "@AGENTS.md"],
    [path.join(".claude", ".lisa-plugins-synced"), "2.999.0\n"],
  ]);
  mocks.sync = { actions: [], missingRequired: [], dryRun: true };
  mocks.drift = { managed: [], hooks: [], workflows: [] };
  mocks.missingWorkflows = [];
  mocks.staleWorkflowInputs = [];
  mocks.packageConforms = true;
  mocks.rulesetsPresent = true;
  mocks.runConfigSync.mockReset();
  mocks.runConfigSync.mockImplementation(async () => mocks.sync);
}

async function collect(
  overrides: Parameters<typeof runDeterministicHealth>[1] = {}
) {
  return runDeterministicHealth(projectRoot, {
    lisaRoot: projectRoot,
    now: () => new Date("2026-07-20T12:00:00.000Z"),
    ...overrides,
  });
}

beforeAll(async () => {
  projectRoot = await realpath(
    await mkdtemp(path.join(tmpdir(), "lisa-health-unit-"))
  );
});

beforeEach(() => {
  resetMocks();
});

afterAll(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe("runDeterministicHealth", () => {
  it("returns a strict frozen result with every check in deterministic order", async () => {
    const exitCode = process.exitCode;
    const result = await collect();

    expect(result.findings.map(finding => finding.check)).toEqual(CHECK_ORDER);
    expect(result.mode).toBe("deterministic");
    expect(
      result.findings.every(finding => finding.layer === "deterministic")
    ).toBe(true);
    expect(result.summary).toEqual({
      verdict: "in band",
      counts: { pass: 11, warn: 1, fail: 0 },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.findings)).toBe(true);
    expect(process.exitCode).toBe(exitCode);
    expect(mocks.runConfigSync).toHaveBeenCalledTimes(1);
    expect(mocks.runConfigSync).toHaveBeenCalledWith(projectRoot, {
      dryRun: true,
      reads: expect.objectContaining({
        readJson: expect.any(Function),
        pathExists: expect.any(Function),
      }),
    });
  });

  it.each([
    ["project.state", () => (mocks.configPresent = false), "Project config"],
    [
      "config.required",
      () =>
        (mocks.sync.missingRequired = [
          { key: "github.repo", setupHint: "do not disclose this hint" },
        ]),
      "github.repo",
    ],
    [
      "config.sync",
      () =>
        (mocks.sync.actions = [
          {
            key: "quality.lintBudgets",
            kind: "artifact-synced",
            detail: "secret",
          },
        ]),
      "quality.lintBudgets",
    ],
    [
      "templates.managed",
      () => mocks.drift.managed.push("eslint.config.ts"),
      "eslint.config.ts",
    ],
    [
      "package.conformance",
      () => (mocks.packageConforms = false),
      "package.json",
    ],
    [
      "instructions.canonical",
      () => mocks.texts.delete("AGENTS.md"),
      "AGENTS.md",
    ],
    [
      "hooks.managed",
      () => mocks.drift.hooks.push(".husky/pre-push"),
      ".husky/pre-push",
    ],
    [
      "plugins.current",
      () =>
        mocks.texts.set(path.join(".claude", ".lisa-plugins-synced"), "old"),
      "plugin version marker",
    ],
    [
      "ci.workflows",
      () => mocks.missingWorkflows.push(".github/workflows/ci.yml"),
      "ci.yml",
    ],
    ["github.rulesets", () => (mocks.rulesetsPresent = false), "Base"],
  ])(
    "reports observed %s drift as a named failure",
    async (check, arrange, name) => {
      arrange();
      const result = await collect();
      const observed = result.findings.find(finding => finding.check === check);

      expect(observed).toMatchObject({
        status: "fail",
        layer: "deterministic",
      });
      expect(observed?.reason).toContain(name);
      expect(observed?.reason).not.toContain("do not disclose this hint");
      expect(observed?.reason).not.toContain("secret");
    }
  );

  it("maps unavailable optional capabilities to bounded warnings without raw errors", async () => {
    mocks.settings = undefined;
    const result = await collect({
      readRulesets: async () => {
        throw new Error("token=never-print-this /absolute/private/path");
      },
    });

    expect(
      result.findings.find(finding => finding.check === "plugins.current")
    ).toMatchObject({
      status: "warn",
      reason: "Plugin state unavailable: unsupported harness",
    });
    const rulesets = result.findings.find(
      finding => finding.check === "github.rulesets"
    );
    expect(rulesets?.status).toBe("warn");
    expect(rulesets?.reason).not.toContain("never-print-this");
    expect(rulesets?.reason).not.toContain("/absolute/private/path");
  });

  it("maps deterministic exceptions to failures and respects the shared timeout", async () => {
    mocks.runConfigSync.mockRejectedValue(new Error("config-secret"));
    const started = Date.now();
    const result = await collect({
      deadlineMs: 10,
      readRulesets: async () => new Promise(() => undefined),
    });

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(
      result.findings.find(finding => finding.check === "config.required")
    ).toMatchObject({
      status: "fail",
    });
    expect(
      result.findings.find(finding => finding.check === "config.sync")
    ).toMatchObject({
      status: "fail",
    });
    expect(
      result.findings.find(finding => finding.check === "github.rulesets")
    ).toMatchObject({
      status: "warn",
    });
    expect(JSON.stringify(result)).not.toContain("config-secret");
  });
});

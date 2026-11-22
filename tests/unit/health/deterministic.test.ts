/**
 * `runDeterministicHealth` with every inspector mocked: check order, named
 * drift failures, bounded warnings, and the shared deadline.
 * @module tests/unit/health/deterministic.test
 */
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

const mocks = await vi.hoisted(async () => {
  const { defaultMockState } = await import("./deterministic-fixtures.js");
  return { ...defaultMockState(), runConfigSync: vi.fn() };
});

vi.mock("../../../src/sync/config-sync.js", () => ({
  runConfigSync: mocks.runConfigSync,
}));

vi.mock("../../../src/core/lisa-plugin-selection.js", () => ({
  selectProjectLisaPlugins: vi.fn(async () => ["lisa"]),
}));

vi.mock("../../../src/cli/version.js", async () => {
  const { PACKAGE_VERSION } = await import("./deterministic-fixtures.js");
  return { getPackageVersion: vi.fn(() => PACKAGE_VERSION) };
});

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

vi.mock("../../../src/health/plugin-inspection.js", async () => {
  const { PACKAGE_VERSION, PLUGIN_MARKER_PATH } =
    await import("./deterministic-fixtures.js");
  return {
    readInstalledClaudePlugins: vi.fn(async () => ["lisa@lisa"]),
    inspectPlugins: vi.fn(async () => {
      if (mocks.settings === undefined) {
        return { status: "warn", drift: ["unsupported harness"] };
      }
      return mocks.texts.get(PLUGIN_MARKER_PATH) === `${PACKAGE_VERSION}\n`
        ? { status: "pass", drift: [] }
        : { status: "fail", drift: ["plugin version marker"] };
    }),
  };
});

vi.mock("../../../src/health/ruleset-inspection.js", async () => {
  const { fakeRulesetFinding } = await import("./deterministic-fixtures.js");
  return {
    readGithubRulesets: vi.fn(async () => []),
    rulesetFinding: vi.fn(
      async (
        _lisaRoot: string,
        _projectRoot: string,
        _types: readonly string[],
        _config: Record<string, unknown>,
        reader: () => Promise<unknown>
      ) => fakeRulesetFinding(reader, mocks.rulesetsPresent)
    ),
  };
});

vi.mock("../../../src/health/ruleset-reach-inspection.js", () => ({
  readGithubBranches: vi.fn(async () => ({
    branches: ["main"],
    defaultBranch: "main",
  })),
  rulesetReachFinding: vi.fn(async () => ({
    check: "github.ruleset-reach",
    layer: "deterministic",
    status: "pass",
    reason:
      "Every live ruleset governs at least one branch this repository has.",
  })),
}));

import { runDeterministicHealth } from "../../../src/health/deterministic.js";
import {
  CHECK_ORDER,
  defaultMockState,
  PLUGIN_MARKER_PATH,
} from "./deterministic-fixtures.js";

/** Check identifiers the suite inspects by name. */
const CONFIG_REQUIRED = "config.required";
const CONFIG_SYNC = "config.sync";
const PLUGINS_CURRENT = "plugins.current";
const GITHUB_RULESETS = "github.rulesets";
/** Setup hint that must never reach a finding reason. */
const UNDISCLOSED_HINT = "do not disclose this hint";

let projectRoot: string;

/** Restore the in-band default mock state before each case. */
function resetMocks(): void {
  Object.assign(mocks, defaultMockState());
  mocks.runConfigSync.mockReset();
  mocks.runConfigSync.mockImplementation(async () => mocks.sync);
}

/**
 * Run the deterministic layer against the suite's project root.
 * @param overrides - Option overrides merged over the fixture defaults
 * @returns The deterministic Health result
 */
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
      counts: { pass: 13, warn: 2, fail: 0 },
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
      CONFIG_REQUIRED,
      () =>
        (mocks.sync.missingRequired = [
          { key: "github.repo", setupHint: UNDISCLOSED_HINT },
        ]),
      "github.repo",
    ],
    [
      CONFIG_SYNC,
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
      PLUGINS_CURRENT,
      () => mocks.texts.set(PLUGIN_MARKER_PATH, "old"),
      "plugin version marker",
    ],
    [
      "ci.workflows",
      () => mocks.missingWorkflows.push(".github/workflows/ci.yml"),
      "ci.yml",
    ],
    [GITHUB_RULESETS, () => (mocks.rulesetsPresent = false), "Base"],
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
      expect(observed?.reason).not.toContain(UNDISCLOSED_HINT);
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
      result.findings.find(finding => finding.check === PLUGINS_CURRENT)
    ).toMatchObject({
      status: "warn",
      reason: "Plugin state unavailable: unsupported harness",
    });
    const rulesets = result.findings.find(
      finding => finding.check === GITHUB_RULESETS
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
      result.findings.find(finding => finding.check === CONFIG_REQUIRED)
    ).toMatchObject({
      status: "fail",
    });
    expect(
      result.findings.find(finding => finding.check === CONFIG_SYNC)
    ).toMatchObject({
      status: "fail",
    });
    expect(
      result.findings.find(finding => finding.check === GITHUB_RULESETS)
    ).toMatchObject({
      status: "warn",
    });
    expect(JSON.stringify(result)).not.toContain("config-secret");
  });
});

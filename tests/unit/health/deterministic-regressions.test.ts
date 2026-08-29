/* eslint-disable jsdoc/require-jsdoc, sonarjs/no-duplicate-string, max-lines -- security and parity fixtures stay colocated */
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { getPackageVersion } from "../../../src/cli/version.js";
import { runDeterministicHealth } from "../../../src/health/deterministic.js";
import { inspectHookInstallation } from "../../../src/health/hook-inspection.js";
import {
  inspectPlugins,
  readInstalledClaudePlugins,
} from "../../../src/health/plugin-inspection.js";
import { readProjectFile } from "../../../src/health/read-only-fs.js";
import {
  compareRulesets,
  expectedRulesets,
  rulesetFinding,
  type HealthRuleset,
} from "../../../src/health/ruleset-inspection.js";
import {
  inspectManagedTemplates,
  inspectWorkflowInputs,
} from "../../../src/health/template-inspection.js";
import { mergeTemplateJson } from "../../../src/strategies/merge.js";
import { TaggedMergeStrategy } from "../../../src/strategies/tagged-merge.js";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";

const temporaryRoots: string[] = [];
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);
const HUSKY_HOOKS = [
  "commit-msg",
  "post-checkout",
  "pre-commit",
  "pre-push",
  "prepare-commit-msg",
] as const;

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  temporaryRoots.push(root);
  return root;
}

async function write(
  relativeRoot: string,
  relativePath: string,
  content: string
) {
  const destination = path.join(relativeRoot, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(root => rm(root, { recursive: true, force: true }))
  );
});

describe("deterministic health safety regressions", () => {
  const fifoIt = process.platform === "win32" ? it.skip : it;

  fifoIt("hard-kills a default subprocess that ignores SIGTERM", async () => {
    const root = await temporaryRoot("lisa-health-subprocess-");
    const bin = path.join(root, "bin");
    await write(
      bin,
      "claude",
      "#!/bin/sh\ntrap '' TERM\nwhile :; do :; done\n"
    );
    await chmod(path.join(bin, "claude"), 0o755);
    vi.stubEnv("PATH", `${bin}${path.delimiter}${process.env.PATH ?? ""}`);

    const started = Date.now();
    await expect(
      readInstalledClaudePlugins(root, 25, new AbortController().signal)
    ).rejects.toBeDefined();
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  fifoIt(
    "rejects project FIFOs and external FIFO symlinks without blocking",
    async () => {
      const root = await temporaryRoot("lisa-health-fifo-");
      const external = await temporaryRoot("lisa-health-external-fifo-");
      const internalFifo = path.join(root, "package.json");
      const externalFifo = path.join(external, "outside.json");
      boundedExecFileSync({
        label: "mkfifo internal fixture",
        command: "mkfifo",
        args: [internalFifo],
      });
      boundedExecFileSync({
        label: "mkfifo external fixture",
        command: "mkfifo",
        args: [externalFifo],
      });

      const started = Date.now();
      await expect(readProjectFile(root, "package.json")).rejects.toThrow(
        "Unsafe health project file"
      );
      await rm(internalFifo);
      await symlink(externalFifo, internalFifo);
      await expect(readProjectFile(root, "package.json")).rejects.toThrow(
        "Unsafe health project file"
      );
      expect(Date.now() - started).toBeLessThan(1_000);
    }
  );

  fifoIt(
    "includes setup and unsafe package detection in one absolute deadline",
    async () => {
      const root = await temporaryRoot("lisa-health-deadline-");
      await write(
        root,
        ".lisa.config.json",
        '{"tracker":"github","harness":"codex"}\n'
      );
      boundedExecFileSync({
        label: "mkfifo package.json fixture",
        command: "mkfifo",
        args: [path.join(root, "package.json")],
      });
      const started = Date.now();
      const result = await runDeterministicHealth(root, {
        lisaRoot: process.cwd(),
        deadlineMs: 25,
        readRulesets: async () => new Promise(() => undefined),
        readHooksPath: async () => new Promise(() => undefined),
        readInstalledPlugins: async () => new Promise(() => undefined),
      });

      expect(Date.now() - started).toBeLessThan(1_000);
      expect(result.findings).toHaveLength(15);
      expect(
        result.findings.find(finding => finding.check === "project.state")
      ).toMatchObject({ status: "fail" });
    }
  );
});
describe("deterministic health governance regressions", () => {
  it("finds stale with keys in create-only workflow callers", async () => {
    const lisaRoot = await temporaryRoot("lisa-health-workflow-source-");
    const projectRoot = await temporaryRoot("lisa-health-workflow-host-");
    const caller = `jobs:\n  verify:\n    uses: CodySwannGT/lisa/.github/workflows/reusable.yml@main\n    with:\n      stale_input: true\n`;
    await write(
      lisaRoot,
      "typescript/create-only/.github/workflows/caller.yml",
      caller
    );
    await write(
      lisaRoot,
      ".github/workflows/reusable.yml",
      "on:\n  workflow_call:\n    inputs:\n      current_input:\n        type: boolean\n"
    );
    await write(projectRoot, ".github/workflows/caller.yml", caller);

    await expect(
      inspectWorkflowInputs(lisaRoot, projectRoot, ["typescript"])
    ).resolves.toEqual({
      stale: [".github/workflows/caller.yml#reusable.yml:stale_input"],
      unknown: [],
    });
  });

  it("does not resolve third-party contracts by a Lisa workflow basename", async () => {
    const lisaRoot = await temporaryRoot("lisa-health-third-party-source-");
    const projectRoot = await temporaryRoot("lisa-health-third-party-host-");
    const caller = `jobs:\n  verify:\n    uses: vendor/other/.github/workflows/reusable.yml@v1\n    with:\n      stale_input: true\n`;
    await write(
      lisaRoot,
      "typescript/create-only/.github/workflows/caller.yml",
      caller
    );
    await write(
      lisaRoot,
      ".github/workflows/reusable.yml",
      "on:\n  workflow_call:\n    inputs:\n      current_input:\n        type: boolean\n"
    );
    await write(projectRoot, ".github/workflows/caller.yml", caller);

    await expect(
      inspectWorkflowInputs(lisaRoot, projectRoot, ["typescript"])
    ).resolves.toEqual({
      stale: [],
      unknown: [".github/workflows/caller.yml#reusable.yml"],
    });
  });

  it("honors ignore and deletion ownership before reporting managed drift", async () => {
    const lisaRoot = await temporaryRoot("lisa-health-ownership-source-");
    const projectRoot = await temporaryRoot("lisa-health-ownership-host-");
    await write(lisaRoot, "all/copy-overwrite/managed.txt", "expected\n");
    await write(projectRoot, "managed.txt", "custom\n");
    await write(projectRoot, ".lisaignore", "managed.txt\n");
    await expect(
      inspectManagedTemplates(lisaRoot, projectRoot, [], "managed")
    ).resolves.toEqual([]);

    await write(projectRoot, ".lisaignore", "");
    await write(
      lisaRoot,
      "all/deletions.json",
      '{"paths":["managed.txt"],"keep":[]}\n'
    );
    await expect(
      inspectManagedTemplates(lisaRoot, projectRoot, [], "managed")
    ).resolves.toEqual([]);
  });

  it("uses exact managed-block semantics for copy-contents", async () => {
    const lisaRoot = await temporaryRoot("lisa-health-block-source-");
    const projectRoot = await temporaryRoot("lisa-health-block-host-");
    const block = "# BEGIN: AI GUARDRAILS\nbuild/\n# END: AI GUARDRAILS\n";
    await write(lisaRoot, "all/copy-contents/gitignore", block);
    await write(projectRoot, ".gitignore", `custom/\n${block}`);
    await expect(
      inspectManagedTemplates(lisaRoot, projectRoot, [], "managed")
    ).resolves.toEqual([]);

    await write(
      projectRoot,
      ".gitignore",
      "custom/\n# BEGIN: AI GUARDRAILS\nstale/\n# END: AI GUARDRAILS\n"
    );
    await expect(
      inspectManagedTemplates(lisaRoot, projectRoot, [], "managed")
    ).resolves.toEqual([".gitignore"]);
  });

  it("composes parent overwrite and child content management before comparing", async () => {
    const lisaRoot = await temporaryRoot("lisa-health-composed-source-");
    const projectRoot = await temporaryRoot("lisa-health-composed-host-");
    await write(lisaRoot, "all/copy-overwrite/.prettierignore", "dist/\n");
    await write(
      lisaRoot,
      "harper-fabric/copy-contents/.prettierignore",
      "# BEGIN: AI GUARDRAILS\nharper-app/.cache/\n# END: AI GUARDRAILS\n"
    );
    await write(
      projectRoot,
      ".prettierignore",
      "dist/\n\n# BEGIN: AI GUARDRAILS\nharper-app/.cache/\n# END: AI GUARDRAILS\n"
    );

    await expect(
      inspectManagedTemplates(
        lisaRoot,
        projectRoot,
        ["typescript", "harper-fabric"],
        "managed"
      )
    ).resolves.toEqual([]);
  });

  it("composes overlapping merge and tagged-merge destinations once", async () => {
    const lisaRoot = await temporaryRoot("lisa-health-json-stack-source-");
    const projectRoot = await temporaryRoot("lisa-health-json-stack-host-");
    const parent = { base: true, shared: "parent" };
    const child = {
      "//lisa-force-governed": "required",
      governed: { enabled: true },
      "//end-lisa-force-governed": "",
    };
    const host = { custom: true };
    const expected = new TaggedMergeStrategy().mergeJson(
      child,
      mergeTemplateJson(parent, host)
    );
    await write(lisaRoot, "all/merge/settings.json", JSON.stringify(parent));
    await write(
      lisaRoot,
      "typescript/tagged-merge/settings.json",
      JSON.stringify(child)
    );
    await write(projectRoot, "settings.json", JSON.stringify(expected));

    await expect(
      inspectManagedTemplates(lisaRoot, projectRoot, ["typescript"], "managed")
    ).resolves.toEqual([]);

    await write(
      projectRoot,
      "settings.json",
      JSON.stringify({ ...expected, governed: { enabled: false } })
    );
    await expect(
      inspectManagedTemplates(lisaRoot, projectRoot, ["typescript"], "managed")
    ).resolves.toEqual(["settings.json"]);
  });

  it("requires executable Husky hooks and installed plugin state", async () => {
    const root = await temporaryRoot("lisa-health-installed-state-");
    for (const hook of HUSKY_HOOKS) {
      await write(root, path.join(".husky", hook), "#!/bin/sh\n");
      await chmod(path.join(root, ".husky", hook), 0o755);
    }
    await chmod(path.join(root, ".husky", "pre-push"), 0o644);
    await expect(
      inspectHookInstallation(
        root,
        ["typescript"],
        async () => ".husky",
        1_000,
        new AbortController().signal
      )
    ).resolves.toEqual({ status: "fail", drift: [".husky/pre-push"] });

    await write(
      root,
      ".claude/settings.json",
      '{"enabledPlugins":{"lisa@lisa":true}}\n'
    );
    await write(
      root,
      ".claude/.lisa-plugins-synced",
      `${getPackageVersion()}\n`
    );
    await expect(
      inspectPlugins(
        root,
        { harness: "claude" },
        [],
        async () => [],
        1_000,
        new AbortController().signal
      )
    ).resolves.toEqual({ status: "fail", drift: ["lisa@lisa"] });
  });

  it("compares material ruleset state and normalizes dropped checks", async () => {
    const base: HealthRuleset = {
      name: "base",
      target: "branch",
      enforcement: "active",
      conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
      rules: [{ type: "deletion" }],
    };
    expect(
      compareRulesets([base], [{ ...base, enforcement: "disabled" }])
    ).toEqual({ missing: [], drifted: ["base"] });
    expect(
      compareRulesets(
        [base],
        [{ ...base, conditions: { ref_name: { include: ["main"] } } }]
      )
    ).toEqual({ missing: [], drifted: ["base"] });

    const reviewRule: HealthRuleset = {
      ...base,
      rules: [
        {
          type: "pull_request",
          parameters: { required_approving_review_count: 1 },
        },
      ],
    };
    expect(
      compareRulesets(
        [reviewRule],
        [
          {
            ...reviewRule,
            rules: [
              {
                type: "pull_request",
                parameters: {
                  required_approving_review_count: 1,
                  required_reviewers: [],
                },
              },
            ],
          },
        ]
      )
    ).toEqual({ missing: [], drifted: [] });
    expect(
      compareRulesets(
        [reviewRule],
        [
          {
            ...reviewRule,
            rules: [
              {
                type: "pull_request",
                parameters: {
                  required_approving_review_count: 1,
                  required_reviewers: [{ type: "Team", id: 7 }],
                },
              },
            ],
          },
        ]
      )
    ).toEqual({ missing: [], drifted: ["base"] });

    const lisaRoot = await temporaryRoot("lisa-health-ruleset-source-");
    const projectRoot = await temporaryRoot("lisa-health-ruleset-host-");
    await write(
      lisaRoot,
      "all/github-rulesets/base.json",
      `${JSON.stringify({
        ...base,
        rules: [
          { type: "deletion" },
          {
            type: "required_status_checks",
            parameters: {
              required_status_checks: [
                { context: "CI", integration_id: 15_368 },
                { context: "Optional", integration_id: 1 },
              ],
            },
          },
        ],
      })}\n`
    );
    const [normalized] = await expectedRulesets(lisaRoot, projectRoot, [], {
      github: { rulesets: { dropRequiredChecks: ["Optional"] } },
    });
    expect(normalized?.rules).toEqual([{ type: "deletion" }]);
  });

  // #2485: a repository-specific required check is declared per repo rather
  // than in a shared template. The health inspector has to honor the same
  // opt-in the applier does, or it reports the ruleset it just wrote as
  // "drifted" — a false red that teaches operators to ignore the check.
  it("expects per-repo addRequiredChecks the way the applier writes them", async () => {
    const lisaRoot = await temporaryRoot("lisa-health-ruleset-add-source-");
    const projectRoot = await temporaryRoot("lisa-health-ruleset-add-host-");
    await write(
      lisaRoot,
      "all/github-rulesets/base.json",
      `${JSON.stringify({
        name: "base",
        target: "branch",
        enforcement: "active",
        rules: [
          {
            type: "required_status_checks",
            parameters: {
              required_status_checks: [
                { context: "CI", integration_id: 15_368 },
              ],
            },
          },
        ],
      })}\n`
    );
    await write(projectRoot, ".github/workflows/ci.yml", "on: push\n");

    const [withAddition] = await expectedRulesets(lisaRoot, projectRoot, [], {
      github: {
        rulesets: {
          addRequiredChecks: {
            base: [{ context: "🧩 Repo Only", integration_id: 15_368 }],
          },
        },
      },
    });
    expect(
      withAddition?.rules?.[0]?.parameters?.required_status_checks
    ).toEqual([
      { context: "CI", integration_id: 15_368 },
      { context: "🧩 Repo Only", integration_id: 15_368 },
    ]);

    // Named for a different ruleset, it must not leak into this one.
    const [unrelated] = await expectedRulesets(lisaRoot, projectRoot, [], {
      github: {
        rulesets: {
          addRequiredChecks: {
            "quality checks": [{ context: "🧩 Elsewhere" }],
          },
        },
      },
    });
    expect(unrelated?.rules?.[0]?.parameters?.required_status_checks).toEqual([
      { context: "CI", integration_id: 15_368 },
    ]);
  });

  it("expects required run gates in the quality ruleset", async () => {
    const projectRoot = await temporaryRoot("lisa-health-run-gates-host-");
    await write(projectRoot, ".github/workflows/ci.yml", "on: push\n");

    const rulesets = await expectedRulesets(
      REPO_ROOT,
      projectRoot,
      ["typescript"],
      {
        gates: {
          "environment-reset": { "pull-request": "required" },
          "environment-reseed": { "pull-request": "required" },
          "credential-leakage": {
            "pull-request": {
              level: "required",
              await: "Vendor Security",
              posted_by: 123,
            },
          },
        },
      }
    );
    const quality = rulesets.find(item => item.name === "quality checks");
    const base = rulesets.find(item => item.name === "base");
    const contexts = (ruleset: HealthRuleset | undefined) =>
      (ruleset?.rules ?? []).flatMap(rule =>
        rule.type === "required_status_checks"
          ? (
              (rule.parameters?.required_status_checks ?? []) as {
                context: string;
              }[]
            ).map(check => check.context)
          : []
      );

    expect(contexts(quality)).toEqual(
      expect.arrayContaining([
        "🔍 Quality Checks / ♻️ Environment Reset Guard",
        "🔍 Quality Checks / 🌱 Environment Reseed Guard",
      ])
    );
    expect(contexts(quality)).not.toContain("Vendor Security");
    expect(contexts(base)).toContain("Vendor Security");
  });

  it("names unenforced required checks and tolerates host-added checks", async () => {
    const expected: HealthRuleset = {
      name: "quality checks",
      target: "branch",
      enforcement: "active",
      conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
      rules: [
        {
          type: "required_status_checks",
          parameters: {
            required_status_checks: [
              {
                context: "🔍 Quality Checks / 🧹 Lint",
                integration_id: 15_368,
              },
              {
                context: "🔍 Quality Checks / 🔗 Work-Item Traceability",
                integration_id: 15_368,
              },
            ],
          },
        },
      ],
    };
    const actualWithHostAddition: HealthRuleset = {
      ...expected,
      rules: [
        {
          type: "required_status_checks",
          parameters: {
            required_status_checks: [
              {
                context: "🔍 Quality Checks / 🧹 Lint",
                integration_id: 15_368,
              },
              {
                context: "🧭 E2E Route Coverage",
                integration_id: 15_368,
              },
            ],
          },
        },
      ],
    };

    expect(compareRulesets([expected], [actualWithHostAddition])).toEqual({
      missing: [],
      drifted: ["quality checks"],
    });

    const lisaRoot = await temporaryRoot("lisa-health-ruleset-names-source-");
    const projectRoot = await temporaryRoot("lisa-health-ruleset-names-host-");
    await write(
      lisaRoot,
      "typescript/github-rulesets/quality-checks.json",
      `${JSON.stringify(expected)}\n`
    );
    await write(projectRoot, ".github/workflows/ci.yml", "on: push\n");

    const finding = await rulesetFinding(
      lisaRoot,
      projectRoot,
      ["typescript"],
      { github: { org: "acme", repo: "app" } },
      async () => [actualWithHostAddition],
      1_000,
      new AbortController().signal
    );
    expect(finding.status).toBe("fail");
    expect(finding.reason).toContain("quality checks drifted");
    expect(finding.reason).toContain("runs without blocking");
    expect(finding.reason).toContain(
      "🔍 Quality Checks / 🔗 Work-Item Traceability"
    );
    expect(finding.reason).not.toContain("🧭 E2E Route Coverage");
  });

  it("reports missing rulesets with their unenforced required checks", async () => {
    const lisaRoot = await temporaryRoot("lisa-health-ruleset-missing-source-");
    const projectRoot = await temporaryRoot(
      "lisa-health-ruleset-missing-host-"
    );
    await write(
      lisaRoot,
      "expo/github-rulesets/nightly-e2e-health.json",
      `${JSON.stringify({
        name: "nightly e2e health",
        target: "branch",
        enforcement: "active",
        rules: [
          {
            type: "required_status_checks",
            parameters: {
              required_status_checks: [
                {
                  context: "🌙 Nightly E2E Health / 🌙 Gate",
                  integration_id: 15_368,
                },
              ],
            },
          },
        ],
      })}\n`
    );
    await write(projectRoot, ".github/workflows/ci.yml", "on: push\n");

    const finding = await rulesetFinding(
      lisaRoot,
      projectRoot,
      ["expo"],
      { github: { org: "acme", repo: "app" } },
      async () => [],
      1_000,
      new AbortController().signal
    );

    expect(finding.status).toBe("fail");
    expect(finding.reason).toContain("nightly e2e health missing");
    expect(finding.reason).toContain("🌙 Nightly E2E Health / 🌙 Gate");
    expect(finding.reason).toContain("runs without blocking");
  });
});
/* eslint-enable jsdoc/require-jsdoc, sonarjs/no-duplicate-string, max-lines -- restore repository test defaults */

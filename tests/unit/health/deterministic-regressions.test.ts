/* eslint-disable jsdoc/require-jsdoc, sonarjs/no-duplicate-string, max-lines -- security and parity fixtures stay colocated */
import { execFileSync } from "node:child_process";
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
  type HealthRuleset,
} from "../../../src/health/ruleset-inspection.js";
import {
  inspectManagedTemplates,
  inspectWorkflowInputs,
} from "../../../src/health/template-inspection.js";
import { mergeTemplateJson } from "../../../src/strategies/merge.js";
import { TaggedMergeStrategy } from "../../../src/strategies/tagged-merge.js";

const temporaryRoots: string[] = [];
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
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- fixed POSIX fixture command
      execFileSync("mkfifo", [internalFifo]);
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- fixed POSIX fixture command
      execFileSync("mkfifo", [externalFifo]);

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
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- fixed POSIX fixture command
      execFileSync("mkfifo", [path.join(root, "package.json")]);
      const started = Date.now();
      const result = await runDeterministicHealth(root, {
        lisaRoot: process.cwd(),
        deadlineMs: 25,
        readRulesets: async () => new Promise(() => undefined),
        readHooksPath: async () => new Promise(() => undefined),
        readInstalledPlugins: async () => new Promise(() => undefined),
      });

      expect(Date.now() - started).toBeLessThan(1_000);
      expect(result.findings).toHaveLength(12);
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
});
/* eslint-enable jsdoc/require-jsdoc, sonarjs/no-duplicate-string, max-lines -- restore repository test defaults */

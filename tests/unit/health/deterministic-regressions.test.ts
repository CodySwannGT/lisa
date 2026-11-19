/**
 * Deterministic Health regressions: subprocess/FIFO safety and the workflow,
 * managed-template, and installed-state inspectors.
 * @module tests/unit/health/deterministic-regressions.test
 */
import { chmod, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
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
  inspectManagedTemplates,
  inspectWorkflowInputs,
} from "../../../src/health/template-inspection.js";
import { mergeTemplateJson } from "../../../src/strategies/merge.js";
import { TaggedMergeStrategy } from "../../../src/strategies/tagged-merge.js";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { write } from "./deterministic-regressions-fixtures.js";

/** The project file the FIFO cases replace with a blocking special file. */
const PACKAGE_JSON = "package.json";
/** Error every unsafe project-file read must raise. */
const UNSAFE_PROJECT_FILE = "Unsafe health project file";
/** Lisa-side create-only caller path for the workflow-input cases. */
const CREATE_ONLY_CALLER =
  "typescript/create-only/.github/workflows/caller.yml";
/** Host-side caller path for the workflow-input cases. */
const HOST_CALLER = ".github/workflows/caller.yml";
/** Lisa-side reusable workflow the callers invoke. */
const REUSABLE_WORKFLOW = ".github/workflows/reusable.yml";
/** Reusable workflow contract declaring a single current boolean input. */
const REUSABLE_CONTRACT =
  "on:\n  workflow_call:\n    inputs:\n      current_input:\n        type: boolean\n";
/** Host file the copy-contents managed-block case manages. */
const GITIGNORE = ".gitignore";
/** Host file the merge/tagged-merge composition case manages. */
const SETTINGS_JSON = "settings.json";
/** Every Husky hook Lisa installs for a TypeScript project. */
const HUSKY_HOOKS = [
  "commit-msg",
  "post-checkout",
  "pre-commit",
  "pre-push",
  "prepare-commit-msg",
] as const;

const temporaryRoots: string[] = [];

/**
 * Create a canonical temporary root that the suite removes after each test.
 * @param prefix - Directory name prefix
 * @returns Canonical (symlink-resolved) temporary root
 */
async function temporaryRoot(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  temporaryRoots.push(root);
  return root;
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
      const internalFifo = path.join(root, PACKAGE_JSON);
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
      await expect(readProjectFile(root, PACKAGE_JSON)).rejects.toThrow(
        UNSAFE_PROJECT_FILE
      );
      await rm(internalFifo);
      await symlink(externalFifo, internalFifo);
      await expect(readProjectFile(root, PACKAGE_JSON)).rejects.toThrow(
        UNSAFE_PROJECT_FILE
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
        args: [path.join(root, PACKAGE_JSON)],
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
    await write(lisaRoot, CREATE_ONLY_CALLER, caller);
    await write(lisaRoot, REUSABLE_WORKFLOW, REUSABLE_CONTRACT);
    await write(projectRoot, HOST_CALLER, caller);

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
    await write(lisaRoot, CREATE_ONLY_CALLER, caller);
    await write(lisaRoot, REUSABLE_WORKFLOW, REUSABLE_CONTRACT);
    await write(projectRoot, HOST_CALLER, caller);

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
    await write(projectRoot, GITIGNORE, `custom/\n${block}`);
    await expect(
      inspectManagedTemplates(lisaRoot, projectRoot, [], "managed")
    ).resolves.toEqual([]);

    await write(
      projectRoot,
      GITIGNORE,
      "custom/\n# BEGIN: AI GUARDRAILS\nstale/\n# END: AI GUARDRAILS\n"
    );
    await expect(
      inspectManagedTemplates(lisaRoot, projectRoot, [], "managed")
    ).resolves.toEqual([GITIGNORE]);
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
    await write(projectRoot, SETTINGS_JSON, JSON.stringify(expected));

    await expect(
      inspectManagedTemplates(lisaRoot, projectRoot, ["typescript"], "managed")
    ).resolves.toEqual([]);

    await write(
      projectRoot,
      SETTINGS_JSON,
      JSON.stringify({ ...expected, governed: { enabled: false } })
    );
    await expect(
      inspectManagedTemplates(lisaRoot, projectRoot, ["typescript"], "managed")
    ).resolves.toEqual([SETTINGS_JSON]);
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
      '{"enabledPlugins":{"lisa@lisa":true,"lisa-wiki@lisa":true}}\n'
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
    ).resolves.toEqual({
      status: "fail",
      drift: ["lisa-wiki@lisa", "lisa@lisa"],
    });
  });
});

/**
 * Real common-template apply must materialize the complete authenticated updater graph.
 * Private Git snapshots provide local source authority, never hosted release or provider proof.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Lisa, type LisaDependencies } from "../../src/core/lisa.js";
import { NoOpGitService } from "../../src/core/git-service.js";
import { AutoAcceptPrompter } from "../../src/cli/prompts.js";
import { DetectorRegistry } from "../../src/detection/index.js";
import { SilentLogger } from "../../src/logging/silent-logger.js";
import { MigrationRegistry } from "../../src/migrations/index.js";
import { StrategyRegistry } from "../../src/strategies/index.js";
import { BackupService } from "../../src/transaction/index.js";
import { cleanupTempDir, createTempDir } from "../helpers/test-utils.js";
import {
  boundedSpawnSync,
  ioLatencyBudgetMs,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import {
  managedTemplateMembers,
  CLASSIFIER_MEMBERS,
} from "../../all/copy-overwrite/scripts/lib/npm-update-helper-inventory.mjs";

useIoLatencyBudget();
const PACKAGE_MANIFEST = "package.json";
const owner = vi.hoisted(() => ({ root: "" }));
vi.mock(
  "../../all/copy-overwrite/scripts/lib/npm-update-npm.mjs",
  async original => ({
    ...(await original<
      typeof import("../../all/copy-overwrite/scripts/lib/npm-update-npm.mjs")
    >()),
    findLisaPackageOwner: () => ({
      root: owner.root,
      metadata: JSON.parse(
        readFileSync(join(owner.root, PACKAGE_MANIFEST), "utf8")
      ),
    }),
  })
);
import { qualifiedControllerGraph } from "../../all/copy-overwrite/scripts/lib/npm-update-helper.mjs";

const ENTRIES = ["lisa-work-item.mjs", "lib/npm-update-execution-adapter.mjs"];
const NEWLY_COMMON = [
  "lisa-clean-git-env.sh",
  "lisa-scratch-run.sh",
  "check-threshold-ratchet.mjs",
  "threshold-ratchet-families.mjs",
  "threshold-ratchet-compare.mjs",
  "lisa-mutation.sh",
];

/**
 * Execute real bounded Git only inside this fixture's source authority.
 * @param args - Literal Git arguments.
 * @returns Captured successful Git output.
 */
function git(args: string[]): string {
  const result = boundedSpawnSync({
    command: "git",
    args,
    cwd: owner.root,
    label: "owned helper authority Git",
    baseMs: 10_000,
    maxBuffer: 1_048_576,
  });
  expect(result.status).toBe(0);
  return String(result.stdout).trim();
}

describe("all-only npm host controller materialization", () => {
  let root: string, cwd: string;
  let config: { automationProvenance: { signerDigest: string } };
  beforeEach(async () => {
    root = realpathSync(await createTempDir());
    owner.root = join(root, "authority");
    cwd = join(root, "host");
    mkdirSync(owner.root);
    mkdirSync(cwd);
    for (const file of [
      ...managedTemplateMembers().values(),
      ...CLASSIFIER_MEMBERS,
    ]) {
      const target = join(owner.root, file);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(file, target);
    }
    writeFileSync(
      join(owner.root, PACKAGE_MANIFEST),
      JSON.stringify({ name: "@codyswann/lisa", version: "1.0.0" })
    );
    writeFileSync(
      join(cwd, PACKAGE_MANIFEST),
      JSON.stringify({ name: "anonymous-npm-host", version: "1.0.0" })
    );
    git(["init"]);
    git(["add", "."]);
    git([
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "-m",
      "Fixture source authority",
    ]);
    config = {
      automationProvenance: { signerDigest: git(["rev-parse", "HEAD"]) },
    };
    const logger = new SilentLogger();
    const deps: LisaDependencies = {
      logger,
      prompter: new AutoAcceptPrompter(),
      backupService: new BackupService(logger),
      detectorRegistry: new DetectorRegistry(),
      strategyRegistry: new StrategyRegistry(),
      gitService: new NoOpGitService(),
      migrationRegistry: new MigrationRegistry([]),
    };
    const result = await new Lisa(
      {
        lisaDir: owner.root,
        destDir: cwd,
        dryRun: false,
        yesMode: true,
        validateOnly: false,
        skipGitCheck: false,
        harness: "claude",
      },
      deps
    ).apply();
    expect(result.success, result.errors?.join("\n")).toBe(true);
  });
  afterEach(async () => {
    await cleanupTempDir(root);
  });

  it(
    "installs all six missing members and qualifies actual controller entries",
    async () => {
      const graph = await qualifiedControllerGraph(cwd, config, ENTRIES);
      for (const name of NEWLY_COMMON) {
        expect(readFileSync(join(cwd, "scripts", name))).toEqual(
          readFileSync(join(owner.root, managedTemplateMembers().get(name)!))
        );
      }
      for (const entry of ENTRIES)
        expect(graph).toHaveProperty(join(cwd, "scripts", entry));
      expect(managedTemplateMembers().size).toBe(96);
    },
    ioLatencyBudgetMs(30_000)
  );

  it.each(["absent", "mutated", "symlink"] as const)(
    "refuses a newly universal member that is %s before returning controller authority",
    async mode => {
      const target = join(cwd, "scripts/lisa-scratch-run.sh");
      const bytes = readFileSync(target);
      if (mode === "mutated")
        writeFileSync(
          target,
          Buffer.concat([bytes, Buffer.from("\n# altered\n")])
        );
      else {
        unlinkSync(target);
        if (mode === "symlink")
          symlinkSync(
            join(
              owner.root,
              managedTemplateMembers().get("lisa-scratch-run.sh")!
            ),
            target
          );
      }
      await expect(
        qualifiedControllerGraph(cwd, config, ENTRIES)
      ).rejects.toThrow();
    },
    ioLatencyBudgetMs(30_000)
  );
});

/**
 * The auto-update-PR-branches subsystem stays removed, for the whole fleet.
 *
 * The subsystem force-updated open PR branches using the workflow's own
 * `github.token`. GitHub will not start workflow runs from a push made with
 * that token, so a consumer's required contexts went **absent at head, not
 * red** — and absence is not failure, so nothing read as broken while the PR
 * simply never became mergeable. One consumer measured batches of 6, then 12,
 * then 23, then 18 jammed pull requests in a single day, one batch per merge
 * (CodySwannGT/lisa#3590, cross-referenced by #3580).
 *
 * ## Why deleting the template is not enough, and why this suite exists
 *
 * The caller shipped from a `create-only` tree, and `CreateOnlyStrategy` copies
 * with `COPYFILE_EXCL` and reports `skipped` on `EEXIST`. So it is
 * create-if-absent and never update:
 *
 *   - Dropping the template stops NEW creations only. A consumer that already
 *     carries the workflow keeps it forever, because create-only never revisits
 *     an existing file.
 *   - A consumer that deleted the workflow by hand got it back on the next
 *     install, for the same reason — absent means create.
 *
 * The removal therefore needs BOTH halves, and each half fails differently:
 * without the deletion entries an installed caller is orphaned but alive;
 * without the template drop an absent caller is resurrected. This suite asserts
 * both halves separately so neither can regress while the other covers for it.
 *
 * The two halves do not race, and the reason is worth stating exactly because
 * it is stronger than an ordering. `Lisa` pre-computes `pendingDeletions` from
 * every detected type's `deletions.json` before any strategy runs, and the
 * create-only strategy consults that set and SUPPRESSES creation for any path
 * in it. Measured here by mutation: with the template restored but the deletion
 * entries present, the apply still produces neither caller; with the entries
 * removed but the template restored, it produces both.
 *
 * So a deletion entry alone is sufficient, and dropping the template is
 * defence in depth rather than the load-bearing half. Both are asserted anyway
 * — the suppression set is an implementation detail of one strategy, and a
 * template that still ships is a caller one refactor away from returning.
 *
 * ## The data under test is the shipped data
 *
 * `typescript/deletions.json` and the real `typescript/create-only` workflow
 * tree are copied into the fixture verbatim rather than restated. A suite that
 * restated them would keep passing after somebody edited the file that actually
 * ships.
 * @module tests/integration/auto-update-pr-branches-removed
 */

import * as fs from "fs-extra";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AutoAcceptPrompter } from "../../src/cli/prompts.js";
import type { LisaConfig } from "../../src/core/config.js";
import { NoOpGitService } from "../../src/core/git-service.js";
import { Lisa, type LisaDependencies } from "../../src/core/lisa.js";
import { DetectorRegistry } from "../../src/detection/index.js";
import { SilentLogger } from "../../src/logging/silent-logger.js";
import { MigrationRegistry } from "../../src/migrations/index.js";
import { StrategyRegistry } from "../../src/strategies/index.js";
import { BackupService } from "../../src/transaction/index.js";
import {
  cleanupTempDir,
  createMockLisaDir,
  createTempDir,
  createTypeScriptProject,
} from "../helpers/test-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const WORKFLOWS = path.join(".github", "workflows");
const EMITTER = ".github/workflows/auto-update-pr-branches.yml";
const HANDLER = ".github/workflows/auto-update-pr-branches-dispatch.yml";

/** Both consumer-facing callers. Neither may ship, and both must be deleted. */
const CALLERS = [EMITTER, HANDLER] as const;

/**
 * The Lisa version the deletion entries did NOT ship in.
 *
 * The floor is a real constraint, not bookkeeping: a deletion entry only ever
 * reaches a consumer that processes it, so a consumer pinned at or below this
 * version never sees the removal and keeps the workflow no matter what this
 * repository contains. "Removed from Lisa" is therefore not "removed from the
 * fleet" until every consumer is above this line.
 *
 * Recorded as the LAST version without the entries rather than as a guessed
 * next version number, because the release that carries this commit is decided
 * by the release pipeline after merge and cannot be known while authoring it.
 * The check below stays true for every release after that one.
 */
const LAST_VERSION_WITHOUT_DELETIONS = "4.29.12";

/** The stack tree whose manifests ship these callers. */
const STACK = "typescript";

/** Absolute path to the shipped deletion manifest for that stack. */
const DELETIONS_PATH = path.join(REPO_ROOT, STACK, "deletions.json");

/** Absolute path to the shipped create-only workflow tree for that stack. */
const CREATE_ONLY_WORKFLOWS = path.join(
  REPO_ROOT,
  STACK,
  "create-only",
  ...WORKFLOWS.split(path.sep)
);

/**
 * Shipped stack manifest that drives consumer-side deletion.
 * @returns The manifest as shipped, with its `paths` list.
 */
const shippedDeletions = (): { readonly paths: readonly string[] } =>
  fs.readJsonSync(DELETIONS_PATH);

/**
 * Every workflow the stack's create-only tree ships.
 * @returns Bare file names in that tree, or an empty list when it is absent.
 */
const shippedCreateOnlyWorkflows = (): readonly string[] =>
  fs.existsSync(CREATE_ONLY_WORKFLOWS)
    ? fs.readdirSync(CREATE_ONLY_WORKFLOWS)
    : [];

describe("auto-update-pr-branches: the shipped manifests", () => {
  it("no longer ships either caller from the create-only tree", () => {
    // The absent-case floor. A tree that shipped nothing at all would satisfy
    // the two assertions below while proving nothing, so the denominator is
    // asserted before anything is derived from it.
    const shipped = shippedCreateOnlyWorkflows();
    expect(shipped.length).toBeGreaterThan(0);

    expect(shipped).not.toContain("auto-update-pr-branches.yml");
    expect(shipped).not.toContain("auto-update-pr-branches-dispatch.yml");
  });

  it("lists both callers for deletion, so an installed one is removed not orphaned", () => {
    // Dropping the template alone leaves every already-installed consumer with
    // a live emitter. These two entries are the only thing that reaches them.
    const { paths } = shippedDeletions();
    for (const caller of CALLERS) {
      expect(paths, `${caller} must be deleted from consumers`).toContain(
        caller
      );
    }
  });

  it("keeps the removal above a stated version floor", () => {
    // Not a tautology: it pins the claim that consumers at or below this
    // version are NOT covered, which is the difference between "removed from
    // Lisa" and "removed from the fleet".
    const { version } = fs.readJsonSync(
      path.join(REPO_ROOT, "package.json")
    ) as { version: string };
    // Compared component-wise rather than by packing the parts into one
    // integer: any packing picks a radix, and a patch number that reaches it
    // silently carries into the minor and inverts the comparison.
    const asParts = (v: string): readonly number[] =>
      v.split(".").map(part => Number.parseInt(part, 10));
    const compare = (
      left: readonly number[],
      right: readonly number[]
    ): number => {
      const width = Math.max(left.length, right.length);
      for (let index = 0; index < width; index += 1) {
        const difference = (left[index] ?? 0) - (right[index] ?? 0);
        if (difference !== 0) return difference;
      }
      return 0;
    };

    expect(
      compare(asParts(version), asParts(LAST_VERSION_WITHOUT_DELETIONS)),
      `the entries ship above ${LAST_VERSION_WITHOUT_DELETIONS}; consumers ` +
        `pinned at or below it never receive the deletion`
    ).toBeGreaterThanOrEqual(0);
  });
});

describe("auto-update-pr-branches: what an apply does to a consumer", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");
    await createMockLisaDir(lisaDir);
    await createTypeScriptProject(destDir);

    // Replace the mock stack manifest and workflow tree with the ones this
    // repository actually ships. Restating them here would let the shipped
    // files drift while this suite stayed green.
    await fs.copy(DELETIONS_PATH, path.join(lisaDir, STACK, "deletions.json"), {
      overwrite: true,
    });
    await fs.copy(
      CREATE_ONLY_WORKFLOWS,
      path.join(lisaDir, STACK, "create-only", ...WORKFLOWS.split(path.sep)),
      { overwrite: true }
    );
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Build a Lisa instance pointed at the temp project.
   * @returns Lisa instance ready to apply.
   */
  const createLisa = (): Lisa => {
    const config: LisaConfig = {
      lisaDir,
      destDir,
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      skipGitCheck: true,
      harness: "claude",
    };
    const deps: LisaDependencies = {
      logger: new SilentLogger(),
      prompter: new AutoAcceptPrompter(),
      backupService: new BackupService(new SilentLogger()),
      detectorRegistry: new DetectorRegistry(),
      strategyRegistry: new StrategyRegistry(),
      gitService: new NoOpGitService(),
      migrationRegistry: new MigrationRegistry(),
    };
    return new Lisa(config, deps);
  };

  it("removes both callers from a consumer that already carries them", async () => {
    // The already-installed consumer: create-only never revisits an existing
    // file, so only the deletion manifest can reach this repository.
    await fs.ensureDir(path.join(destDir, WORKFLOWS));
    for (const caller of CALLERS) {
      await fs.writeFile(
        path.join(destDir, ...caller.split("/")),
        "name: Auto-update PR branches\non:\n  push:\n    branches: [main]\n"
      );
      expect(
        await fs.pathExists(path.join(destDir, ...caller.split("/")))
      ).toBe(true);
    }

    const result = await createLisa().apply();

    expect(result.success).toBe(true);
    for (const caller of CALLERS) {
      expect(
        await fs.pathExists(path.join(destDir, ...caller.split("/"))),
        `${caller} must be deleted from an installed consumer`
      ).toBe(false);
    }
  });

  it("does not recreate either caller in a consumer that has neither", async () => {
    // The consumer that already deleted them by hand. Against the pre-fix tree
    // — template shipping, no deletion entry — this case FAILS: create-only
    // reads "absent" as "create" and hands the workflow straight back on the
    // next install. It is the deletion entry that suppresses that, so this
    // assertion is measuring the entry, not the template drop.
    for (const caller of CALLERS) {
      expect(
        await fs.pathExists(path.join(destDir, ...caller.split("/")))
      ).toBe(false);
    }

    const result = await createLisa().apply();

    expect(result.success).toBe(true);
    for (const caller of CALLERS) {
      expect(
        await fs.pathExists(path.join(destDir, ...caller.split("/"))),
        `${caller} must not be recreated`
      ).toBe(false);
    }
  });
});

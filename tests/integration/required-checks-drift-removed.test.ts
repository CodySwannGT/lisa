/**
 * The required-checks remote drift arm stays removed, for the whole fleet.
 *
 * The arm read a repository's LIVE ruleset over the GitHub API and compared it
 * to the snapshot committed in `.github/required-checks.json`. Reading a
 * ruleset needs `administration:read`, which the default workflow token does
 * not carry — so every consumer that seeded the workflow held a personal access
 * token in a permanent repository secret. The exposure was continuous and
 * fleet-wide; the drift it detected is rare. That trade was reversed by owner
 * decision (CodySwannGT/lisa#3599).
 *
 * ## What this suite is asserting, and what it deliberately is not
 *
 * It asserts a CREDENTIAL is gone, not that one file name is gone. A cheaper
 * detector under a different name would fail these cases too, which is the
 * point: the accepted trade is that a snapshot drifting from a live ruleset is
 * now discovered by consequence rather than by check, and "but we could detect
 * it more cheaply by…" is out of scope by ruling.
 *
 * It does NOT assert anything about the offline arms. `vacuous_required_check`
 * and `unproven_required_check` need no token and no network, run on the
 * pull-request path, and are explicitly preserved — their behaviour is pinned
 * in `tests/unit/scripts/skipped-required-checks-wiring.test.ts`, including the
 * two cases that prove removing an expiry did not become removing a refusal.
 *
 * ## Why deleting the template is not enough
 *
 * The workflow shipped from a `create-only` tree, and `CreateOnlyStrategy`
 * copies with `COPYFILE_EXCL` and reports `skipped` on `EEXIST`. So it is
 * create-if-absent and never update: dropping the template stops NEW seedings
 * only, and a consumer that already carries the workflow keeps it — and keeps
 * the secret — forever. A consumer that deleted it by hand would get it back on
 * the next install, for the same reason.
 *
 * `typescript/deletions.json` is what reaches those repositories. Measured on
 * the preceding removal and re-asserted below: `Lisa` pre-computes
 * `pendingDeletions` across every detected type before any strategy runs, and
 * create-only consults that set and SUPPRESSES creation for any path in it. So
 * the deletion entry alone is sufficient and the template drop is defence in
 * depth. Both are kept and both are asserted.
 *
 * ## What this change cannot do
 *
 * Deleting a workflow does not delete a repository secret. The token behind it
 * must be revoked by each consumer's account owner. Nothing in Lisa can reach
 * it, and no assertion here should be read as claiming otherwise.
 *
 * A consumer that EDITED the seeded workflow — it is create-only, therefore
 * theirs — is deleted out from under them anyway, deliberately. An edited copy
 * still asks for `administration:read`, and the credential is the whole reason
 * for the removal.
 * @module tests/integration/required-checks-drift-removed
 */

import * as fs from "fs-extra";
import * as os from "node:os";
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
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";

/**
 * Today, as an ISO date, for a declaration stamp under test.
 * @returns The current date as `YYYY-MM-DD`.
 */
const today = (): string => new Date().toISOString().slice(0, 10);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const WORKFLOWS = path.join(".github", "workflows");
const DRIFT = ".github/workflows/required-checks-drift.yml";

/**
 * The Lisa version the deletion entry did NOT ship in.
 *
 * The floor is a real constraint, not bookkeeping: a deletion entry only ever
 * reaches a consumer that processes it, so a consumer pinned at or below this
 * version never sees the removal and keeps both the workflow and the standing
 * `administration:read` secret no matter what this repository contains.
 * "Removed from Lisa" is not "removed from the fleet" until every consumer is
 * above this line — and even then the secret itself survives, because deleting
 * a workflow does not delete a secret.
 *
 * Recorded as the LAST version without the entry rather than as a guessed next
 * version number, because the release carrying this commit is decided by the
 * release pipeline after merge and cannot be known while authoring it. The
 * comparison below is therefore `>=`, not `>`.
 */
const LAST_VERSION_WITHOUT_DELETION = "4.30.0";

/** The stack tree that shipped the workflow. */
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

/** The Lisa-managed guard script the removed workflow invoked. */
const GUARD_SCRIPT = path.join(
  REPO_ROOT,
  STACK,
  "copy-overwrite",
  "scripts",
  "check-skipped-required-checks.mjs"
);

/** The stack's package.json template. */
const PACKAGE_LISA = path.join(
  REPO_ROOT,
  STACK,
  "package-lisa",
  "package.lisa.json"
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

describe("required-checks drift arm: the shipped manifests", () => {
  it("no longer ships the scheduled workflow from the create-only tree", () => {
    // The absent-case floor. A tree that shipped nothing at all would satisfy
    // the assertion below while proving nothing, so the denominator is
    // asserted before anything is derived from it.
    const shipped = shippedCreateOnlyWorkflows();
    expect(shipped.length).toBeGreaterThan(0);

    expect(shipped).not.toContain("required-checks-drift.yml");
  });

  it("lists it for deletion, so an installed consumer is cleaned not orphaned", () => {
    // Dropping the template alone leaves every already-installed consumer with
    // a live weekly job and a live token. This entry is the only thing that
    // reaches them.
    const { paths } = shippedDeletions();
    expect(paths).toContain(DRIFT);
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
      compare(asParts(version), asParts(LAST_VERSION_WITHOUT_DELETION)),
      `the entry ships above ${LAST_VERSION_WITHOUT_DELETION}; consumers ` +
        `pinned at or below it never receive the deletion`
    ).toBeGreaterThanOrEqual(0);
  });

  it("retires the remote npm script and asks consumers to drop it", () => {
    // `force` stops shipping it; `remove` is what deletes it from a project
    // that already received it. Without the second half the script survives in
    // every consumer's package.json, invoking a flag nothing implements.
    const template = fs.readJsonSync(PACKAGE_LISA) as {
      force?: { scripts?: Record<string, string> };
      remove?: { scripts?: readonly string[] };
    };
    expect(Object.keys(template.force?.scripts ?? {})).not.toContain(
      "check:skipped-required-checks:remote"
    );
    expect(template.remove?.scripts).toContain(
      "check:skipped-required-checks:remote"
    );
  });
});

describe("required-checks drift arm: the guard script holds no remote path", () => {
  const source = (): string => fs.readFileSync(GUARD_SCRIPT, "utf8");

  it("exports neither the fetcher nor the comparator", async () => {
    const mod = (await import(`${GUARD_SCRIPT}?removed`)) as unknown as Record<
      string,
      unknown
    >;
    expect(mod.fetchLiveRequiredContexts).toBeUndefined();
    expect(mod.compareRulesetBaseline).toBeUndefined();
    expect(mod.SNAPSHOT_MAX_AGE_DAYS).toBeUndefined();
    expect(
      Object.values(mod.VIOLATIONS as Record<string, string>)
    ).not.toContain("ruleset_snapshot_drift");
  });

  it("names no ruleset-read token", () => {
    // A SCOPE is requested in a workflow's `permissions:` block, and the
    // create-only tree is asserted free of that in `quality-workflow.test.ts`.
    // A script cannot request one, so the script-side assertion is about the
    // secret it named and — below — about whether it still calls out. The
    // header still explains which scope the removed arm needed and why holding
    // it was the cost; an explanation is not a request, and deleting the
    // explanation is how the reasoning is lost and the arm gets rebuilt.
    expect(source()).not.toContain("RULESET_READ_TOKEN");
  });

  it("makes no network call under `--remote`, with `gh` unreachable", () => {
    // The behavioural form of "does not attempt any network call". `gh` is put
    // out of reach by emptying PATH, so any surviving ruleset read fails with
    // ENOENT and the run exits non-zero. Against the pre-fix script this case
    // FAILS: `--remote` reached `fetchLiveRequiredContexts`, which shells out
    // to `gh api repos/<repo>/rulesets/<id>` on exactly this declaration.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "drift-removed-"));
    try {
      fs.ensureDirSync(path.join(root, ".github", "workflows"));
      fs.writeFileSync(
        path.join(root, ".github", "workflows", "ci.yml"),
        "jobs:\n  quality:\n    with:\n      skip_jobs: ''\n"
      );
      fs.writeJsonSync(path.join(root, ".github", "required-checks.json"), {
        // Armed exactly as the removed weekly job required before it would run:
        // a repo, at least one ruleset id, and a stamped baseline.
        ruleset: { repo: "OWNER/NAME", ids: [1], baseline_fetched_at: today() },
        workflows: [".github/workflows/ci.yml"],
        required_contexts: [],
        skip_job_declarations: {},
      });

      const run = boundedSpawnSync({
        label: "check-skipped-required-checks.mjs --remote (no gh on PATH)",
        command: process.execPath,
        args: [GUARD_SCRIPT, root, "--remote"],
        env: { ...process.env, PATH: "" },
      });

      expect(run.stderr).not.toContain("ENOENT");
      expect(run.stdout).not.toContain("ruleset_snapshot_drift");
      expect(run.status).toBe(0);
    } finally {
      fs.removeSync(root);
    }
  });

  it("advertises no `--remote` command in anything it prints", () => {
    // The refusal used to end with "meanwhile `--remote` answers WITHOUT the
    // cache", which after this removal would point a reader at a command that
    // does not exist. A refusal that hands out a dead instruction is worse
    // than one that just says why it refused.
    expect(source()).not.toContain("--remote");
  });
});

describe("required-checks drift arm: what an apply does to a consumer", () => {
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

  it("removes the workflow from a consumer that already carries it", async () => {
    // The already-installed consumer: create-only never revisits an existing
    // file, so only the deletion manifest can reach this repository. The body
    // written here is an EDITED copy — a consumer's own changes do not earn it
    // a reprieve, because an edited copy still asks for administration:read.
    await fs.ensureDir(path.join(destDir, WORKFLOWS));
    await fs.writeFile(
      path.join(destDir, ...DRIFT.split("/")),
      "name: My edited drift check\non:\n  schedule:\n    - cron: '0 3 * * 2'\n"
    );
    expect(await fs.pathExists(path.join(destDir, ...DRIFT.split("/")))).toBe(
      true
    );

    const result = await createLisa().apply();

    expect(result.success).toBe(true);
    expect(
      await fs.pathExists(path.join(destDir, ...DRIFT.split("/"))),
      "the workflow must be deleted from an installed consumer"
    ).toBe(false);
  });

  it("does not recreate it in a consumer that has none", async () => {
    // The consumer that already deleted it by hand. Against the pre-fix tree —
    // template shipping, no deletion entry — this case FAILS: create-only
    // reads "absent" as "create" and hands the workflow straight back on the
    // next install. It is the deletion entry that suppresses that, so this
    // assertion measures the entry rather than the template drop.
    expect(await fs.pathExists(path.join(destDir, ...DRIFT.split("/")))).toBe(
      false
    );

    const result = await createLisa().apply();

    expect(result.success).toBe(true);
    expect(
      await fs.pathExists(path.join(destDir, ...DRIFT.split("/"))),
      "the workflow must not be recreated"
    ).toBe(false);
  });
});

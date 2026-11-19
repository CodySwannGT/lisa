/**
 * @file lisa-state.ts
 * @description Shared state and primitive helpers every Lisa apply layer reads. One layer of the `Lisa` orchestrator; each layer
 * extends the one below it so the apply pipeline reads as one class while no
 * single module carries the whole pipeline.
 * @module core
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import type { IPrompter } from "../cli/prompts.js";
import { DetectorRegistry } from "../detection/index.js";
import { isPostinstallSafeApply } from "./apply-mode.js";
import type { ILogger } from "../logging/index.js";
import { MigrationRegistry } from "../migrations/index.js";
import { StrategyRegistry } from "../strategies/index.js";
import type { IBackupService } from "../transaction/index.js";
import { type IgnorePatterns } from "../utils/ignore-patterns.js";
import type { LisaConfig, OperationCounters, ProjectType } from "./config.js";
import { createInitialCounters } from "./config.js";
import type { IGitService } from "./git-service.js";

/**
 * Log fragment used when a create-only instruction file already exists and is
 * therefore left untouched (the host owns it).
 */
export const HOST_OWNED_LABEL = "already present (host-owned)";
export const CREATE_ONLY_STRATEGY = "create-only" as const;
export const COPY_CONTENTS_STRATEGY = "copy-contents" as const;
export const PROJECT_LEARNINGS_TEMPLATE_PATH = path.join(
  ".lisa",
  "PROJECT_LEARNINGS.md"
);

/**
 * Dependencies for Lisa operations
 */
export interface LisaDependencies {
  readonly logger: ILogger;
  readonly prompter: IPrompter;
  readonly backupService: IBackupService;
  readonly detectorRegistry: DetectorRegistry;
  readonly strategyRegistry: StrategyRegistry;
  readonly gitService: IGitService;
  readonly migrationRegistry: MigrationRegistry;
}

/**
 * Command boundary used for Claude CLI plugin registration.
 */
export type PluginExecAsync = (
  cmd: string,
  opts: Record<string, unknown>
) => Promise<unknown>;
/** Generic fallback when a plugin command has no readable error. */
export const PLUGIN_COMMAND_FAILED = "command failed";

/**
 * Shared state and primitive helpers every Lisa apply layer reads.
 */
export abstract class LisaState {
  protected counters: OperationCounters = createInitialCounters();

  /**
   * Managed files this apply found out of date but could not update.
   *
   * Named so the summary can list them: a count alone tells an operator that
   * something did not land without telling them what, which is most of the way
   * back to the silence this exists to end.
   */
  protected readonly stalePaths: string[] = [];
  /**
   * Lisa-owned artifacts this apply deliberately did not replace, each with the
   * reason spelled out for whoever reads the output.
   *
   * Full sentences rather than paths, because this is the one outcome an
   * operator cannot act on from the filename: "we left yours alone because it
   * defends something ours does not" is the entire message.
   */
  protected readonly hostAheadNotes: string[] = [];
  /**
   * Templates this apply declined to write because they would have outranked
   * configuration the project already maintains, each with the reason.
   *
   * Full sentences for the same reason as {@link hostAheadNotes}: the filename
   * alone cannot convey it. The absent file is the *correct* outcome here, so
   * without the sentence an operator has nothing to distinguish "Lisa
   * deliberately stood down" from "the template never arrived".
   */
  protected readonly shadowedNotes: string[] = [];
  /**
   * Every path this apply removed, and every workflow it refused to remove, as
   * operator-readable lines.
   *
   * Announced unconditionally — including the removals Lisa is entitled to
   * make. A destructive step nobody can see is half the defect in
   * CodySwannGT/lisa#3656: the deletions were correct-looking code doing exactly
   * what a manifest told them to, and the reason it cost a consumer three
   * workflows is that no human ever had the chance to disagree.
   *
   * Deliberately wider than the ownership gate. The gate is scoped to
   * `.github/workflows/` because a workflow's absence produces no signal
   * anywhere, but the manifests declare 255 paths and 213 of them are not
   * workflows — `.claude` trees, root-level `eslint-plugin-*` directories,
   * jest/vitest/tsconfig files — every one removed recursively by destination
   * path with the content never consulted. Announcing costs nothing and can
   * break no legitimate deletion, so there is no reason for those 213 to keep
   * going silently while this class of defect is being fixed.
   */
  protected readonly deletionNotices: string[] = [];
  /**
   * Repo-relative paths this apply actually removed, workflow or not.
   *
   * The console copy of this list is the one an operator is meant to read, and
   * the one they demonstrably cannot. Two mechanisms guarantee it: a package
   * manager hides postinstall stdout, and the reconciliation trampoline is
   * spawned detached with `stdio: "ignore"` (`utils/postinstall-trampoline`) so
   * anything it writes is not merely easy to miss but PROVABLY unobservable.
   * An announcement that only exists on stdout is therefore not an
   * announcement. Persisting the list into the apply receipt is what survives
   * both, and follows `stale_paths` (#3033), added for the same reason.
   */
  protected readonly deletedPaths: string[] = [];
  protected detectedTypes: ProjectType[] = [];
  protected ignorePatterns: IgnorePatterns = {
    patterns: [],
    shouldIgnore: () => false,
  };
  /**
   * Paths marked for deletion by any detected project type's deletions.json.
   * Used to skip creating files that would just be deleted moments later (e.g.,
   * CDK inherits jest.* files from typescript but its own deletions.json removes
   * them — without this gate, Lisa creates then immediately deletes the files,
   * causing ENOENT races for any concurrent linter/file-watcher).
   */
  protected pendingDeletions: Set<string> = new Set();
  /**
   * Maps each relative path shipped by any type's `create-only/` tree to the
   * single type that "owns" it (most-specific wins). Computed once before
   * strategies run; consulted while processing `create-only` to suppress
   * parent-type sources for paths that a child type also ships.
   *
   * Motivating case: CDK projects detect as both `typescript` and `cdk`.
   * Both ship `.github/workflows/ci.yml` under their `create-only/` trees.
   * Without this map, typescript's bun-mode ci.yml runs first and creates
   * the file; cdk's npm-mode + determine_environment ci.yml then sees the
   * file already exists and is silently skipped — producing a CDK project
   * wired to use bun, which fails immediately in CI because CDK projects
   * have `engines.bun = "please-use-npm"` and only a `package-lock.json`.
   */
  protected createOnlyOwnership: Map<string, string> = new Map();
  /**
   * Maps each relative path shipped by any type's `copy-overwrite/` tree to the
   * single type that "owns" it (most-specific wins). Computed once before
   * strategies run; consulted while processing `copy-overwrite` to suppress
   * parent-type sources for paths that a child type also ships.
   *
   * Why this exists — crash safety: `copy-overwrite` always overwrites, so the
   * per-type outer loop in `processConfigurations` naturally lets the child win
   * by writing the parent's version first and then overwriting it. But that
   * leaves a window in which the destination holds the parent (typescript)
   * version of an overlapping path (e.g. `tsconfig.json`, `eslint.config.ts`)
   * before the child (expo/cdk/nestjs) phase overwrites it. If the process is
   * killed in that window — which is exactly what bun's lifecycle-script
   * handling did during postinstall — the project is left with TypeScript
   * configs clobbering the child stack's (Expo getting the typescript
   * `include` glob in tsconfig.json instead of its own).
   * That was the bug fixed by removing the postinstall apply in #318.
   *
   * Resolving ownership up front and writing each path exactly once (by its
   * most-specific type) eliminates the intermediate write entirely: a kill at
   * any point leaves either the pre-existing file or the correct final file,
   * never the parent-clobbered intermediate. This is the symmetric counterpart
   * to `createOnlyOwnership` (which exists for the opposite reason — create-only
   * skips existing files, so without help the parent would win).
   */
  protected copyOverwriteOwnership: Map<string, string> = new Map();
  /** Destination selected by the host project's projectRulesFile setting. */
  protected projectLearningsFile = PROJECT_LEARNINGS_TEMPLATE_PATH;
  /** Whether the canonical all/create-only learnings source is registered. */
  protected projectLearningsTemplateRegistered = false;
  /**
   * True when a populated legacy ledger exists and the new `.lisa/` destination
   * does not yet — the create-only strategy must NOT seed an empty ledger over
   * it, or the pending relocation would collide (both-exist no-clobber) and
   * strand the real entries at the raw-injected legacy path.
   */
  protected suppressLearningsSeedForRelocation = false;
  protected readonly separator = "========================================";
  protected readonly lisaignoreSuffix = "(.lisaignore)";

  /**
   * True when the destination is the Lisa source repo itself. A self-apply
   * skips deletions, template application, and postinstall injection while
   * still applying package.lisa.json dependency governance. See {@link isLisaSourceRepo}.
   */
  protected selfApply = false;

  /**
   * Initialize Lisa orchestrator
   * @param config - Configuration for the apply operation
   * @param deps - Injected service dependencies
   */
  constructor(
    protected readonly config: LisaConfig,
    protected readonly deps: LisaDependencies
  ) {}

  /**
   * Postinstall applies are intentionally narrow: they refresh governance
   * templates that must track dependency updates, but they must not regenerate
   * project-scoped agent surfaces. Agent trees are large, committed outputs and
   * are updated through an explicit `lisa apply` or cross-pollinate run. A
   * self-apply against the Lisa source repo also skips emit — those agent
   * surfaces are built from `plugins/src`, not regenerated by apply.
   * @returns True when the current apply should avoid agent-surface writes.
   */
  protected shouldSkipAgentEmitDuringPostinstall(): boolean {
    return isPostinstallSafeApply(this.config) || this.selfApply;
  }

  /**
   * Read a file's contents, returning null if the file does not exist or cannot be read.
   * Used for optional file checks that should not interrupt the main flow on failure.
   * @param filePath - Absolute path to the file to read
   * @returns File contents as a string, or null if unavailable
   */
  protected async tryReadFile(filePath: string): Promise<string | null> {
    try {
      return await readFile(filePath, "utf-8");
    } catch {
      return null;
    }
  }

  /**
   * Absolute path of the host project's package.json.
   * @returns package.json path under the destination directory
   */
  protected hostPackageJsonPath(): string {
    return path.join(this.config.destDir, "package.json");
  }
}

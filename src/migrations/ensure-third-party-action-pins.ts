import { readFile, readdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as fse from "fs-extra";
import {
  applyPins,
  distinctRefs,
  findUnpinnedRefs,
  type ResolvedPin,
  type UnpinnedRef,
} from "../core/third-party-action-pins.js";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

const WORKFLOW_DIR = path.join(".github", "workflows");
const WORKFLOW_FILE = /\.ya?ml$/;

/** Resolve the commit a ref points at, or null when it cannot be determined. */
export type ShaResolver = (
  owner: string,
  repo: string,
  ref: string
) => Promise<string | null>;

/** One workflow file and the mutable refs found in it. */
interface ScannedFile {
  readonly relative: string;
  readonly absolute: string;
  readonly source: string;
  readonly refs: readonly UnpinnedRef[];
}

/**
 * Ask GitHub what a ref resolves to right now.
 *
 * Deliberately resolves live rather than reading a table shipped inside Lisa.
 * A shipped table pins every consumer to whatever those refs meant on the night
 * it was generated, which converts a mutable-ref problem into a stale-ref
 * problem and calls it fixed. Resolving live also satisfies the harder half of
 * the requirement: the SHA written is the one THAT repository's ref resolves to
 * at migration time, so pinning never silently upgrades anything.
 *
 * Returns null rather than throwing on every failure path. The caller turns a
 * null into a reported skip; an exception here would turn a missing network
 * into a failed `lisa` run, which is not what an unreachable API means.
 *
 * Unauthenticated on purpose. Every action being resolved is public — a private
 * one could not be `uses:`-ed by a consumer's runner either — and the endpoint's
 * anonymous allowance is far above the handful of distinct refs one repository
 * has. Reading a token here would mean reaching into the environment from
 * `src/`, and buying a higher rate limit is not worth that: being rate-limited
 * lands on the same reported-skip path as being offline, which is a correct
 * outcome rather than a failure. A caller that wants authenticated lookups
 * injects its own resolver.
 * @param owner - Action owner
 * @param repo - Action repository
 * @param ref - The mutable ref to resolve
 * @returns The 40-character commit SHA, or null when it cannot be resolved
 */
export const resolveViaGitHub: ShaResolver = async (owner, repo, ref) => {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`,
      {
        headers: {
          Accept: "application/vnd.github.sha",
          "User-Agent": "lisa-third-party-action-pins",
        },
      }
    );
    if (!response.ok) {
      return null;
    }
    const sha = (await response.text()).trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
};

/**
 * Pin the third-party actions in an already-seeded consumer's workflows.
 *
 * #3585 pinned Lisa's own workflows and its `create-only` templates. Those
 * templates are seeded once and never overwritten, so that fix reaches new
 * adoptions and no repository that already exists. This migration is the
 * surface that reaches the installed base — the same role, and the same
 * reasoning, as `ensure-nightly-e2e-workflow-pins` (#3476, #3485, #3588).
 *
 * It rewrites matched `uses:` lines only, never the file, so a host that has
 * edited its seeded workflow keeps every other edit.
 */
export class EnsureThirdPartyActionPinsMigration implements Migration {
  readonly name = "ensure-third-party-action-pins";
  readonly description =
    "Pin third-party GitHub Actions in this project's workflows to the commit SHA their ref resolves to today";

  /**
   * Create the migration.
   * @param resolve - SHA resolver, injectable so tests never touch the network
   */
  constructor(private readonly resolve: ShaResolver = resolveViaGitHub) {}

  /**
   * Whether any workflow in this project carries a mutable third-party ref.
   *
   * Never touches the network: an offline machine must still get a truthful
   * answer about whether there is anything to do.
   * @param ctx - Migration context
   * @returns True when at least one reference needs pinning
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    return (await this.scan(ctx.projectDir)).length > 0;
  }

  /**
   * Resolve every mutable ref and rewrite the ones that resolved.
   * @param ctx - Migration context
   * @returns Applied, skipped, or no-op result
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const scanned = await this.scan(ctx.projectDir);
    if (scanned.length === 0) {
      return { name: this.name, action: "noop" };
    }
    const found = scanned.flatMap(file => file.refs);
    if (ctx.postinstallSafe === true) {
      return this.refuse(ctx, found);
    }

    const pins = await this.resolveAll(found);
    if (pins.length === 0) {
      return this.declineUnresolved(ctx, found);
    }

    const updates = scanned
      .map(file => ({ file, source: applyPins(file.source, pins) }))
      .filter(update => update.source !== update.file.source);
    if (updates.length === 0) {
      return { name: this.name, action: "noop" };
    }

    const changedFiles = updates.map(update => update.file.relative);
    const message = this.summarize(pins, found, changedFiles);
    if (ctx.dryRun) {
      ctx.logger.dry(
        `Would pin ${pins.length} reference(s) in ${changedFiles.join(", ")}`
      );
      return { name: this.name, action: "applied", changedFiles, message };
    }
    for (const update of updates) {
      await writeFile(update.file.absolute, update.source);
    }
    ctx.logger.success(message);
    return { name: this.name, action: "applied", changedFiles, message };
  }

  /**
   * Read every workflow file and collect its mutable third-party refs.
   * @param projectDir - Destination project directory
   * @returns One entry per workflow file that has at least one finding
   */
  private async scan(projectDir: string): Promise<readonly ScannedFile[]> {
    const dir = path.join(projectDir, WORKFLOW_DIR);
    if (!(await fse.pathExists(dir))) {
      return [];
    }
    const names = (await readdir(dir)).filter(name => WORKFLOW_FILE.test(name));
    const files = await Promise.all(
      names.map(async name => {
        const absolute = path.join(dir, name);
        const source = await readFile(absolute, "utf8");
        return {
          relative: path.join(WORKFLOW_DIR, name),
          absolute,
          source,
          refs: findUnpinnedRefs(source),
        };
      })
    );
    return files.filter(file => file.refs.length > 0);
  }

  /**
   * Resolve each distinct reference, dropping the ones that do not resolve.
   * @param found - Every finding across the scanned files
   * @returns The references that resolved to a commit SHA
   */
  private async resolveAll(
    found: readonly UnpinnedRef[]
  ): Promise<readonly ResolvedPin[]> {
    const resolutions = await Promise.all(
      distinctRefs(found).map(async ref => ({
        ref,
        sha: await this.resolve(ref.owner, ref.repo, ref.ref),
      }))
    );
    return resolutions.flatMap(({ ref, sha }) =>
      sha === null ? [] : [{ action: ref.action, ref: ref.ref, sha }]
    );
  }

  /**
   * Decline during a package manager's install, and say what was declined.
   *
   * A workflow file is not a generated artifact — it is a reviewed,
   * checked-in declaration of what runs against this repository, and nobody
   * types `bun install` meaning to change that. The same rule, and the same
   * incident behind it, as `ensure-seeded-gates` (#3574).
   *
   * It reports rather than going quiet, because a migration that silently
   * skipped here would be this codebase's signature defect: work that stops
   * happening with nothing anywhere saying so.
   * @param ctx - Migration context
   * @param found - Every finding across the scanned files
   * @returns A skipped result carrying the operator-readable explanation
   */
  private refuse(
    ctx: MigrationContext,
    found: readonly UnpinnedRef[]
  ): MigrationResult {
    const message = [
      "Left this project's workflows unchanged: an install must not rewrite what runs against this repository.",
      "",
      `  ${found.length} third-party action reference(s) resolve at job start to whatever their owner has pushed:`,
      "",
      ...this.describe(found),
      "",
      "  To pin them deliberately, so the change lands in a commit somebody reviews:",
      "",
      "      npx @codyswann/lisa@latest .",
    ].join("\n");
    ctx.logger.warn(message);
    return { name: this.name, action: "skipped", changedFiles: [], message };
  }

  /**
   * Report that nothing could be resolved, without claiming to have applied.
   *
   * No network and no credentials are ordinary conditions on a developer
   * machine, so neither is a failure. What matters is that the result says
   * `skipped`: a migration that reported `applied` here would be recorded as
   * done and never run again, leaving the references mutable forever.
   * @param ctx - Migration context
   * @param found - Every finding across the scanned files
   * @returns A skipped result carrying the operator-readable explanation
   */
  private declineUnresolved(
    ctx: MigrationContext,
    found: readonly UnpinnedRef[]
  ): MigrationResult {
    const message = [
      "Could not reach GitHub to look up what these action references point at, so nothing was changed.",
      "",
      `  ${found.length} third-party action reference(s) are still resolved at job start by their owner:`,
      "",
      ...this.describe(found),
      "",
      "  Nothing is broken and nothing has changed. Re-run once this machine can",
      "  reach github.com; if the lookups were rate-limited, a few minutes is enough:",
      "",
      "      npx @codyswann/lisa@latest .",
    ].join("\n");
    ctx.logger.warn(message);
    return { name: this.name, action: "skipped", changedFiles: [], message };
  }

  /**
   * One operator-readable line per distinct reference.
   * @param found - Every finding across the scanned files
   * @returns Indented description lines
   */
  private describe(found: readonly UnpinnedRef[]): readonly string[] {
    return distinctRefs(found).map(ref => `    • ${ref.action}@${ref.ref}`);
  }

  /**
   * Summarize what was pinned, naming anything that was left alone.
   * @param pins - References that resolved
   * @param found - Every finding across the scanned files
   * @param changedFiles - Files that were rewritten
   * @returns Operator-readable summary
   */
  private summarize(
    pins: readonly ResolvedPin[],
    found: readonly UnpinnedRef[],
    changedFiles: readonly string[]
  ): string {
    const distinct = distinctRefs(found).length;
    const unresolved = distinct - pins.length;
    const tail =
      unresolved > 0
        ? ` ${unresolved} reference(s) could not be looked up and were left as they are.`
        : "";
    return `Pinned ${pins.length} third-party action reference(s) to commit SHAs in ${changedFiles.join(", ")}.${tail}`;
  }
}

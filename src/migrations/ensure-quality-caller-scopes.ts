import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as fse from "fs-extra";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

const CI_FILE = path.join(".github", "workflows", "ci.yml");
const CONFIG_FILE = ".lisa.config.json";

/**
 * Matches the caller line that invokes either reusable quality workflow.
 * Anchored at four spaces because a caller `uses:` is always a job-level key.
 */
const CALLER_USES =
  /^ {4}uses:\s*CodySwannGT\/lisa\/\.github\/workflows\/quality(?:-rails)?\.yml@/u;

/** A job key inside `jobs:` — two-space indent, no value on the line. */
const JOB_KEY = /^ {2}\S[^:]*:\s*$/u;

/** Scopes the work_item_traceability job needs from the caller's token. */
const REQUIRED_SCOPES: readonly string[] = ["issues", "pull-requests"];

/** Tracker credentials, by the `tracker` value that actually needs them. */
const TRACKER_SECRETS: Readonly<Record<string, readonly string[]>> = {
  jira: ["JIRA_API_TOKEN", "JIRA_LOGIN"],
  linear: ["LINEAR_API_KEY"],
};

/** Boundaries of one `key:` block nested inside a job. */
interface Block {
  /** Index of the `    key:` line itself. */
  readonly header: number;
  /** Index one past the block's last entry line. */
  readonly end: number;
  /** Text after the colon on the header line (e.g. `inherit`). */
  readonly inlineValue: string;
}

/**
 * Locate the job block containing the reusable-quality caller.
 *
 * Line scanning rather than a YAML round-trip: these files are human-maintained
 * and full of explanatory comments that parse-and-reserialize would delete.
 * Mirrors the technique in scripts/migrate-deploy-order.sh and
 * scripts/detect-stale-workflow-inputs.mjs.
 * @param lines - The workflow file split into lines
 * @returns Start (inclusive) and end (exclusive) line indices, or null
 */
function findCallerJob(
  lines: readonly string[]
): { start: number; end: number } | null {
  const usesAt = lines.findIndex(line => CALLER_USES.test(line));
  if (usesAt < 0) return null;

  // The nearest job key at or above the caller line.
  const start = lines
    .slice(0, usesAt + 1)
    .reduce((acc, line, i) => (JOB_KEY.test(line) ? i : acc), -1);
  const after = lines.findIndex((line, i) => i > usesAt && JOB_KEY.test(line));
  return {
    start: start < 0 ? 0 : start,
    end: after < 0 ? lines.length : after,
  };
}

/**
 * Find a four-space `key:` block within the given job range.
 * @param lines - The workflow file split into lines
 * @param key - The block key to find (e.g. "permissions")
 * @param range - Job boundaries to search within
 * @param range.start - First line of the job (inclusive)
 * @param range.end - Line after the job (exclusive)
 * @returns The block's boundaries, or null when the key is absent
 */
function findBlock(
  lines: readonly string[],
  key: string,
  range: { start: number; end: number }
): Block | null {
  const header = lines.findIndex(
    (line, i) =>
      i >= range.start && i < range.end && line.startsWith(`    ${key}:`)
  );
  if (header < 0) return null;

  const inlineValue = (lines[header] as string)
    .slice(`    ${key}:`.length)
    .trim();
  // Entries are indented deeper than the header; comments and blanks between
  // them belong to the block, so only a shallower non-blank line ends it.
  const breaksAt = lines.findIndex(
    (line, i) =>
      i > header &&
      i < range.end &&
      line.trim() !== "" &&
      !line.startsWith("      ")
  );
  const limit = breaksAt < 0 ? range.end : breaksAt;
  // End just past the last non-blank entry, so trailing blank lines stay
  // below any text we insert.
  const end = lines
    .slice(header + 1, limit)
    .reduce(
      (acc, line, i) => (line.trim() === "" ? acc : header + 2 + i),
      header + 1
    );
  return { header, end, inlineValue };
}

/**
 * Read the configured tracker, lowercased.
 * @param projectDir - The destination project directory
 * @returns The tracker name, or null when unset or unreadable
 */
async function readTracker(projectDir: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(projectDir, CONFIG_FILE), "utf8");
    const tracker: unknown = (JSON.parse(raw) as { tracker?: unknown }).tracker;
    return typeof tracker === "string" && tracker
      ? tracker.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

/** What a run of this migration would change in a project's ci.yml. */
interface Plan {
  readonly text: string | null;
  readonly lines: readonly string[];
  readonly job: { start: number; end: number } | null;
  readonly permissions: Block | null;
  readonly missingScopes: readonly string[];
  readonly secrets: Block | null;
  readonly missingSecrets: readonly string[];
}

/**
 * Migration: grant the reusable quality workflow's caller the token scopes the
 * work-item traceability backstop needs, and map the tracker credentials it
 * needs to verify a PR backlink.
 *
 * Downstream `.github/workflows/ci.yml` is create-only, so a repo installed
 * before #2046 can never receive these through the copy strategies — its
 * backstop runs but reports not-enforceable forever. This migration closes that
 * gap in place.
 *
 * Deliberately conservative, because it edits a file the host owns:
 *
 * - Patches an EXISTING `permissions:` block only. A caller with no block
 *   inherits the repo default (typically permissive, so already sufficient);
 *   inventing a block there would RESTRICT scopes the called jobs may rely on.
 * - Never downgrades: a scope already granted at `write` is left alone.
 * - Never rewrites `secrets: inherit` into an explicit map — that is the host's
 *   choice and converting it changes what the called workflow receives.
 * - Adds only the credentials the configured tracker actually uses; a
 *   github-tracker repo needs none, so it gets no secret noise.
 */
export class EnsureQualityCallerScopesMigration implements Migration {
  readonly name = "ensure-quality-caller-scopes";
  readonly description =
    "Grant the CI quality caller issues/pull-requests read and map tracker credentials for the work-item backstop";

  /**
   * Compute what this migration would change, without writing.
   * @param ctx - Migration context
   * @returns The planned edit
   */
  private async plan(ctx: MigrationContext): Promise<Plan> {
    const empty: Plan = {
      text: null,
      lines: [],
      job: null,
      permissions: null,
      missingScopes: [],
      secrets: null,
      missingSecrets: [],
    };

    const file = path.join(ctx.projectDir, CI_FILE);
    if (!(await fse.pathExists(file))) return empty;
    const text = await readFile(file, "utf8");
    const lines = text.split("\n");
    const job = findCallerJob(lines);
    if (!job) return { ...empty, text, lines };

    const permissions = findBlock(lines, "permissions", job);
    const granted = new Set(
      permissions
        ? lines
            .slice(permissions.header + 1, permissions.end)
            .map(line => line.trim().split(":")[0]?.trim())
            .filter((key): key is string => Boolean(key))
        : []
    );
    const missingScopes = permissions
      ? REQUIRED_SCOPES.filter(scope => !granted.has(scope))
      : [];

    const tracker = await readTracker(ctx.projectDir);
    const wanted = (tracker ? TRACKER_SECRETS[tracker] : undefined) ?? [];
    const secrets = findBlock(lines, "secrets", job);
    // `secrets: inherit` already forwards everything; rewriting it would be a
    // behavior change the host did not ask for.
    const secretsIsMap = secrets !== null && secrets.inlineValue === "";
    const mapped = secretsIsMap
      ? new Set(
          lines
            .slice(secrets.header + 1, secrets.end)
            .map(line => line.trim().split(":")[0]?.trim())
            .filter((key): key is string => Boolean(key))
        )
      : new Set<string>();
    const missingSecrets = secretsIsMap
      ? wanted.filter(secret => !mapped.has(secret))
      : [];

    return {
      text,
      lines,
      job,
      permissions,
      missingScopes,
      secrets: secretsIsMap ? secrets : null,
      missingSecrets,
    };
  }

  /**
   * Applies when the caller is missing a needed scope or tracker credential.
   * @param ctx - Migration context
   * @returns True when there is work to do
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    const plan = await this.plan(ctx);
    return plan.missingScopes.length > 0 || plan.missingSecrets.length > 0;
  }

  /**
   * Insert the missing permission scopes and tracker secret mappings.
   * @param ctx - Migration context
   * @returns Result describing the action taken
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const plan = await this.plan(ctx);
    if (plan.missingScopes.length === 0 && plan.missingSecrets.length === 0) {
      return { name: this.name, action: "noop" };
    }

    // Apply insertions bottom-up so each earlier index stays valid against the
    // array the previous step produced.
    const insertions = [
      plan.permissions && plan.missingScopes.length > 0
        ? {
            at: plan.permissions.end,
            text: plan.missingScopes.map(scope => `      ${scope}: read`),
          }
        : null,
      plan.secrets && plan.missingSecrets.length > 0
        ? {
            at: plan.secrets.end,
            text: plan.missingSecrets.map(
              secret => `      ${secret}: \${{ secrets.${secret} }}`
            ),
          }
        : null,
    ]
      .filter(
        (entry): entry is { at: number; text: string[] } => entry !== null
      )
      .sort((a, b) => b.at - a.at);

    const lines = insertions.reduce<readonly string[]>(
      (acc, entry) => [
        ...acc.slice(0, entry.at),
        ...entry.text,
        ...acc.slice(entry.at),
      ],
      plan.lines
    );

    const parts = [
      plan.missingScopes.length > 0
        ? `permissions (${plan.missingScopes.join(", ")})`
        : null,
      plan.missingSecrets.length > 0
        ? `tracker secrets (${plan.missingSecrets.join(", ")})`
        : null,
    ].filter((part): part is string => part !== null);
    const message = `Granted the CI quality caller ${parts.join(" and ")}`;

    if (ctx.dryRun) {
      ctx.logger.dry(`Would update ${CI_FILE}: ${parts.join("; ")}`);
      return {
        name: this.name,
        action: "applied",
        changedFiles: [CI_FILE],
        message,
      };
    }

    await writeFile(path.join(ctx.projectDir, CI_FILE), lines.join("\n"));
    ctx.logger.success(message);
    return {
      name: this.name,
      action: "applied",
      changedFiles: [CI_FILE],
      message,
    };
  }
}

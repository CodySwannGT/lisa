#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * @file lisa-evidence-prune.mjs
 * @description Dry-run-first prune for a full completion-proof evidence release.
 *
 * GitHub caps a release at 1000 files, and once the evidence release is full
 * no work item can be marked complete (CodySwannGT/lisa#4692). This command
 * finds evidence files no completion record in any accepted evidence release
 * still depends on, copies each to a monthly archive release, confirms the copy
 * byte-for-byte, re-reads records published meanwhile, and only then deletes
 * the original (CodySwannGT/lisa#4720). By default it only reports; it changes
 * nothing without `--apply`.
 *
 * It is a plain Node script driven through `gh`, so it runs the same under
 * every coding agent Lisa supports and from a terminal or a scheduled job.
 *
 * Usage: node scripts/lisa-evidence-prune.mjs [--apply] [--json]
 *   [--release <name>] [--archive-release <name>] [--repo <owner/name>]
 *   [--min-age-days <n>]
 * @module lisa-evidence-prune
 */
import { boundedSpawnSync } from "./lib/bounded-spawn.mjs";
import {
  acceptedEvidenceReleases,
  evidenceReleaseOverride,
} from "./lib/completion-proof-github.mjs";
import {
  archiveReleaseTag,
  collectPins,
  EvidencePruneError,
  formatReport,
  planPrune,
} from "./lib/evidence-prune.mjs";
import { applyPrune } from "./lib/evidence-prune-apply.mjs";
import {
  parseFlags,
  readLisaConfig,
  resolveReleases,
  resolveRepository,
} from "./lib/evidence-prune-config.mjs";
import { ghAccess, pruneGitHub } from "./lib/evidence-prune-gh.mjs";
import {
  evidenceSnapshot,
  recordRescanner,
} from "./lib/evidence-prune-records.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

const USAGE = [
  "Usage: node scripts/lisa-evidence-prune.mjs [options]",
  "",
  "Reports which evidence files no completion record depends on. Nothing changes without --apply.",
  "",
  "  --apply                   Archive each candidate, confirm the copy, then delete the original",
  "  --json                    Print the report as JSON",
  "  --release <name>          Evidence release to prune (default: the configured one)",
  "  --archive-release <name>  Archive release (default: <release>-archive-YYYY-MM)",
  "  --repo <owner/name>       Repository (default: .lisa.config.json, then this checkout)",
  "  --min-age-days <n>        Keep evidence younger than this many days (default 14)",
];

const ACCESS_REFUSALS = {
  missing:
    "gh was not found. Install the GitHub CLI (https://cli.github.com), run `gh auth login`, and retry.",
  "signed-out":
    "gh is not signed in to github.com. Run `gh auth login` and retry.",
};

/** The real `gh` runner: bounded, and binary-safe when a download asks. */
function spawnRun(command, args, options = {}) {
  const result = boundedSpawnSync(command, args, {
    encoding: options.binary ? null : "utf8",
    input: options.input,
    maxBuffer: options.maxBuffer,
    timeout: options.timeout,
  });
  return {
    status: result.status,
    error: result.error,
    stdout: result.stdout ?? (options.binary ? Buffer.alloc(0) : ""),
    stderr: String(result.stderr ?? ""),
  };
}

/** `gh` installed and signed in, then read (and, for --apply, write) access. */
function requireAccess(flags, deps, config) {
  const access = ghAccess(deps.run);
  if (access !== "ok") throw new EvidencePruneError(ACCESS_REFUSALS[access]);
  const repository = resolveRepository(flags, config, deps.run);
  const gh = pruneGitHub(deps.run, repository);
  const repo = gh.repo();
  if (flags.apply && repo.permissions?.push !== true)
    throw new EvidencePruneError(
      `--apply needs write access to ${repository} to archive and delete release files, and the signed-in gh account does not have it. A dry run (without --apply) needs only read access.`
    );
  return { gh, repo, repository };
}

/** Gather, plan, and (under `--apply`) archive; returns the report. */
function prune(flags, deps) {
  const config = readLisaConfig(deps.cwd);
  const policy = config.verification?.completion ?? {};
  // Validate the whole evidence-release policy, history included, before any
  // provider call: a malformed list must not surface halfway through a run.
  acceptedEvidenceReleases(policy);
  const pinned = deps.env.LISA_EVIDENCE_RELEASE?.trim();
  const pinnedRelease = pinned
    ? evidenceReleaseOverride(policy, pinned)
    : undefined;
  const { release, archiveRelease } = resolveReleases(
    flags,
    config,
    deps.env,
    deps.now,
    tag => archiveReleaseTag(tag, deps.now)
  );
  const { gh, repo, repository } = requireAccess(flags, deps, config);
  const snapshot = evidenceSnapshot(gh, policy, release);
  if (!snapshot)
    throw new EvidencePruneError(
      `The evidence release ${release} was not found in ${repository}. Nothing was changed; check the name, or pass --release <name>.`
    );
  const plan = planPrune({
    release,
    assets: snapshot.assets,
    records: snapshot.records,
    recordAssets: snapshot.recordAssets,
    now: deps.now,
    minAgeDays: flags.minAgeDays,
    hashOf: gh.sha256,
  });
  const report = {
    ...plan,
    repository,
    archiveRelease,
    applied: Boolean(flags.apply),
  };
  if (!flags.apply) return report;
  return {
    ...report,
    ...applyPrune(gh, plan.candidates, {
      tag: archiveRelease,
      branch: repo.default_branch,
      release,
      pins: collectPins(snapshot.records),
      known: new Set(snapshot.recordAssets.map(asset => asset.id)),
      rescan: recordRescanner(gh, policy, snapshot.accepted, {
        pinned: pinnedRelease,
      }),
    }),
  };
}

/** A heading with its count, then one indented line per entry. */
function section(heading, entries) {
  return [`${heading}: ${entries.length}`, ...entries.map(row => `  ${row}`)];
}

/** What `--apply` did, in words. */
function outcomeLines(report) {
  if (!report.applied) return [];
  const archive = report.archiveRelease;
  return [
    `Archived to ${archive} and removed: ${report.archived.length}`,
    ...(report.skipped.length
      ? section(
          "Skipped",
          report.skipped.map(row => row.reason)
        )
      : []),
    ...(report.archivedNotDeleted.length
      ? section(
          `Archived to ${archive} but not removed`,
          report.archivedNotDeleted
        )
      : []),
    ...(report.error
      ? [
          `Stopped: ${report.error}`,
          ...section(
            `Not archived (still in ${report.release})`,
            report.notArchived
          ),
        ]
      : []),
  ];
}

/**
 * Run the prune.
 * @param {string[]} [args] - Command-line arguments.
 * @param {object} [deps] - Injected for tests: `run`, `now`, `cwd`, `env`, `out`.
 * @returns {Promise<number>} Exit code: 0 on success, 1 on any refusal or stop.
 */
export async function main(args = process.argv.slice(2), deps = {}) {
  const out = deps.out ?? (line => console.log(line));
  const err = deps.out ?? (line => console.error(line));
  const json = args.includes("--json");
  try {
    const flags = parseFlags(args);
    if (flags.help) {
      USAGE.forEach(line => out(line));
      return 0;
    }
    const report = prune(flags, {
      run: deps.run ?? spawnRun,
      now: deps.now ?? new Date(),
      cwd: deps.cwd ?? process.cwd(),
      env: deps.env ?? process.env,
    });
    const lines = json
      ? [JSON.stringify(report, null, 2)]
      : [...formatReport(report), ...outcomeLines(report)];
    lines.forEach(line => (report.error ? err(line) : out(line)));
    return report.error ? 1 : 0;
  } catch (error) {
    err(
      json ? JSON.stringify({ error: error.message }, null, 2) : error.message
    );
    return 1;
  }
}

if (invokedAsScript(import.meta.url)) process.exitCode = await main();

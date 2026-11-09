// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Inputs for the evidence prune: its flags, the project's Lisa config, which
 * release to prune, and which repository it lives in.
 *
 * The release is resolved exactly as `lisa-work-item.mjs evidence-release`
 * resolves it — `--release`, then `LISA_EVIDENCE_RELEASE`, then the configured
 * `verification.completion.evidenceRelease` — through the one shared resolver,
 * so the prune always reads the release new evidence is written to
 * (CodySwannGT/lisa#4692, #4720).
 * @module scripts/lib/evidence-prune-config
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  evidenceReleaseOverride,
  resolveEvidenceRelease,
  usableTag,
} from "./completion-proof-github.mjs";
import { DEFAULT_MIN_AGE_DAYS, EvidencePruneError } from "./evidence-prune.mjs";

const VALUE_FLAGS = new Map([
  ["--release", "release"],
  ["--archive-release", "archiveRelease"],
  ["--repo", "repo"],
  ["--min-age-days", "minAgeDays"],
]);
const SWITCHES = new Map([
  ["--apply", "apply"],
  ["--json", "json"],
  ["--help", "help"],
]);

/**
 * Parse the prune's command line; an unknown or valueless flag is refused.
 * @param {string[]} args - Arguments after the script name.
 * @returns {object} Parsed options.
 */
export function parseFlags(args) {
  const parse = (index, flags) => {
    if (index >= args.length) return flags;
    const arg = args[index];
    if (SWITCHES.has(arg))
      return parse(index + 1, { ...flags, [SWITCHES.get(arg)]: true });
    const value = args[index + 1];
    if (!VALUE_FLAGS.has(arg) || value === undefined || value.startsWith("--"))
      throw new EvidencePruneError(
        `Unrecognised argument ${JSON.stringify(arg)}. Run with --help for the options.`
      );
    return parse(index + 2, { ...flags, [VALUE_FLAGS.get(arg)]: value });
  };
  const flags = parse(0, {});
  const days = Number(flags.minAgeDays ?? DEFAULT_MIN_AGE_DAYS);
  if (!Number.isInteger(days) || days < 0)
    throw new EvidencePruneError(
      `--min-age-days must be a whole number of days, not ${JSON.stringify(flags.minAgeDays)}.`
    );
  return { ...flags, minAgeDays: days };
}

/** A JSON file, or `{}` when it is absent; unreadable config is a refusal. */
function readJson(file) {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new EvidencePruneError(
      `${file} is not valid JSON; fix it and retry.`
    );
  }
}

/** Objects merge key by key; anything else in `override` replaces `base`. */
function merge(base, override) {
  const plain = value =>
    value && typeof value === "object" && !Array.isArray(value);
  if (!plain(base) || !plain(override)) return override ?? base;
  return Object.fromEntries(
    [...new Set([...Object.keys(base), ...Object.keys(override)])].map(key => [
      key,
      key in override ? merge(base[key], override[key]) : base[key],
    ])
  );
}

/**
 * The project's Lisa config, with `.lisa.config.local.json` layered on top.
 * @param {string} cwd - Project root.
 * @returns {object} Effective config.
 */
export function readLisaConfig(cwd) {
  return merge(
    readJson(join(cwd, ".lisa.config.json")),
    readJson(join(cwd, ".lisa.config.local.json"))
  );
}

/**
 * The release to prune and the archive it moves into.
 * @param {object} flags - Parsed flags.
 * @param {object} config - Effective Lisa config.
 * @param {object} env - Process environment.
 * @param {Date} now - Run time.
 * @param {(release: string) => string} archiveFor - Default archive name.
 * @returns {{release: string, archiveRelease: string}} Concrete tags.
 */
export function resolveReleases(flags, config, env, now, archiveFor) {
  const policy = config.verification?.completion ?? {};
  const pinned = env.LISA_EVIDENCE_RELEASE?.trim();
  const release = flags.release
    ? evidenceReleaseOverride(policy, flags.release, "--release")
    : pinned
      ? evidenceReleaseOverride(policy, pinned)
      : resolveEvidenceRelease(policy, now);
  const archiveRelease = flags.archiveRelease ?? archiveFor(release);
  if (usableTag(archiveRelease) && archiveRelease !== release)
    return { release, archiveRelease };
  if (flags.archiveRelease)
    throw new EvidencePruneError(
      `--archive-release ${JSON.stringify(archiveRelease)} is not usable: name a different release using letters, digits, ".", "_" or "-".`
    );
  throw new EvidencePruneError(
    `The archive release name made from ${release} (${archiveRelease}) is not a usable GitHub release name; it is likely over 100 characters. Name a shorter archive release explicitly (see --help).`
  );
}

/**
 * `owner/name` from `--repo`, then the Lisa config, then the checkout's remote.
 * @param {object} flags - Parsed flags.
 * @param {object} config - Effective Lisa config.
 * @param {Function} run - Child-process runner.
 * @returns {string} The repository.
 */
export function resolveRepository(flags, config, run) {
  const configured =
    config.github?.org && config.github?.repo
      ? `${config.github.org}/${config.github.repo}`
      : undefined;
  const viewed = () => {
    const result = run("gh", ["repo", "view", "--json", "nameWithOwner"], {});
    try {
      return result.status === 0
        ? JSON.parse(result.stdout).nameWithOwner
        : undefined;
    } catch {
      return undefined;
    }
  };
  const repository = flags.repo ?? configured ?? viewed();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? ""))
    throw new EvidencePruneError(
      "Could not tell which GitHub repository holds the evidence. Pass --repo <owner/name>, or set github.org and github.repo in .lisa.config.json."
    );
  return repository;
}

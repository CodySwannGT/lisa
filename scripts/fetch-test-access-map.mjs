#!/usr/bin/env node
/**
 * Download the test-to-file access map for a base commit (CodySwannGT/lisa#4593).
 *
 * Lisa's PR CI uploads `test-access-map-<baseSha>-<runId>-<job>` artifacts
 * from the unit job, every unit shard leg and the integration job. This picks
 * the newest run whose base is `<sha>` itself or, failing that, the nearest
 * ancestor of it, downloads every map artifact of that run, merges them, and
 * saves:
 *
 * - `.lisa/test-access-map/map.json` — `{ "<test file>": ["<repo file>", …] }`
 * - `.lisa/test-access-map/meta.json` — base, run, creation time, artifacts
 *
 * Usage:
 *   node scripts/fetch-test-access-map.mjs --base <sha> [--repo owner/name] [--out <dir>]
 *
 * With no map for `<sha>` or any ancestor still within retention it exits 1
 * with `no access map for <sha>`; B4 (#4600) treats that as "run the full
 * suite". It never invents a map.
 *
 * The push gate calls this, so it must be quick. The repository keeps
 * thousands of artifacts and listing them all takes minutes, so it reads the
 * listing newest first, one page at a time, and stops at the first page that
 * yields a usable run, at a page older than `--max-age-days` (a map that old
 * is stale anyway), or after `--max-pages`. The chosen run's own artifact
 * list then supplies every map file it uploaded.
 * @module fetch-test-access-map
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

const REPOSITORY = "CodySwannGT/lisa";
const DEFAULT_OUT = ".lisa/test-access-map";
const ARTIFACT_NAME = /^test-access-map-([0-9a-f]{40})-(\d+)-(.+)$/;
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_MAX_AGE_DAYS = 7;
const PAGE_SIZE = 100;
const LISTING_JQ =
  ".artifacts[] | {name, runId: .workflow_run.id, createdAt: .created_at, expired}";

/**
 * @typedef {object} MapArtifact
 * @property {string} name - Artifact name
 * @property {string} baseSha - Base commit the map was keyed on
 * @property {string} runId - Workflow run that uploaded it
 * @property {string} createdAt - ISO creation time
 */

/**
 * @typedef {object} Deps
 * @property {(command: string, args: ReadonlyArray<string>) => string} run - Run a command, return stdout; throws on a non-zero exit
 * @property {() => Date} now - Current time
 * @property {(line: string) => void} out - Standard output
 * @property {(line: string) => void} err - Standard error
 */

/**
 * Parse `--base`, `--repo`, `--out`, `--max-pages` and `--max-age-days`.
 * @param {ReadonlyArray<string>} argv - Arguments after the script
 * @returns {{ base: string | undefined, repo: string, out: string, maxPages: number, maxAgeDays: number }} Options
 */
export function parseArgs(argv) {
  const value = flag => {
    const index = argv.indexOf(flag);
    const inline = argv.find(arg => arg.startsWith(`${flag}=`));
    if (inline !== undefined) return inline.slice(flag.length + 1);
    return index === -1 ? undefined : argv[index + 1];
  };
  const number = (flag, fallback) => {
    const parsed = Number(value(flag));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    base: value("--base"),
    repo: value("--repo") ?? REPOSITORY,
    out: value("--out") ?? DEFAULT_OUT,
    maxPages: number("--max-pages", DEFAULT_MAX_PAGES),
    maxAgeDays: number("--max-age-days", DEFAULT_MAX_AGE_DAYS),
  };
}

/**
 * Map artifacts from `gh api` NDJSON output (`{name, runId, createdAt}` per
 * line). Expired artifacts and other artifacts are dropped.
 * @param {string} output - NDJSON
 * @returns {ReadonlyArray<MapArtifact>} Artifacts whose name parses
 */
export function parseArtifacts(output) {
  return output
    .split("\n")
    .filter(line => line.trim() !== "")
    .flatMap(line => {
      const parsed = JSON.parse(line);
      const match = ARTIFACT_NAME.exec(parsed.name ?? "");
      if (!match || parsed.expired === true) return [];
      return [
        {
          name: parsed.name,
          baseSha: match[1],
          runId: String(parsed.runId ?? match[2]),
          createdAt: parsed.createdAt ?? "",
        },
      ];
    });
}

/**
 * Commits from `ancestor` to `sha`, or undefined when `ancestor` is not one.
 * @param {Deps["run"]} run - Command runner
 * @param {string} ancestor - Candidate base
 * @param {string} sha - Requested commit
 * @returns {number | undefined} Distance
 */
function ancestorDistance(run, ancestor, sha) {
  if (ancestor === sha) return 0;
  try {
    run("git", ["merge-base", "--is-ancestor", ancestor, sha]);
    return Number(
      run("git", ["rev-list", "--count", `${ancestor}..${sha}`]).trim()
    );
  } catch {
    return undefined;
  }
}

/**
 * The run to use: base equal to `sha` first, else the nearest ancestor, then
 * the newest run at that base.
 * @param {ReadonlyArray<MapArtifact>} artifacts - Published map artifacts
 * @param {string} sha - Requested commit
 * @param {Deps["run"]} run - Command runner
 * @returns {{ runId: string, baseSha: string, distance: number, artifacts: ReadonlyArray<MapArtifact> } | undefined} Choice
 */
export function selectRun(artifacts, sha, run) {
  const bases = [...new Set(artifacts.map(artifact => artifact.baseSha))];
  const ranked = bases
    .map(baseSha => ({
      baseSha,
      distance: ancestorDistance(run, baseSha, sha),
    }))
    .filter(entry => entry.distance !== undefined)
    .sort((a, b) => a.distance - b.distance);
  const nearest = ranked[0];
  if (nearest === undefined) return undefined;
  const atBase = artifacts.filter(
    artifact => artifact.baseSha === nearest.baseSha
  );
  const newest = [...atBase].sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) ||
      Number(b.runId) - Number(a.runId)
  )[0];
  return {
    runId: newest.runId,
    baseSha: nearest.baseSha,
    distance: nearest.distance,
    artifacts: atBase.filter(artifact => artifact.runId === newest.runId),
  };
}

/**
 * Every `.json` file under a directory, recursively.
 * @param {string} directory - Directory to walk
 * @returns {ReadonlyArray<string>} File paths
 */
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".json") ? [full] : [];
  });
}

/**
 * Merge downloaded `{ meta, map }` files into one map; a test file listed by
 * several jobs gets the union of their entries.
 * @param {ReadonlyArray<{ meta?: Record<string, unknown>, map?: Record<string, ReadonlyArray<string>> }>} documents - Parsed map files
 * @returns {{ map: Readonly<Record<string, ReadonlyArray<string>>>, metas: ReadonlyArray<Record<string, unknown>> }} Merged map and the metadata seen
 */
export function mergeMaps(documents) {
  const valid = documents.filter(
    document => document && typeof document.map === "object"
  );
  const keys = [
    ...new Set(valid.flatMap(document => Object.keys(document.map))),
  ];
  const map = Object.fromEntries(
    keys
      .sort()
      .map(key => [
        key,
        [...new Set(valid.flatMap(document => document.map[key] ?? []))].sort(),
      ])
  );
  return { map, metas: valid.map(document => document.meta ?? {}) };
}

/**
 * A duration as `2d 3h`, `3h 12m` or `5m`.
 * @param {number} milliseconds - Duration
 * @returns {string} Human-readable age
 */
export function formatAge(milliseconds) {
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

/**
 * Page through the artifact listing, newest first, until a usable run shows
 * up, then complete that run's map artifacts from its own listing.
 * @param {object} input - Inputs
 * @param {string} input.repo - owner/name
 * @param {string} input.sha - Requested commit
 * @param {number} input.maxPages - Page budget
 * @param {number} input.maxAgeDays - Oldest artifact worth reading
 * @param {Deps} input.deps - Injected effects
 * @returns {ReturnType<typeof selectRun>} The run, or undefined
 */
function findRun({ repo, sha, maxPages, maxAgeDays, deps }) {
  const oldest = deps.now().getTime() - maxAgeDays * 86_400_000;
  const seen = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const output = deps.run("gh", [
      "api",
      `repos/${repo}/actions/artifacts?per_page=${PAGE_SIZE}&page=${page}`,
      "--jq",
      LISTING_JQ,
    ]);
    const lines = output.split("\n").filter(entry => entry.trim() !== "");
    seen.push(...parseArtifacts(output));
    const choice = selectRun(seen, sha, deps.run);
    if (choice !== undefined) return completeRun(repo, choice, deps);
    const last = lines.length ? JSON.parse(lines.at(-1)).createdAt : "";
    if (lines.length < PAGE_SIZE || Date.parse(last) < oldest) break;
  }
  return undefined;
}

/**
 * Add the chosen run's other map artifacts (a page boundary can split them).
 * @param {string} repo - owner/name
 * @param {NonNullable<ReturnType<typeof selectRun>>} choice - The run
 * @param {Deps} deps - Injected effects
 * @returns {NonNullable<ReturnType<typeof selectRun>>} The run with every artifact
 */
function completeRun(repo, choice, deps) {
  const own = parseArtifacts(
    deps.run("gh", [
      "api",
      `repos/${repo}/actions/runs/${choice.runId}/artifacts?per_page=${PAGE_SIZE}`,
      "--jq",
      LISTING_JQ,
    ])
  ).filter(
    artifact =>
      artifact.runId === choice.runId && artifact.baseSha === choice.baseSha
  );
  const names = new Set(choice.artifacts.map(artifact => artifact.name));
  return {
    ...choice,
    artifacts: [
      ...choice.artifacts,
      ...own.filter(artifact => !names.has(artifact.name)),
    ],
  };
}

/**
 * Fetch, merge and save the map for `--base`.
 * @param {ReadonlyArray<string>} argv - Arguments after the script
 * @param {Deps} deps - Injected effects
 * @returns {number} Exit code
 */
export function main(argv, deps) {
  const { base, repo, out, maxPages, maxAgeDays } = parseArgs(argv);
  if (!base) {
    deps.err(
      "usage: fetch-test-access-map.mjs --base <sha> [--repo owner/name] [--out <dir>]"
    );
    return 2;
  }
  const sha = (() => {
    try {
      return deps
        .run("git", ["rev-parse", "--verify", `${base}^{commit}`])
        .trim();
    } catch {
      return base;
    }
  })();
  const choice = (() => {
    try {
      return findRun({ repo, sha, maxPages, maxAgeDays, deps });
    } catch (error) {
      deps.err(
        `fetch-test-access-map: could not list artifacts of ${repo}: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  })();
  if (choice === null) return 1;
  if (choice === undefined) {
    deps.err(`no access map for ${base}`);
    return 1;
  }
  const download = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-access-map-"));
  try {
    deps.run("gh", [
      "run",
      "download",
      choice.runId,
      "--repo",
      repo,
      ...choice.artifacts.flatMap(artifact => ["--name", artifact.name]),
      "--dir",
      download,
    ]);
    const { map, metas } = mergeMaps(
      walk(download).map(file => JSON.parse(fs.readFileSync(file, "utf8")))
    );
    if (metas.length === 0) {
      deps.err(`no access map for ${base}`);
      return 1;
    }
    const createdAt =
      metas
        .map(meta => String(meta.createdAt ?? ""))
        .filter(Boolean)
        .sort()[0] ??
      choice.artifacts[0]?.createdAt ??
      "";
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(
      path.join(out, "map.json"),
      `${JSON.stringify(map, null, 2)}\n`
    );
    fs.writeFileSync(
      path.join(out, "meta.json"),
      `${JSON.stringify(
        {
          requestedBase: sha,
          baseSha: choice.baseSha,
          commitsBehind: choice.distance,
          runId: choice.runId,
          createdAt,
          artifacts: choice.artifacts.map(artifact => artifact.name),
          testFiles: Object.keys(map).length,
        },
        null,
        2
      )}\n`
    );
    const age = formatAge(deps.now().getTime() - Date.parse(createdAt));
    deps.out(
      `access map: base ${choice.baseSha} (${choice.distance} commits behind ${sha}), run ${choice.runId}, created ${createdAt} (age ${age}), ${Object.keys(map).length} test files → ${path.join(out, "map.json")}`
    );
    return 0;
  } finally {
    fs.rmSync(download, { recursive: true, force: true });
  }
}

if (invokedAsScript(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), {
    run: (command, args) =>
      execFileSync(command, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 256 * 1024 * 1024,
      }),
    now: () => new Date(),
    out: line => process.stdout.write(`${line}\n`),
    err: line => process.stderr.write(`${line}\n`),
  });
}

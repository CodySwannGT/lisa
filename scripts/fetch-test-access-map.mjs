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
 * Parse `--base`, `--repo` and `--out`.
 * @param {ReadonlyArray<string>} argv - Arguments after the script
 * @returns {{ base: string | undefined, repo: string, out: string }} Options
 */
export function parseArgs(argv) {
  const value = flag => {
    const index = argv.indexOf(flag);
    const inline = argv.find(arg => arg.startsWith(`${flag}=`));
    if (inline !== undefined) return inline.slice(flag.length + 1);
    return index === -1 ? undefined : argv[index + 1];
  };
  return {
    base: value("--base"),
    repo: value("--repo") ?? REPOSITORY,
    out: value("--out") ?? DEFAULT_OUT,
  };
}

/**
 * Map artifacts from `gh api` NDJSON output (`{name, runId, createdAt}` per line).
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
      if (!match) return [];
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
 * Fetch, merge and save the map for `--base`.
 * @param {ReadonlyArray<string>} argv - Arguments after the script
 * @param {Deps} deps - Injected effects
 * @returns {number} Exit code
 */
export function main(argv, deps) {
  const { base, repo, out } = parseArgs(argv);
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
  const listing = (() => {
    try {
      return deps.run("gh", [
        "api",
        "--paginate",
        `repos/${repo}/actions/artifacts?per_page=100`,
        "--jq",
        '.artifacts[] | select(.name | startswith("test-access-map-")) | select(.expired | not) | {name, runId: .workflow_run.id, createdAt: .created_at}',
      ]);
    } catch (error) {
      deps.err(
        `fetch-test-access-map: could not list artifacts of ${repo}: ${error instanceof Error ? error.message : String(error)}`
      );
      return undefined;
    }
  })();
  if (listing === undefined) return 1;
  const choice = selectRun(parseArtifacts(listing), sha, deps.run);
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

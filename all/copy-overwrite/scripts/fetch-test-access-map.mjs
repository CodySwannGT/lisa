#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Download the test-to-file access map for a base commit (CodySwannGT/lisa#4593).
 *
 * The shared PR CI (`quality.yml`) uploads `test-access-map-<baseSha>-<runId>-<job>`
 * artifacts from the unit job, every unit shard leg and the integration job,
 * for Lisa and for every host whose `pushGate.affectedTests` is on
 * (CodySwannGT/lisa#4611). The repository defaults to the one `origin` points
 * at, so a host downloads its own maps. This picks
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
 *
 * A map decides which tests a push skips, so it is used only when it can be
 * trusted, and otherwise the push runs the full suite. The artifacts of a
 * public repository include those of fork pull requests and of runs whose
 * tests crashed or were cancelled part way, and the newest artifact at a
 * base is not necessarily a sound one. So each candidate run, newest first,
 * must pass three checks before its map is used:
 *
 * - **Same repository.** GitHub's `actions/runs/<id>` must report the run's
 *   head repository as this repository. A fork's run recorded the fork's
 *   code and tracer, which could write an empty map.
 * - **Succeeded.** The run's conclusion must be `success`, so every test job
 *   finished. A failed, cancelled or still-running run is skipped.
 * - **Complete and its own.** Every piece must name this run, its base and
 *   the head commit GitHub reports, and each scope (`unit`, `integration`)
 *   must have all the pieces its pieces declare (`pieces`, one per shard leg,
 *   indexed by `piece`). A shard that never uploaded would otherwise drop its
 *   tests from the merged map.
 *
 * A refused run is skipped and the next candidate is tried, up to
 * `MAX_RUN_CHECKS` runs. When none qualifies the reasons are printed on the
 * `no access map` line.
 *
 * Maps are recorded only in pull-request runs, on the pull request's head
 * code, and keyed on its base. Recording on pushes to `main` as well would
 * key a map on the code it was recorded from, but `main` runs no test suite
 * (`deploy.yml` sets `run_quality_checks: false`), and adding one would bill
 * a full suite run per merge, the cost that setting exists to avoid. A
 * same-repository pull request's head is written by someone with push
 * access, so it is trusted to the same degree as the branch itself.
 * @module fetch-test-access-map
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/**
 * `owner/name` from a GitHub remote URL (https, ssh or scp-like), or undefined.
 * @param {string} url - Remote URL
 * @returns {string | undefined} The repository
 */
export function repositoryFromRemote(url) {
  // Parsed by hand rather than with one pattern: a lazy name followed by an
  // optional `.git` and `/` backtracks on a long remote (sonarjs/slow-regex).
  const text = url.trim();
  const host = text.indexOf("github.com");
  if (host === -1) return undefined;
  let rest = text.slice(host + "github.com".length);
  const start = rest.length - rest.replace(/^[:/]+/u, "").length;
  if (start === 0) return undefined;
  rest = rest.slice(start);
  if (rest.endsWith("/")) rest = rest.slice(0, -1);
  const parts = rest.split("/");
  if (parts.length !== 2) return undefined;
  const [owner, raw] = parts;
  const name = raw.endsWith(".git") && raw.length > 4 ? raw.slice(0, -4) : raw;
  const plain = part => part.length > 0 && !/\s/u.test(part);
  return plain(owner) && plain(name) ? `${owner}/${name}` : undefined;
}

/**
 * The repository whose maps to read: `GITHUB_REPOSITORY`, else `origin`.
 * @returns {string | undefined} owner/name, or undefined when neither says
 */
function defaultRepository() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  try {
    return repositoryFromRemote(
      execFileSync("git", ["remote", "get-url", "origin"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
    );
  } catch {
    // probe-direction: fail-closed — no repository means no map, so the push
    // runs the full suite.
    return undefined;
  }
}
const DEFAULT_OUT = ".lisa/test-access-map";
const ARTIFACT_NAME = /^test-access-map-([0-9a-f]{40})-(\d+)-(.+)$/;
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_MAX_AGE_DAYS = 7;
const PAGE_SIZE = 100;
const LISTING_JQ =
  ".artifacts[] | {name, runId: .workflow_run.id, createdAt: .created_at, expired}";
const RUN_JQ =
  "{conclusion, headSha: .head_sha, headRepository: .head_repository.full_name}";
const FULL_SHA = /^[0-9a-f]{40}$/;
/** Candidate runs checked before giving up; each costs a GitHub API call. */
const MAX_RUN_CHECKS = 10;

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
 * @returns {{ base: string | undefined, repo: string | undefined, out: string, maxPages: number, maxAgeDays: number }} Options
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
    repo: value("--repo") ?? defaultRepository(),
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
    // probe-direction: fail-closed — a base git cannot place below `sha` is
    // dropped as a candidate, so fewer maps qualify and the push runs more.
    return undefined;
  }
}

/**
 * @typedef {{ runId: string, baseSha: string, distance: number, artifacts: ReadonlyArray<MapArtifact> }} RunChoice
 */

/**
 * Every candidate run in preference order: base equal to `sha` first, then
 * nearer ancestors, and within one base the newest run first. Each run must
 * still pass {@link runRefusal} and {@link piecesRefusal} before it is used.
 * @param {ReadonlyArray<MapArtifact>} artifacts - Published map artifacts
 * @param {string} sha - Requested commit
 * @param {Deps["run"]} run - Command runner
 * @returns {ReadonlyArray<RunChoice>} Candidates
 */
export function rankRuns(artifacts, sha, run) {
  const bases = [...new Set(artifacts.map(artifact => artifact.baseSha))]
    .map(baseSha => ({
      baseSha,
      distance: ancestorDistance(run, baseSha, sha),
    }))
    .filter(entry => entry.distance !== undefined)
    .sort((a, b) => a.distance - b.distance);
  return bases.flatMap(({ baseSha, distance }) => {
    const atBase = artifacts.filter(artifact => artifact.baseSha === baseSha);
    const runs = [...atBase]
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) ||
          Number(b.runId) - Number(a.runId)
      )
      .map(artifact => artifact.runId);
    return [...new Set(runs)].map(runId => ({
      runId,
      baseSha,
      distance,
      artifacts: atBase.filter(artifact => artifact.runId === runId),
    }));
  });
}

/**
 * The preferred candidate run, before any trust check (see {@link rankRuns}).
 * @param {ReadonlyArray<MapArtifact>} artifacts - Published map artifacts
 * @param {string} sha - Requested commit
 * @param {Deps["run"]} run - Command runner
 * @returns {RunChoice | undefined} Choice
 */
export function selectRun(artifacts, sha, run) {
  return rankRuns(artifacts, sha, run)[0];
}

/**
 * Why a workflow run's map must not be used, or undefined when it may.
 *
 * Only a run of this repository's own code (not a fork pull request's) that
 * concluded `success` qualifies: a fork controls the code that recorded the
 * map, and a failed or cancelled run may have stopped before every test file
 * was traced.
 * @param {{ conclusion?: unknown, headSha?: unknown, headRepository?: unknown } | null | undefined} info - What `gh api repos/<repo>/actions/runs/<id>` reports, through `RUN_JQ`
 * @param {string} repo - owner/name the map is meant for
 * @returns {string | undefined} The reason, or undefined
 */
export function runRefusal(info, repo) {
  const head =
    typeof info?.headRepository === "string" ? info.headRepository : "";
  if (head.toLowerCase() !== repo.toLowerCase()) {
    return `its code came from ${head || "an unknown repository"}, not ${repo}`;
  }
  if (info?.conclusion !== "success") {
    return `it did not succeed (${typeof info?.conclusion === "string" ? info.conclusion : "still running"})`;
  }
  if (typeof info.headSha !== "string" || !FULL_SHA.test(info.headSha)) {
    return "GitHub reported no head commit for it";
  }
  return undefined;
}

/**
 * Why a run's downloaded map pieces do not form one complete map of that run,
 * or undefined when they do.
 *
 * Each piece names the run, base and head commit it was recorded in, its
 * scope, and how many pieces that scope has (`pieces`, one per shard leg)
 * with its own zero-based index (`piece`). Every scope that uploaded anything
 * must have each of its pieces exactly once; a piece that does not say how
 * many there are (an older recorder) is refused too.
 * @param {ReadonlyArray<Record<string, unknown>>} metas - The pieces' metadata
 * @param {{ runId: string, baseSha: string, headSha: string }} run - The run they must belong to
 * @returns {string | undefined} The reason, or undefined
 */
export function piecesRefusal(metas, { runId, baseSha, headSha }) {
  if (metas.length === 0) return "its artifacts hold no map";
  const foreign = metas.some(
    meta =>
      String(meta.runId ?? "") !== runId ||
      meta.baseSha !== baseSha ||
      meta.headSha !== headSha
  );
  if (foreign) {
    return `a map piece was not recorded by run ${runId} at its head commit ${headSha.slice(0, 12)}`;
  }
  if (metas.some(meta => typeof meta.scope !== "string" || !meta.scope)) {
    return "a map piece has no scope";
  }
  const scopes = [...new Set(metas.map(meta => String(meta.scope)))].sort();
  for (const scope of scopes) {
    const reason = scopeRefusal(
      scope,
      metas.filter(meta => meta.scope === scope)
    );
    if (reason) return reason;
  }
  return undefined;
}

/**
 * Why one scope's pieces are not a complete set, or undefined.
 * @param {string} scope - The scope
 * @param {ReadonlyArray<Record<string, unknown>>} metas - That scope's pieces
 * @returns {string | undefined} The reason, or undefined
 */
function scopeRefusal(scope, metas) {
  const declared = [...new Set(metas.map(meta => meta.pieces))];
  if (declared.length !== 1) {
    return `the ${scope} map pieces disagree on how many there are`;
  }
  const [total] = declared;
  if (!Number.isInteger(total) || total < 1) {
    return `the ${scope} map does not say how many pieces it has`;
  }
  const indices = new Set(
    metas
      .map(meta => meta.piece)
      .filter(piece => Number.isInteger(piece) && piece >= 0 && piece < total)
  );
  if (indices.size !== total || metas.length !== total) {
    return `only ${indices.size} of ${total} ${scope} pieces were uploaded`;
  }
  return undefined;
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
 * The union of the full-rerun triggers each recorded map carries (the
 * project's Vitest `forceRerunTriggers`, `setupFiles` and `globalSetup`).
 * @param {ReadonlyArray<Record<string, unknown>>} metas - Recorded metadata
 * @returns {ReadonlyArray<string>} Sorted, de-duplicated globs
 */
export function mergedTriggers(metas) {
  return [
    ...new Set(
      metas.flatMap(meta =>
        Array.isArray(meta.triggers)
          ? meta.triggers.filter(glob => typeof glob === "string")
          : []
      )
    ),
  ].sort();
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
 * @typedef {object} LoadedMap
 * @property {RunChoice} choice - The run, with every artifact it uploaded
 * @property {Readonly<Record<string, ReadonlyArray<string>>>} map - Merged map
 * @property {ReadonlyArray<Record<string, unknown>>} metas - Its pieces' metadata
 */

/**
 * Page through the artifact listing, newest first, trying each candidate run
 * in preference order until one passes every trust check.
 * @param {object} input - Inputs
 * @param {string} input.repo - owner/name
 * @param {string} input.sha - Requested commit
 * @param {number} input.maxPages - Page budget
 * @param {number} input.maxAgeDays - Oldest artifact worth reading
 * @param {Deps} input.deps - Injected effects
 * @returns {{ loaded: LoadedMap | undefined, refusals: ReadonlyArray<string> }} The map, or why each candidate was refused
 */
function findRun({ repo, sha, maxPages, maxAgeDays, deps }) {
  const oldest = deps.now().getTime() - maxAgeDays * 86_400_000;
  const seen = [];
  const tried = new Set();
  const refusals = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const output = deps.run("gh", [
      "api",
      `repos/${repo}/actions/artifacts?per_page=${PAGE_SIZE}&page=${page}`,
      "--jq",
      LISTING_JQ,
    ]);
    const lines = output.split("\n").filter(entry => entry.trim() !== "");
    seen.push(...parseArtifacts(output));
    for (const candidate of rankRuns(seen, sha, deps.run)) {
      if (tried.has(candidate.runId)) continue;
      if (tried.size >= MAX_RUN_CHECKS) return { loaded: undefined, refusals };
      tried.add(candidate.runId);
      const result = loadRun(repo, candidate, deps);
      if ("loaded" in result) return { loaded: result.loaded, refusals };
      refusals.push(`refused run ${candidate.runId} (${result.refusal})`);
    }
    const last = lines.length ? JSON.parse(lines.at(-1)).createdAt : "";
    if (lines.length < PAGE_SIZE || Date.parse(last) < oldest) break;
  }
  return { loaded: undefined, refusals };
}

/**
 * Verify one candidate run with GitHub, download its pieces and check them.
 * @param {string} repo - owner/name
 * @param {RunChoice} candidate - The run
 * @param {Deps} deps - Injected effects
 * @returns {{ loaded: LoadedMap } | { refusal: string }} The map, or why not
 */
function loadRun(repo, candidate, deps) {
  const info = (() => {
    try {
      return JSON.parse(
        deps.run("gh", [
          "api",
          `repos/${repo}/actions/runs/${candidate.runId}`,
          "--jq",
          RUN_JQ,
        ])
      );
    } catch (error) {
      // probe-direction: fail-closed — a run GitHub cannot describe is not
      // trusted, so its map is skipped and the push runs more tests.
      return {
        unreadable: error instanceof Error ? error.message : String(error),
      };
    }
  })();
  if (info?.unreadable !== undefined) {
    return {
      refusal: `could not read run ${candidate.runId} from GitHub: ${info.unreadable}`,
    };
  }
  const distrust = runRefusal(info, repo);
  if (distrust) return { refusal: distrust };
  const download = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-access-map-"));
  try {
    const choice = completeRun(repo, candidate, deps);
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
    const incomplete = piecesRefusal(metas, {
      runId: choice.runId,
      baseSha: choice.baseSha,
      headSha: info.headSha,
    });
    if (incomplete) return { refusal: incomplete };
    return { loaded: { choice, map, metas } };
  } catch (error) {
    // probe-direction: fail-closed — a run whose map cannot be downloaded or
    // parsed is skipped like any other refused run.
    return {
      refusal: `its map could not be downloaded: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    fs.rmSync(download, { recursive: true, force: true });
  }
}

/**
 * Add the chosen run's other map artifacts (a page boundary can split them).
 * @param {string} repo - owner/name
 * @param {RunChoice} choice - The run
 * @param {Deps} deps - Injected effects
 * @returns {RunChoice} The run with every artifact
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
 * Write `map.json` and `meta.json` for a trusted run and print its summary.
 * @param {object} input - Inputs
 * @param {LoadedMap} input.loaded - The trusted map
 * @param {string} input.sha - Requested commit
 * @param {string} input.out - Output directory
 * @param {Deps} input.deps - Injected effects
 * @returns {void}
 */
function saveMap({ loaded, sha, out, deps }) {
  const { choice, map, metas } = loaded;
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
        triggers: mergedTriggers(metas),
      },
      null,
      2
    )}\n`
  );
  const age = formatAge(deps.now().getTime() - Date.parse(createdAt));
  deps.out(
    `access map: base ${choice.baseSha} (${choice.distance} commits behind ${sha}), run ${choice.runId}, created ${createdAt} (age ${age}), ${Object.keys(map).length} test files → ${path.join(out, "map.json")}`
  );
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
  if (!repo) {
    deps.err(
      "no access map: could not tell which GitHub repository to read (no --repo, GITHUB_REPOSITORY or GitHub origin remote)"
    );
    return 1;
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
  const found = (() => {
    try {
      return findRun({ repo, sha, maxPages, maxAgeDays, deps });
    } catch (error) {
      deps.err(
        `fetch-test-access-map: could not list artifacts of ${repo}: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  })();
  if (found === null) return 1;
  if (found.loaded === undefined) {
    // One line: the push gate reports the last stderr line as the reason.
    const why = found.refusals.length ? `: ${found.refusals.join("; ")}` : "";
    deps.err(`no access map for ${base}${why}`);
    return 1;
  }
  saveMap({ loaded: found.loaded, sha, out, deps });
  return 0;
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

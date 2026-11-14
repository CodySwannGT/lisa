// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Run only the RSpec specs a change can reach, at push, on Rails hosts
 * (CodySwannGT/lisa#4612). The Rails counterpart of `affected-tests.mjs`
 * (CodySwannGT/lisa#4600), with the same contract:
 *
 * - `pushGate.affectedTests` switches it (default ON for a Rails project,
 *   detected by `bin/rails` or `config/application.rb`; explicit `false`
 *   runs the full suite as before).
 * - `pushGate.affectedCoverage` says what a partial run does about coverage:
 *   `changed-files` (the Rails default) holds each changed Ruby file to
 *   `simplecov.thresholds.json` on its own, `skip` leaves coverage to CI,
 *   `full` keeps the full suite so coverage is measured over every spec.
 * - Whenever the selection could be wrong it runs the FULL suite and says
 *   why: a CI run, a missing or stale map, a trigger file, or a changed file
 *   the map has never seen.
 *
 * The map comes from gitlab-crystalball, recorded by CI's full RSpec run
 * (`scripts/lisa_crystalball_recorder.rb`), instead of the Node file-read
 * tracer TypeScript hosts use. Crystalball's own predictor strategies
 * (modified execution paths, modified specs, associated specs) are applied
 * here, in plain JavaScript, so the decision is a pure function of its inputs
 * that shares the TypeScript side's fallback rules and needs no Ruby to test.
 *
 * Everything here is pure; git, the download and RSpec itself live in
 * `scripts/lisa-rspec-select.mjs`. CI always runs every spec.
 * @module rspec-selection
 */
import {
  affectedTestsSettings,
  coverageEscalationLines,
  firedTrigger,
  fullSuiteEscalation,
  readersByFile,
} from "./affected-tests.mjs";
import {
  RAILS_PUSH_GATE_DEFAULTS,
  withDefaults,
} from "./push-gate-defaults.mjs";

/** Where the downloaded map lives, relative to the repository root (gitignored). */
export const MAP_DIR = ".lisa/crystalball-map";

/** Every CI map artifact is named `crystalball-map-<base sha>-<run id>[-<leg>]`. */
export const ARTIFACT_NAME = /^crystalball-map-([0-9a-f]{40})-(\d+)(?:-(.+))?$/;

/**
 * The coverage mode a Rails project gets when it names none (owner decision).
 * Owned by `push-gate-defaults.mjs`; re-exported for existing readers.
 */
export const RAILS_DEFAULT_COVERAGE = RAILS_PUSH_GATE_DEFAULTS.affectedCoverage;

/** Where a partial run's coverage floors come from. */
export const THRESHOLDS_FILE = "simplecov.thresholds.json";

/**
 * Rails changes that reach specs no map can point at, so the full suite runs.
 * The shared list in `affected-tests.mjs` (lockfiles among them) is checked
 * as well.
 */
export const RAILS_FULL_SUITE_TRIGGERS = Object.freeze([
  {
    pattern: /^Gemfile$/,
    reason: "the Gemfile changed (installed gems)",
  },
  {
    pattern: /^db\/(schema\.rb|structure\.sql)$/,
    reason: "the database schema changed",
  },
  {
    pattern: /^config\//,
    reason: "application configuration under config/ changed",
  },
  {
    pattern: /^spec\/support\//,
    reason: "shared spec support code changed",
  },
  {
    pattern: /^spec\/[^/]+_helper\.rb$/,
    reason: "a spec helper changed",
  },
  {
    pattern: /^(\.rspec|\.simplecov)$/,
    reason: "the RSpec or SimpleCov configuration changed",
  },
  {
    pattern:
      /^scripts\/(lisa-rspec-select\.mjs|lib\/rspec-selection\.mjs|lib\/affected-tests\.mjs|lisa_crystalball_recorder\.rb|lisa_rspec_partial_coverage\.rb)$/,
    reason: "the spec-selection machinery itself changed",
  },
]);

/**
 * Paths RSpec never loads, so a change to one cannot reach a spec and needs
 * no map entry: documentation, CI and coding-agent configuration.
 */
const NOT_LOADED_BY_RSPEC = Object.freeze([
  /\.(md|mdx|markdown|txt|rdoc)$/i,
  /^(LICENSE|CHANGELOG|README)[^/]*$/i,
  /^(docs|wiki)\//,
  /^\.(github|claude|codex|cursor|opencode|agents|devin|windsurf|gemini|agy)\//,
]);

/** A file RSpec collects as a spec. */
export const SPEC_FILE = /^spec\/.+_spec\.rb$/;

/** Spec groups whose behaviour lives outside the RSpec process; always run. */
export const ALWAYS_RUN_DIRS = Object.freeze([
  "spec/system/",
  "spec/features/",
]);

/** `:js`, `js: true`, `lisa_always_run: true` (or `:lisa_always_run`) in a spec. */
const ALWAYS_RUN_TAG =
  /(?:[,(]\s*:js\b|\bjs:\s*true\b|\blisa_always_run:\s*true\b|[,(]\s*:lisa_always_run\b)/;

/**
 * Whether a checkout is a Rails project (the detection G3 uses too).
 * @param {(file: string) => boolean} exists Whether a repository file exists.
 * @returns {boolean} True for a Rails project.
 */
export function isRailsProject(exists) {
  return exists("bin/rails") || exists("config/application.rb");
}

/**
 * The selection settings for a Rails project.
 *
 * Validation is `affectedTestsSettings`', so a typo is refused exactly as on
 * TypeScript hosts; only the defaults differ: selection is on for a Rails
 * project and coverage defaults to `changed-files`.
 * @param {Record<string, unknown>|null|undefined} config Parsed `.lisa.config.json`.
 * @param {boolean} rails Whether this is a Rails project.
 * @returns {{enabled: boolean, coverage: "full"|"changed-files"|"skip"}} Settings.
 * @throws {Error} When `pushGate` is invalid.
 */
export function rspecSelectionSettings(config, rails) {
  return affectedTestsSettings(
    rails ? withDefaults(config, RAILS_PUSH_GATE_DEFAULTS) : config
  );
}

/**
 * The first full-suite trigger any changed file fires, Rails list first.
 * @param {ReadonlyArray<string>} paths Changed paths.
 * @returns {{file: string, reason: string}|null} The trigger.
 */
export function railsTrigger(paths) {
  for (const file of paths) {
    const hit = RAILS_FULL_SUITE_TRIGGERS.find(entry =>
      entry.pattern.test(file)
    );
    if (hit) return { file, reason: hit.reason };
  }
  return firedTrigger(paths);
}

/**
 * Whether a spec's source tags anything to run on every partial push.
 * @param {string} source The spec file's text.
 * @returns {boolean} True when it carries `:js` or `lisa_always_run: true`.
 */
export function taggedAlwaysRun(source) {
  return ALWAYS_RUN_TAG.test(source);
}

/**
 * The spec Rails conventions pair with a source file (Crystalball's
 * associated-specs predictor): `app/models/user.rb` ->
 * `spec/models/user_spec.rb`, `lib/a/b.rb` -> `spec/lib/a/b_spec.rb`.
 * @param {string} file Changed path.
 * @returns {string|null} The conventional spec, or null.
 */
export function associatedSpec(file) {
  const app = /^app\/(.+)\.rb$/.exec(file);
  if (app) return `spec/${app[1]}_spec.rb`;
  const lib = /^lib\/(.+)\.rb$/.exec(file);
  return lib ? `spec/lib/${lib[1]}_spec.rb` : null;
}

/**
 * @typedef {object} RspecSelection
 * @property {"full"|"partial"} kind Which run to do.
 * @property {string|null} reason Why the full suite runs (kind `full`).
 * @property {Array<{file: string, reason: string}>} specs Spec files to run, with why.
 * @property {string[]} ignored Changed files RSpec never loads.
 */

/**
 * A full-suite selection.
 * @param {string} reason Why.
 * @returns {RspecSelection} The selection.
 */
export function fullSuite(reason) {
  return { kind: "full", reason, specs: [], ignored: [] };
}

/**
 * Why a deleted spec sends a `changed-files` push to the full suite, or null
 * when no spec was deleted.
 *
 * Deleting a spec removes the coverage it gave the files it executed, and
 * those files are usually unchanged, so the per-file check (which holds only
 * the changed Ruby files to the floor) never looks at them. A branch could
 * delete the only spec covering a model, drop whole-repo coverage below the
 * floor, and still pass a partial push that the full run it replaced would
 * have failed. Holding the deleted spec's map entry to the floor instead is
 * not safe either: a file no remaining spec loads is absent from SimpleCov's
 * resultset and would read as "outside coverage". So the push fails closed:
 * the full suite runs and its whole-repo minimums decide.
 * @param {ReadonlyArray<{path: string, status: string}>} changed Changed files.
 * @returns {string|null} The full-suite reason.
 */
export function deletedSpecReason(changed) {
  const gone = changed.find(
    entry => entry.status === "deleted" && SPEC_FILE.test(entry.path)
  );
  if (!gone) return null;
  return (
    `deleted spec: ${gone.path} no longer covers what it ran, and only ` +
    "the full suite's whole-repo coverage can say whether the project still meets its floor"
  );
}

/**
 * Choose the specs a change can reach, or say why everything must run.
 * @param {object} input Inputs.
 * @param {ReadonlyArray<{path: string, status: "added"|"modified"|"deleted"}>} input.changed Changed files.
 * @param {Readonly<Record<string, ReadonlyArray<string>>>} input.map Spec file -> application files it executed.
 * @param {ReadonlyArray<string>} input.alwaysRun Spec files to run on every partial push.
 * @param {(file: string) => boolean} input.exists Whether a file is in the working tree.
 * @param {"changed-files"|"skip"} [input.coverage] What the partial run does
 *   about coverage. In `changed-files` mode a deleted spec sends the push to
 *   the full suite: see {@link deletedSpecReason}.
 * @returns {RspecSelection} The selection.
 */
export function selectRailsSpecs({
  changed,
  map,
  alwaysRun,
  exists,
  coverage,
}) {
  const trigger = railsTrigger(changed.map(entry => entry.path));
  if (trigger) return fullSuite(`${trigger.reason} (${trigger.file})`);
  const deleted =
    coverage === "changed-files" ? deletedSpecReason(changed) : null;
  if (deleted) return fullSuite(deleted);
  const readers = readersByFile(map);
  const chosen = new Map();
  const choose = (file, reason) => {
    if (SPEC_FILE.test(file) && exists(file) && !chosen.has(file)) {
      chosen.set(file, reason);
    }
  };
  const ignored = [];
  for (const entry of changed) {
    if (SPEC_FILE.test(entry.path)) {
      if (entry.status !== "deleted") choose(entry.path, "changed spec");
      continue;
    }
    const reading = readers.get(entry.path);
    if (reading) {
      for (const spec of reading) choose(spec, `map: ${entry.path}`);
      const paired = associatedSpec(entry.path);
      if (paired) choose(paired, `conventional spec for ${entry.path}`);
      continue;
    }
    if (entry.status === "deleted") continue;
    if (NOT_LOADED_BY_RSPEC.some(pattern => pattern.test(entry.path))) {
      ignored.push(entry.path);
      continue;
    }
    return fullSuite(
      `unmapped file: ${entry.path} is not in the map, so no map entry can say which specs it reaches`
    );
  }
  for (const spec of alwaysRun) choose(spec, "always run");
  return {
    kind: "partial",
    reason: null,
    specs: [...chosen].map(([file, reason]) => ({ file, reason })),
    ignored,
  };
}

/**
 * The spec files that run on every partial push: everything under the
 * always-run folders, every spec the map recorded with `:js` or
 * `lisa_always_run`, and every spec whose source carries one of those tags.
 * @param {object} input Inputs.
 * @param {ReadonlyArray<string>} input.specFiles Every spec file in the tree.
 * @param {ReadonlyArray<string>} input.recorded The map's `alwaysRun` list.
 * @param {(file: string) => string} input.read A spec file's text.
 * @returns {string[]} Spec files, sorted.
 */
export function alwaysRunSpecs({ specFiles, recorded, read }) {
  const present = new Set(specFiles);
  const picked = specFiles.filter(
    file =>
      ALWAYS_RUN_DIRS.some(dir => file.startsWith(dir)) ||
      taggedAlwaysRun(read(file))
  );
  return [
    ...new Set([...picked, ...recorded.filter(file => present.has(file))]),
  ].sort();
}

/**
 * Merge map documents (`{meta, map, alwaysRun}`) from several CI legs; a spec
 * listed by several legs gets the union of their files.
 * @param {ReadonlyArray<any>} documents Parsed map files.
 * @returns {{map: Record<string, string[]>, alwaysRun: string[], metas: Array<Record<string, unknown>>}} The merge.
 */
export function mergeMapDocuments(documents) {
  const valid = documents.filter(
    document =>
      document &&
      typeof document.map === "object" &&
      document.map !== null &&
      !Array.isArray(document.map)
  );
  const specs = [
    ...new Set(valid.flatMap(document => Object.keys(document.map))),
  ].sort();
  const map = Object.fromEntries(
    specs.map(spec => [
      spec,
      [...new Set(valid.flatMap(document => document.map[spec] ?? []))].sort(),
    ])
  );
  const alwaysRun = [
    ...new Set(
      valid.flatMap(document =>
        Array.isArray(document.alwaysRun) ? document.alwaysRun : []
      )
    ),
  ].sort();
  return { map, alwaysRun, metas: valid.map(document => document.meta ?? {}) };
}

/**
 * Map artifacts from `gh api … --jq '{name, runId, createdAt, expired}'`
 * NDJSON. Expired and unrelated artifacts are dropped.
 * @param {string} output NDJSON.
 * @returns {Array<{name: string, baseSha: string, runId: string, createdAt: string}>} Artifacts.
 */
export function parseMapArtifacts(output) {
  return output
    .split("\n")
    .filter(line => line.trim() !== "")
    .flatMap(line => {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        return [];
      }
      const match = ARTIFACT_NAME.exec(parsed?.name ?? "");
      if (!match || parsed.expired === true) return [];
      return [
        {
          name: parsed.name,
          baseSha: match[1],
          runId: String(parsed.runId ?? match[2]),
          createdAt: String(parsed.createdAt ?? ""),
        },
      ];
    });
}

/** Candidate runs checked before the push gives up on a map. */
export const MAX_MAP_RUN_CHECKS = 10;

/**
 * What a verified map's saved metadata carries. A map saved without it was
 * saved before Lisa checked a map's run, so it is not used.
 */
export const MAP_TRUST = 1;

/** A full 40-character commit SHA. */
const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * @typedef {{runId: string, baseSha: string, distance: number, names: string[]}} MapRunChoice
 */

/**
 * Every candidate run, in preference order: base equal to the merge-base
 * first, then nearer ancestors, and within one base the newest run first.
 * Each must still pass {@link mapRunRefusal} and {@link mapPiecesRefusal}
 * before its map is used (same contract as `fetch-test-access-map.mjs`).
 * @param {ReadonlyArray<{name: string, baseSha: string, runId: string, createdAt: string}>} artifacts Artifacts.
 * @param {(baseSha: string) => number|undefined} distance Commits from a base to the merge-base, undefined when it is not an ancestor.
 * @returns {MapRunChoice[]} The candidates.
 */
export function rankMapRuns(artifacts, distance) {
  const bases = [...new Set(artifacts.map(artifact => artifact.baseSha))]
    .map(baseSha => ({ baseSha, distance: distance(baseSha) }))
    .filter(entry => entry.distance !== undefined)
    .sort((a, b) => a.distance - b.distance);
  return bases.flatMap(({ baseSha, distance: behind }) => {
    const atBase = artifacts.filter(artifact => artifact.baseSha === baseSha);
    const runs = [
      ...new Set(
        [...atBase]
          .sort(
            (a, b) =>
              b.createdAt.localeCompare(a.createdAt) ||
              Number(b.runId) - Number(a.runId)
          )
          .map(artifact => artifact.runId)
      ),
    ];
    return runs.map(runId => {
      const names = [
        ...new Set(
          atBase
            .filter(artifact => artifact.runId === runId)
            .map(artifact => artifact.name)
        ),
      ].sort();
      // A sharded run uploads each leg's map and the aggregate's merge of
      // them; the merge alone is the whole suite, so it is all that needs
      // downloading. Its metadata lists every leg, so completeness is still
      // checked (see mapPiecesRefusal).
      const whole = `crystalball-map-${baseSha}-${runId}`;
      return {
        runId,
        baseSha,
        distance: behind,
        names: names.includes(whole) ? [whole] : names,
      };
    });
  });
}

/**
 * The preferred candidate run, before any trust check (see {@link rankMapRuns}).
 * @param {ReadonlyArray<{name: string, baseSha: string, runId: string, createdAt: string}>} artifacts Artifacts.
 * @param {(baseSha: string) => number|undefined} distance Commits from a base to the merge-base.
 * @returns {MapRunChoice|undefined} The choice.
 */
export function chooseMapRun(artifacts, distance) {
  return rankMapRuns(artifacts, distance)[0];
}

/**
 * Why a workflow run's map must not be used, or null when it may.
 *
 * A map decides which specs a push skips, and a public repository's artifact
 * listing includes fork pull requests' runs and runs that failed or were
 * cancelled part way. Only a run of this repository's own code that concluded
 * `success` qualifies: a fork controls the code (and recorder) that wrote its
 * map, and a failed or cancelled run may have stopped before every spec ran.
 * @param {{conclusion?: unknown, headSha?: unknown, headRepository?: unknown}|null|undefined} info What `gh api repos/<repo>/actions/runs/<id>` reports.
 * @param {string} repo owner/name the map is meant for.
 * @returns {string|null} The reason, or null.
 */
export function mapRunRefusal(info, repo) {
  const head =
    typeof info?.headRepository === "string" ? info.headRepository : "";
  if (!repo || head.toLowerCase() !== repo.toLowerCase()) {
    return `its code came from ${head || "an unknown repository"}, not ${repo || "this repository"}`;
  }
  if (info?.conclusion !== "success") {
    return `it did not succeed (${typeof info?.conclusion === "string" ? info.conclusion : "still running"})`;
  }
  if (typeof info.headSha !== "string" || !FULL_SHA.test(info.headSha)) {
    return "GitHub reported no head commit for it";
  }
  return null;
}

/**
 * The per-leg metadata a downloaded map stands for: a merged map's
 * `meta.merged` (one entry per shard leg), else the map's own `meta`.
 * @param {ReadonlyArray<Record<string, any>>} metas Downloaded documents' metadata.
 * @returns {Array<Record<string, any>>} One entry per recorded piece.
 */
function pieceMetas(metas) {
  return metas.flatMap(meta =>
    Array.isArray(meta?.merged) ? meta.merged : [meta ?? {}]
  );
}

/**
 * Why a run's downloaded map pieces are not one complete map of that run, or
 * null when they are.
 *
 * Each piece names the run, base and head commit it was recorded at, how many
 * pieces the suite has (`pieces`, one per shard leg) and its own zero-based
 * index (`piece`). Every piece must be present exactly once: a shard that
 * never recorded would otherwise drop its specs from the map. A piece that
 * does not say how many there are (an older recorder) is refused too.
 * @param {ReadonlyArray<Record<string, any>>} metas Downloaded documents' metadata.
 * @param {{runId: string, baseSha: string, headSha: string}} run The run they must belong to.
 * @returns {string|null} The reason, or null.
 */
export function mapPiecesRefusal(metas, { runId, baseSha, headSha }) {
  const pieces = pieceMetas(metas);
  if (pieces.length === 0) return "its artifacts hold no map";
  const foreign = pieces.some(
    meta =>
      String(meta.runId ?? "") !== runId ||
      meta.baseSha !== baseSha ||
      meta.headSha !== headSha
  );
  if (foreign) {
    return `a map piece was not recorded by run ${runId} at its head commit ${headSha.slice(0, 12)}`;
  }
  const declared = [...new Set(pieces.map(meta => meta.pieces))];
  if (declared.length !== 1) {
    return "its map pieces disagree on how many there are";
  }
  const [total] = declared;
  if (!Number.isInteger(total) || total < 1) {
    return "its map does not say how many pieces it has";
  }
  const indices = new Set(
    pieces
      .map(meta => meta.piece)
      .filter(piece => Number.isInteger(piece) && piece >= 0 && piece < total)
  );
  if (indices.size !== total || pieces.length !== total) {
    return `only ${indices.size} of ${total} map pieces were recorded`;
  }
  return null;
}

/**
 * Line numbers (1-based) inside `# :nocov:` blocks, which SimpleCov skips.
 * @param {string} source File text.
 * @returns {Set<number>} Skipped lines.
 */
export function nocovLines(source) {
  const skipped = new Set();
  let inside = false;
  source.split("\n").forEach((line, index) => {
    const marker = /^\s*#\s*:nocov:/.test(line);
    if (marker) inside = !inside;
    if (marker || inside) skipped.add(index + 1);
  });
  return skipped;
}

/**
 * One file's line and branch percentages from a SimpleCov resultset entry.
 * @param {{lines?: Array<number|null|"ignored">, branches?: Record<string, Record<string, number>>}} entry Resultset entry.
 * @param {Set<number>} skipped Lines SimpleCov skips.
 * @returns {{line: number|null, branch: number|null}} Percentages, null when nothing is measurable.
 */
export function filePercentages(entry, skipped) {
  const relevant = (entry.lines ?? [])
    .map((count, index) => ({ count, line: index + 1 }))
    .filter(
      ({ count, line }) => typeof count === "number" && !skipped.has(line)
    );
  const covered = relevant.filter(({ count }) => count > 0).length;
  const branches = Object.entries(entry.branches ?? {}).flatMap(
    ([condition, outcomes]) => {
      const line = Number(/^\[:\w+, \d+, (\d+)/.exec(condition)?.[1]);
      return skipped.has(line) ? [] : Object.values(outcomes ?? {});
    }
  );
  const taken = branches.filter(count => count > 0).length;
  return {
    line: relevant.length ? (covered / relevant.length) * 100 : null,
    branch: branches.length ? (taken / branches.length) * 100 : null,
  };
}

/**
 * Hold each changed Ruby file to the thresholds on its own.
 * @param {object} input Inputs.
 * @param {Record<string, {coverage?: Record<string, any>}>} input.resultset SimpleCov's `.resultset.json`.
 * @param {string} input.root Repository root, absolute.
 * @param {ReadonlyArray<string>} input.files Changed, existing Ruby files outside spec/.
 * @param {{line?: number, branch?: number}} input.thresholds Floors.
 * @param {(file: string) => string} input.read A file's text.
 * @returns {{shortfalls: string[], measured: string[], unmeasured: string[]}} The verdict.
 */
export function changedRubyCoverage({
  resultset,
  root,
  files,
  thresholds,
  read,
}) {
  const coverage = Object.assign(
    {},
    ...Object.values(resultset ?? {}).map(run => run?.coverage ?? {})
  );
  const shortfalls = [];
  const measured = [];
  const unmeasured = [];
  for (const file of files) {
    const key = Object.hasOwn(coverage, `${root}/${file}`)
      ? `${root}/${file}`
      : Object.keys(coverage).find(candidate => candidate.endsWith(`/${file}`));
    const entry = key === undefined ? undefined : coverage[key];
    if (!entry) {
      unmeasured.push(file);
      continue;
    }
    measured.push(file);
    const pct = filePercentages(entry, nocovLines(read(file)));
    for (const metric of ["line", "branch"]) {
      const floor = thresholds[metric];
      const value = pct[metric];
      if (typeof floor !== "number" || value === null) continue;
      if (value < floor) {
        shortfalls.push(
          `${file}: ${metric} coverage ${value.toFixed(2)}% is below ${floor}%`
        );
      }
    }
  }
  return { shortfalls, measured, unmeasured };
}

/** Who speaks in the Rails selector's lines. */
export const RSPEC_SUBJECT = "affected specs";

/**
 * The Rails selector's escalation lines: one per changed Ruby file below its
 * floor. A push is never stricter than whole-repo coverage
 * (CodySwannGT/lisa#4600), so such a file sends the push to the full suite,
 * whose SimpleCov minimums decide it, rather than failing it.
 * @param {object} input Inputs.
 * @param {ReadonlyArray<string>} input.files Changed Ruby files, in order.
 * @param {ReadonlyArray<string>} input.shortfalls {@link changedRubyCoverage}'s shortfalls.
 * @returns {string[]} Lines; empty when every file meets its floor.
 */
export function railsCoverageEscalation({ files, shortfalls }) {
  return coverageEscalationLines({ subject: RSPEC_SUBJECT, files, shortfalls });
}

/**
 * The Rails selector's escalation line for a partial run that proved nothing.
 * @param {string} because Why the partial run could not decide the push.
 * @returns {string} One line.
 */
export function railsFullSuiteEscalation(because) {
  return fullSuiteEscalation(RSPEC_SUBJECT, because);
}

/**
 * The lines that explain a selection before RSpec runs.
 * @param {RspecSelection} selection The selection.
 * @param {string} coverageNote What this run does about coverage.
 * @returns {string[]} Plain-language lines.
 */
export function explainRspecSelection(selection, coverageNote) {
  if (selection.kind === "full") {
    return [`🎯 affected specs: Running the full suite: ${selection.reason}`];
  }
  return [
    `🎯 affected specs: running ${selection.specs.length} spec file(s) the change can reach.`,
    ...selection.specs.map(spec => `   ${spec.file}  (${spec.reason})`),
    ...(selection.ignored.length
      ? [
          "   RSpec never loads these changed files:",
          ...selection.ignored.map(file => `     ${file}`),
        ]
      : []),
    `   Coverage: ${coverageNote}`,
    "   CI still runs every spec before merge.",
  ];
}

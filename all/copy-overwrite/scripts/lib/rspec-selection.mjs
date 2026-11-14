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
  firedTrigger,
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
 * Choose the specs a change can reach, or say why everything must run.
 * @param {object} input Inputs.
 * @param {ReadonlyArray<{path: string, status: "added"|"modified"|"deleted"}>} input.changed Changed files.
 * @param {Readonly<Record<string, ReadonlyArray<string>>>} input.map Spec file -> application files it executed.
 * @param {ReadonlyArray<string>} input.alwaysRun Spec files to run on every partial push.
 * @param {(file: string) => boolean} input.exists Whether a file is in the working tree.
 * @returns {RspecSelection} The selection.
 */
export function selectRailsSpecs({ changed, map, alwaysRun, exists }) {
  const trigger = railsTrigger(changed.map(entry => entry.path));
  if (trigger) return fullSuite(`${trigger.reason} (${trigger.file})`);
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

/**
 * The run to download: base equal to the merge-base first, else the nearest
 * ancestor of it, then the newest run at that base, with all its artifacts.
 * @param {ReadonlyArray<{name: string, baseSha: string, runId: string, createdAt: string}>} artifacts Artifacts.
 * @param {(baseSha: string) => number|undefined} distance Commits from a base to the merge-base, undefined when it is not an ancestor.
 * @returns {{runId: string, baseSha: string, distance: number, names: string[]}|undefined} The choice.
 */
export function chooseMapRun(artifacts, distance) {
  const ranked = [...new Set(artifacts.map(artifact => artifact.baseSha))]
    .map(baseSha => ({ baseSha, distance: distance(baseSha) }))
    .filter(entry => entry.distance !== undefined)
    .sort((a, b) => a.distance - b.distance);
  const nearest = ranked[0];
  if (!nearest) return undefined;
  const atBase = artifacts.filter(
    artifact => artifact.baseSha === nearest.baseSha
  );
  const newest = [...atBase].sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) ||
      Number(b.runId) - Number(a.runId)
  )[0];
  const names = [
    ...new Set(
      atBase
        .filter(artifact => artifact.runId === newest.runId)
        .map(artifact => artifact.name)
    ),
  ].sort();
  // A sharded run uploads each leg's map and the aggregate's merge of them;
  // the merge alone is the whole suite, so it is all that needs downloading.
  const whole = `crystalball-map-${nearest.baseSha}-${newest.runId}`;
  return {
    runId: newest.runId,
    baseSha: nearest.baseSha,
    distance: nearest.distance,
    names: names.includes(whole) ? [whole] : names,
  };
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

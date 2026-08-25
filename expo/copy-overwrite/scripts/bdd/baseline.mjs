// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Base-revision comparisons: the non-regression invariants.
 *
 * Three checks, one question — "did this change make the number look better by
 * describing less of the product, rather than by covering more of it?" — and
 * all three need a base revision to answer it, so they share one git read:
 *
 *   1. `coverage-regression`   Coverage the repo already accepted cannot be
 *                              given back.
 *   2. `obligation-uncovered`  Behavior that is NEW here is mapped or waived.
 *   3. `scenario-deleted`      A retired behavior is `@superseded` with a
 *                              record, never quietly deleted.
 *
 * These replaced a numeric ratchet on `coverageFloor` (a floor that could only
 * rise, whose reduction needed a `coverageFloorBaseline` record plus a
 * maintainer label). The number is still a gate — `floor-regression` still
 * fails a platform sitting below its committed floor, and `floor-invalid`
 * still refuses a floor written so it cannot be evaluated — but the floor no
 * longer carries the non-regression duty, because a number is a bad instrument
 * for it. A percentage can hold steady while a specific accepted behavior
 * loses its automation and an easier one gains some; and keeping a number
 * honest costs a recurring "nudge the value" pull request that proves nothing.
 * Checks 1 and 2 are strictly stronger: they are per obligation, they cannot
 * be satisfied by an offsetting gain elsewhere, and they shrink to zero as
 * waivers retire instead of accumulating.
 *
 * @module scripts/bdd/baseline
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { boundedSpawnSync } from "../lib/bounded-spawn.mjs";
import { byCodeUnit, declaredPlatforms } from "./contract.mjs";
import { parseFeatureSource, scenarioIdsIn } from "./parse.mjs";

const defect = (code, message) => ({ code, message });

/** Defect / evidence code, named once. */
const SCENARIO_DELETED = "scenario-deleted";

/**
 * Fixed absolute locations git is installed at, tried before anything on PATH.
 *
 * Handing a bare command name to the process spawner delegates the choice of
 * binary to whatever `PATH` happens to say, so any writable directory earlier
 * on it decides what this gate executes. The gate reads a base revision to
 * decide whether a pull request may merge, which makes that a real
 * substitution risk and not a theoretical one.
 *
 * Order within that constraint is set by measurement, not by convention. On
 * macOS `/usr/bin/git` is not git: it is Apple's `xcrun` shim, and dispatching
 * through it costs a **median 13,853 ms per invocation against 23-31 ms** for
 * a real binary — randomized call order, fixed inter-call gaps, n=12 each
 * (lisa#2887). `git --version` through the shim, doing no work at all, reached
 * 33,699 ms. This gate makes two or more git calls per run, so the shim alone
 * can spend a minute of a macOS run resolving a binary.
 *
 * The two entries promoted ahead of it are the developer-directory gits the
 * shim itself dispatches to. Both are `root:wheel` files in system locations,
 * so this is the same trust class as `/usr/bin/git` and not a relaxation: the
 * user-writable `/usr/local` and Homebrew entries stay behind it, exactly
 * where they already were. Neither promoted path exists on Linux or Windows,
 * so every non-macOS runner resolves precisely what it resolved before.
 */
const GIT_CANDIDATES = Object.freeze([
  "/Library/Developer/CommandLineTools/usr/bin/git",
  "/Applications/Xcode.app/Contents/Developer/usr/bin/git",
  "/usr/bin/git",
  "/usr/local/bin/git",
  "/opt/homebrew/bin/git",
  "/bin/git",
  "C:\\Program Files\\Git\\cmd\\git.exe",
]);

/** Resolved git path, or null; computed once per process. */
let gitBinary;

/**
 * Whether a path names a file that exists.
 * @param {string} candidate - Absolute path.
 * @returns {boolean} Whether it is a regular file.
 */
function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve git to an ABSOLUTE, verified path.
 *
 * Fixed system locations first, then each `PATH` entry resolved to an absolute
 * path and confirmed to be a real file — a lookup, never a delegation, so the
 * command actually executed is one this process chose and checked.
 * @returns {string|null} The absolute path, or null when git is not installed.
 */
export function resolveGit() {
  if (gitBinary !== undefined) return gitBinary;
  const fromPath = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap(entry => ["git", "git.exe"].map(name => path.join(entry, name)))
    .filter(candidate => path.isAbsolute(candidate));
  gitBinary =
    [...GIT_CANDIDATES, ...fromPath].find(candidate => isFile(candidate)) ??
    null;
  return gitBinary;
}

/**
 * Run one git command at an absolute path, or report that git is unavailable.
 * @param {string} root - Repo root.
 * @param {readonly string[]} args - Arguments after the binary.
 * @returns {{ok: boolean, stdout: string}} The verdict and its output.
 */
function git(root, args) {
  const binary = resolveGit();
  if (!binary) return { ok: false, stdout: "" };
  const result = boundedSpawnSync(binary, [...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { ok: result.status === 0, stdout: result.stdout ?? "" };
}

/**
 * Read one path at a git revision.
 * @param {string} root - Repo root.
 * @param {string} revision - Commit-ish.
 * @param {string} relative - Repo-relative path.
 * @returns {string|null} File contents, or null when absent at that revision.
 */
export function showAtRevision(root, revision, relative) {
  const result = git(root, ["show", `${revision}:${relative}`]);
  return result.ok ? result.stdout : null;
}

/**
 * List the feature files that existed at a revision.
 * @param {string} root - Repo root.
 * @param {string} revision - Commit-ish.
 * @returns {string[]} Repo-relative feature paths.
 */
function featureFilesAt(root, revision) {
  const result = git(root, [
    "ls-tree",
    "-r",
    "--name-only",
    revision,
    "--",
    "bdd/features",
  ]);
  if (!result.ok) return [];
  return result.stdout
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.endsWith(".feature"));
}

/**
 * Load the base revision's contract and its parsed scenarios.
 *
 * The base is parsed against the UNION of the base's and the head's platform
 * vocabularies. Using head's alone would make a base scenario's `@web` read as
 * an unknown tag the moment a pull request deleted the web runner from
 * `runnerPlatforms` — which would turn "I deleted the runner that proved this"
 * into an invisible change rather than the coverage loss it is.
 *
 * A base coverage map that EXISTS but does not parse makes the baseline
 * UNAVAILABLE rather than empty. An empty `before` set produces no
 * `coverage-regression` and no `scenario-deleted` finding at all, so treating
 * an unreadable map as "nothing was covered before" would let one malformed
 * character on the base revision switch off every non-regression check while
 * the gate still reported that nothing regressed.
 * @param {string} root - Repo root.
 * @param {string} revision - Base commit-ish.
 * @param {ReadonlySet<string>} headPlatforms - The head contract's platforms.
 * @returns {{available: boolean, error: string|null, contract: object|null, scenarios: object[], scenarioIds: Set<string>}} Base state.
 */
export function loadBaseline(root, revision, headPlatforms = new Set()) {
  const binary = resolveGit();
  const revisionExists =
    binary !== null && git(root, ["cat-file", "-e", `${revision}^{commit}`]).ok;
  const raw = showAtRevision(root, revision, "bdd/coverage-map.json");
  let contract = null;
  let error = null;
  if (raw !== null) {
    try {
      contract = JSON.parse(raw);
    } catch (parseError) {
      contract = null;
      error = `bdd/coverage-map.json at that revision is not valid JSON: ${parseError.message}`;
    }
  }
  if (binary === null) {
    error = "git was not found, so no base revision could be read";
  } else if (!revisionExists) {
    error = "the requested base does not name a readable commit";
  }
  const documents = featureFilesAt(root, revision)
    .map(file => ({ file, source: showAtRevision(root, revision, file) }))
    .filter(document => document.source !== null);
  const platforms = new Set([
    ...declaredPlatforms(contract?.runnerPlatforms),
    ...headPlatforms,
  ]);
  return {
    // A verified commit with no map and no features is the legitimate empty
    // baseline for a repository's first behavior contract. Commit existence is
    // checked independently so an invalid SHA can never masquerade as bootstrap.
    available: error === null && revisionExists,
    error,
    contract,
    scenarios: documents.flatMap(document =>
      parseFeatureSource(document.source, document.file, platforms)
    ),
    scenarioIds: scenarioIdsIn(documents.map(document => document.source)),
  };
}

/**
 * Every `SCENARIO:platform` a contract's mappings actually claim.
 *
 * Structural only — it deliberately does NOT ask whether each mapping's
 * evidence string still resolves. Evidence rot is already its own defect
 * (`mapping-evidence`) and already drops the obligation out of the reported
 * percentage; counting it here too would report one act twice and would make
 * these checks depend on reading files out of a git revision.
 * @param {readonly object[]} scenarios - Parsed scenarios for that revision.
 * @param {object|null} contract - That revision's coverage map.
 * @returns {Set<string>} Accepted keys.
 */
export function acceptedKeys(scenarios, contract) {
  const required = new Set(
    scenarios.filter(scenario => scenario.required).map(scenario => scenario.id)
  );
  const keys = new Set();
  for (const mapping of contract?.mappings ?? []) {
    if (!required.has(mapping.scenario)) continue;
    for (const platform of mapping.platforms ?? []) {
      keys.add(`${mapping.scenario}:${platform}`);
    }
  }
  return keys;
}

/**
 * Every `SCENARIO:platform` a revision OWES — required scenarios expanded over
 * the platforms they declare, less the ones a waiver removed.
 * @param {readonly object[]} scenarios - Parsed scenarios for that revision.
 * @param {object|null} contract - That revision's coverage map.
 * @returns {Set<string>} Obligation keys.
 */
export function obligationKeys(scenarios, contract) {
  const waived = waivedKeys(contract);
  const keys = new Set();
  for (const scenario of scenarios) {
    if (!scenario.required) continue;
    for (const platform of scenario.platforms) {
      const key = `${scenario.id}:${platform}`;
      if (!waived.has(key)) keys.add(key);
    }
  }
  return keys;
}

/**
 * Every `SCENARIO:platform` a waiver removes from the denominator.
 *
 * Exported because `bdd-matrix.mjs` calls it too. It was calling it WITHOUT an
 * import — a live ReferenceError on every matrix render, invisible because this
 * whole tree sat outside the ESLint config until #2658 put it back in.
 * @param {object|null} contract - A coverage map.
 * @returns {Set<string>} Waived keys.
 */
export function waivedKeys(contract) {
  return new Set(
    (contract?.platformWaivers ?? []).flatMap(waiver =>
      (waiver.platforms ?? []).map(platform => `${waiver.scenario}:${platform}`)
    )
  );
}

/**
 * Split a `SCENARIO:platform` key back into its parts.
 * @param {string} key - The key.
 * @returns {{scenario: string, platform: string}} Its parts.
 */
function partsOf(key) {
  const at = key.indexOf(":");
  return { scenario: key.slice(0, at), platform: key.slice(at + 1) };
}

/**
 * Fields a retirement record owes whoever has to re-litigate it later.
 * Shared with {@link checkDeletions} so the two routes out of the denominator
 * — deleting the scenario and un-mapping it — cannot demand different proof.
 */
const RETIREMENT_FIELDS = ["reason", "ticket", "approvedBy", "recordedAt"];

/**
 * Whether a scenario has been retired the way the contract requires: a
 * COMPLETE `retirements` record.
 *
 * This used to also demand a maintainer-applied PR label, on the reasoning that
 * two artifacts one author cannot produce alone is a stronger guarantee than
 * one. The label was dropped because it guarantees the wrong thing: it verifies
 * that a second person clicked, not that the behavior is actually gone, and it
 * stalls the case it was most needed for — an agent retiring coverage for a
 * feature the product genuinely no longer has.
 *
 * The record is the part that carries information. It still owes every field in
 * {@link RETIREMENT_FIELDS}, is still refused when incomplete, and still lands
 * in the diff where it can be read and challenged.
 * @param {object|undefined} record - The retirements entry, if any.
 * @returns {boolean} True when the retirement is complete.
 */
function isRetired(record) {
  if (!record) return false;
  return RETIREMENT_FIELDS.every(field => Boolean(record[field]));
}

/**
 * Coverage the repo already accepted cannot be given back.
 *
 * This is the invariant that replaced the floor ratchet, and it is deliberately
 * blind to the percentage: an obligation that was mapped at the base revision
 * and is not mapped here is a regression even when the headline number went UP
 * because easier behavior was covered in the same change.
 *
 * Keys whose scenario disappeared from the contract entirely are left to
 * {@link checkDeletions}, which names that act precisely; reporting both would
 * describe one deletion as two different failures.
 * @param {object} input - Baseline, and head contract and scenarios.
 * @returns {object[]} Defects found.
 */
export function checkCoverageRegression({ baseline, contract, scenarios }) {
  const before = acceptedKeys(baseline.scenarios, baseline.contract);
  const after = acceptedKeys(scenarios, contract);
  const present = new Set(scenarios.map(scenario => scenario.id));
  const retired = new Map(
    (contract.retirements ?? []).map(entry => [entry.scenario, entry])
  );
  const waived = waivedKeys(contract);
  return [...before]
    .filter(key => !after.has(key) && present.has(partsOf(key).scenario))
    .sort(byCodeUnit)
    .flatMap(key => regressionDefect(key, { retired, waived }));
}

/**
 * The defect for one obligation whose accepted coverage disappeared, or none
 * when it left the denominator through an authorized route.
 * @param {string} key - The `SCENARIO:platform` key.
 * @param {object} input - Retirement records and waived keys.
 * @returns {object[]} Zero or one defect.
 */
function regressionDefect(key, { retired, waived }) {
  const { scenario, platform } = partsOf(key);
  if (isRetired(retired.get(scenario))) return [];
  if (waived.has(key)) return [];
  return [
    defect(
      "coverage-regression",
      `${scenario}:${platform} was covered at the base revision and is not covered here. Coverage this repository already accepted cannot be handed back quietly. Restore the mapping, or take one of the two recorded routes out — a retirements record (${RETIREMENT_FIELDS.join(", ")}) for a behavior the product no longer has, or a platformWaivers entry for a runner that cannot decide it. ${routeTaken(key, { retired })}`
    ),
  ];
}

/**
 * Say what is missing from the authorization, so the operator is told what to
 * do rather than only what went wrong.
 *
 * Only reached for a key that took NEITHER route: {@link regressionDefect}
 * returns early for a waived one, so the waiver set cannot inform this
 * sentence and is not passed.
 * @param {string} key - The `SCENARIO:platform` key.
 * @param {object} input - Retirement records.
 * @returns {string} A one-sentence next step.
 */
function routeTaken(key, { retired }) {
  const { scenario } = partsOf(key);
  const record = retired.get(scenario);
  if (record) {
    const missing = RETIREMENT_FIELDS.filter(field => !record[field]);
    return `Its retirements record is incomplete (no ${missing.join(", no ")}).`;
  }
  return "Neither a retirements record nor a waiver was found for it.";
}

/**
 * Behavior that is NEW here is mapped or waived.
 *
 * The companion to {@link checkCoverageRegression}: without it a repository
 * could hold every accepted obligation and still let the product outrun its
 * contract, one unmapped scenario at a time. Pre-existing gaps are untouched —
 * an obligation that was already owed at the base revision is burndown, not a
 * regression — which is what lets a brownfield project adopt `enforced`
 * without first backfilling its whole history.
 * @param {object} input - Baseline plus the head contract and scenarios.
 * @returns {object[]} Defects found.
 */
export function checkNewObligations({ baseline, contract, scenarios }) {
  const before = obligationKeys(baseline.scenarios, baseline.contract);
  const covered = acceptedKeys(scenarios, contract);
  return [...obligationKeys(scenarios, contract)]
    .filter(key => !before.has(key) && !covered.has(key))
    .sort(byCodeUnit)
    .map(key => {
      const { scenario, platform } = partsOf(key);
      return defect(
        "obligation-uncovered",
        `${scenario}:${platform} is new here and nothing covers it. New behavior arrives mapped to an automated test or waived with a dated, owned platformWaivers entry — the contract does not accept a third answer. (Behavior that was already uncovered before this change is burndown, not a defect, and is listed in the report's gaps.)`
      );
    });
}

/**
 * Refuse scenario deletion used to shrink the denominator.
 *
 * The contract's answer to a retired behavior is `@superseded`, which keeps
 * the audit trail. Deleting the scenario instead makes coverage look better
 * by describing less of the product.
 * @param {object} input - Base IDs and head scenarios.
 * @returns {object[]} Defects found.
 */
export function checkDeletions({ baseIds, scenarios, contract }) {
  const present = new Set(scenarios.map(scenario => scenario.id));
  const retired = new Map(
    (contract.retirements ?? []).map(entry => [entry.scenario, entry])
  );
  return [...baseIds]
    .filter(id => !present.has(id))
    .sort(byCodeUnit)
    .flatMap(id => deletionDefects(id, retired.get(id)));
}

/**
 * Defects for one deleted scenario.
 * @param {string} id - The scenario ID that disappeared.
 * @param {object|undefined} record - Its retirement record, if any.
 * @returns {object[]} Defects found.
 */
function deletionDefects(id, record) {
  if (!record) {
    return [
      defect(
        SCENARIO_DELETED,
        `${id} was deleted from the contract. Retiring a behavior is @superseded, not deletion — deleting it shrinks the denominator instead of the gap. A genuine removal needs a complete retirements record (${RETIREMENT_FIELDS.join(", ")}).`
      ),
    ];
  }
  const missing = RETIREMENT_FIELDS.filter(field => !record[field]);
  const defects = missing.map(field =>
    defect(SCENARIO_DELETED, `${id}: retirements record has no ${field}`)
  );
  return defects;
}

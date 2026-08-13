/**
 * Base-revision comparisons: the coverage-floor ratchet and the
 * scenario-deletion check.
 *
 * Both answer the same question — "did this change make the number look
 * better by lowering the bar instead of raising the work?" — and both need a
 * base revision to answer it, so they share one git read.
 *
 * @module scripts/bdd/baseline
 */
import { spawnSync } from "node:child_process";

import { scenarioIdsIn } from "./parse.mjs";

const defect = (code, message) => ({ code, message });

/** The maintainer-applied PR label that authorizes a floor reduction. */
export const BASELINE_LABEL = "bdd-floor-baseline";

/**
 * Read one path at a git revision.
 * @param {string} root - Repo root.
 * @param {string} revision - Commit-ish.
 * @param {string} relative - Repo-relative path.
 * @returns {string|null} File contents, or null when absent at that revision.
 */
export function showAtRevision(root, revision, relative) {
  const result = spawnSync("git", ["show", `${revision}:${relative}`], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout : null;
}

/**
 * List the feature files that existed at a revision.
 * @param {string} root - Repo root.
 * @param {string} revision - Commit-ish.
 * @returns {string[]} Repo-relative feature paths.
 */
function featureFilesAt(root, revision) {
  const result = spawnSync(
    "git",
    ["ls-tree", "-r", "--name-only", revision, "--", "bdd/features"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  if (result.status !== 0) return [];
  return result.stdout
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.endsWith(".feature"));
}

/**
 * Load the base revision's contract and scenario IDs.
 * @param {string} root - Repo root.
 * @param {string} revision - Base commit-ish.
 * @returns {{available: boolean, contract: object|null, scenarioIds: Set<string>}} Base state.
 */
export function loadBaseline(root, revision) {
  const raw = showAtRevision(root, revision, "bdd/coverage-map.json");
  let contract = null;
  if (raw !== null) {
    try {
      contract = JSON.parse(raw);
    } catch {
      contract = null;
    }
  }
  const sources = featureFilesAt(root, revision)
    .map(file => showAtRevision(root, revision, file))
    .filter(source => source !== null);
  return {
    available: raw !== null || sources.length > 0,
    contract,
    scenarioIds: scenarioIdsIn(sources),
  };
}

/**
 * The coverage-floor ratchet: a floor may rise, and may never fall.
 *
 * Lowering it takes TWO artifacts that one author cannot produce by editing
 * one file: a `coverageFloorBaseline` record naming the exact drop, its
 * reason, ticket, approver and authorizing run, AND the maintainer-applied
 * `bdd-floor-baseline` label on the pull request. Either alone fails.
 * @param {object} input - Base and head contracts plus the PR labels.
 * @returns {object[]} Defects found.
 */
export function checkRatchet({ baseContract, contract, labels }) {
  const before = baseContract?.coverageFloor ?? {};
  const after = contract.coverageFloor ?? {};
  // A head value that is not a finite number is treated as a REMOVAL, never
  // as "unchanged". Quoting a floor as "19" would otherwise make the
  // comparison `"19" < 19` false, recording no drop, while the report treats
  // the same value as no floor at all — a one-character, single-file edit
  // that disables enforcement and produces no defect. That is precisely what
  // the ratchet exists to prevent, so an unusable value fails closed.
  const drops = Object.keys(before)
    .filter(platform => isUsableFloor(before[platform]))
    .filter(
      platform =>
        !isUsableFloor(after[platform]) || after[platform] < before[platform]
    )
    .map(platform => ({
      platform,
      from: before[platform],
      to: isUsableFloor(after[platform]) ? after[platform] : null,
      malformed:
        after[platform] !== undefined && !isUsableFloor(after[platform]),
    }));
  return drops.flatMap(drop => ratchetDefects(drop, contract, labels));
}

/**
 * Whether a raw `coverageFloor` entry is a usable floor.
 *
 * Mirrors `classifyFloor` in report.mjs; a unit test asserts the two agree,
 * because a disagreement is exactly the gap a quoted value slipped through.
 * @param {unknown} value - The raw entry.
 * @returns {boolean} True when it is a finite number in 0..100.
 */
export function isUsableFloor(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
  );
}

/**
 * Describe one observed reduction for the operator.
 * @param {object} drop - The observed reduction.
 * @returns {string} A one-line description.
 */
function describeDrop(drop) {
  if (drop.malformed) {
    return `coverageFloor.${drop.platform} is no longer a number (was ${drop.from}); a non-numeric floor disables enforcement, so it counts as a removal`;
  }
  return drop.to === null
    ? `coverageFloor.${drop.platform} was removed (was ${drop.from})`
    : `coverageFloor.${drop.platform} lowered ${drop.from} → ${drop.to}`;
}

/**
 * Defects for one attempted floor reduction.
 * @param {object} drop - The observed reduction.
 * @param {object} contract - Head contract.
 * @param {readonly string[]} labels - PR labels.
 * @returns {object[]} Defects found.
 */
function ratchetDefects(drop, contract, labels) {
  const what = describeDrop(drop);
  const record = (contract.coverageFloorBaseline ?? []).find(
    entry =>
      entry.platform === drop.platform &&
      entry.from === drop.from &&
      entry.to === drop.to
  );
  const defects = [];
  if (!record) {
    defects.push(
      defect(
        "floor-ratchet",
        `${what}: the floor is a ratchet. A reduction needs a coverageFloorBaseline record naming this exact change (platform, from, to, reason, ticket, approvedBy, runUrl).`
      )
    );
  } else {
    defects.push(...baselineRecordDefects(record, what));
  }
  if (!labels.includes(BASELINE_LABEL)) {
    defects.push(
      defect(
        "floor-ratchet",
        `${what}: requires the maintainer-applied "${BASELINE_LABEL}" label. Changing the floor in the same pull request that changes the code is not an authorization.`
      )
    );
  }
  return defects;
}

/**
 * Completeness of a baseline-update record. `runUrl` is validated for shape
 * only — the gate never contacts a tracker or CI API, so a merge can never
 * depend on one being reachable.
 * @param {object} record - The coverageFloorBaseline entry.
 * @param {string} what - Human description of the drop.
 * @returns {object[]} Defects found.
 */
function baselineRecordDefects(record, what) {
  const defects = ["reason", "ticket", "approvedBy", "runUrl", "recordedAt"]
    .filter(field => !record[field])
    .map(field =>
      defect(
        "floor-ratchet",
        `${what}: coverageFloorBaseline record has no ${field}`
      )
    );
  if (record.runUrl && !/^https:\/\/\S+$/.test(String(record.runUrl))) {
    defects.push(
      defect(
        "floor-ratchet",
        `${what}: coverageFloorBaseline.runUrl must be an https URL`
      )
    );
  }
  return defects;
}

/**
 * Refuse scenario deletion used to shrink the denominator.
 *
 * The contract's answer to a retired behavior is `@superseded`, which keeps
 * the audit trail. Deleting the scenario instead makes coverage look better
 * by describing less of the product.
 * @param {object} input - Base IDs, head scenarios, and the PR labels.
 * @returns {object[]} Defects found.
 */
export function checkDeletions({ baseIds, scenarios, contract, labels }) {
  const present = new Set(scenarios.map(scenario => scenario.id));
  const retired = new Map(
    (contract.retirements ?? []).map(entry => [entry.scenario, entry])
  );
  return [...baseIds]
    .filter(id => !present.has(id))
    .sort()
    .flatMap(id => deletionDefects(id, retired.get(id), labels));
}

/**
 * Defects for one deleted scenario.
 * @param {string} id - The scenario ID that disappeared.
 * @param {object|undefined} record - Its retirement record, if any.
 * @param {readonly string[]} labels - PR labels.
 * @returns {object[]} Defects found.
 */
function deletionDefects(id, record, labels) {
  if (!record) {
    return [
      defect(
        "scenario-deleted",
        `${id} was deleted from the contract. Retiring a behavior is @superseded, not deletion — deleting it shrinks the denominator instead of the gap. A genuine removal needs a retirements record and the "${BASELINE_LABEL}" label.`
      ),
    ];
  }
  const missing = ["reason", "ticket", "approvedBy", "recordedAt"].filter(
    field => !record[field]
  );
  const defects = missing.map(field =>
    defect("scenario-deleted", `${id}: retirements record has no ${field}`)
  );
  if (!labels.includes(BASELINE_LABEL)) {
    defects.push(
      defect(
        "scenario-deleted",
        `${id}: a retirement needs the maintainer-applied "${BASELINE_LABEL}" label`
      )
    );
  }
  return defects;
}

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
import { spawnSync } from "node:child_process";

import { declaredPlatforms } from "./contract.mjs";
import { parseFeatureSource, scenarioIdsIn } from "./parse.mjs";

const defect = (code, message) => ({ code, message });

/** The maintainer-applied PR label that authorizes giving coverage back. */
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
 * Load the base revision's contract and its parsed scenarios.
 *
 * The base is parsed against the UNION of the base's and the head's platform
 * vocabularies. Using head's alone would make a base scenario's `@web` read as
 * an unknown tag the moment a pull request deleted the web runner from
 * `runnerPlatforms` — which would turn "I deleted the runner that proved this"
 * into an invisible change rather than the coverage loss it is.
 * @param {string} root - Repo root.
 * @param {string} revision - Base commit-ish.
 * @param {ReadonlySet<string>} headPlatforms - The head contract's platforms.
 * @returns {{available: boolean, contract: object|null, scenarios: object[], scenarioIds: Set<string>}} Base state.
 */
export function loadBaseline(root, revision, headPlatforms = new Set()) {
  const raw = showAtRevision(root, revision, "bdd/coverage-map.json");
  let contract = null;
  if (raw !== null) {
    try {
      contract = JSON.parse(raw);
    } catch {
      contract = null;
    }
  }
  const documents = featureFilesAt(root, revision)
    .map(file => ({ file, source: showAtRevision(root, revision, file) }))
    .filter(document => document.source !== null);
  const platforms = new Set([
    ...declaredPlatforms(contract?.runnerPlatforms),
    ...headPlatforms,
  ]);
  return {
    available: raw !== null || documents.length > 0,
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
 * @param {object|null} contract - A coverage map.
 * @returns {Set<string>} Waived keys.
 */
function waivedKeys(contract) {
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
 * complete `retirements` record AND the maintainer-applied label. Either alone
 * is not an authorization — that is the whole point of asking for two
 * artifacts one author cannot produce by editing one file.
 * @param {object|undefined} record - The retirements entry, if any.
 * @param {readonly string[]} labels - PR labels.
 * @returns {boolean} True when the retirement is authorized and complete.
 */
function isRetired(record, labels) {
  if (!record || !labels.includes(BASELINE_LABEL)) return false;
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
 * @param {object} input - Baseline, head contract and scenarios, and PR labels.
 * @returns {object[]} Defects found.
 */
export function checkCoverageRegression({
  baseline,
  contract,
  scenarios,
  labels,
}) {
  const before = acceptedKeys(baseline.scenarios, baseline.contract);
  const after = acceptedKeys(scenarios, contract);
  const present = new Set(scenarios.map(scenario => scenario.id));
  const retired = new Map(
    (contract.retirements ?? []).map(entry => [entry.scenario, entry])
  );
  const waived = waivedKeys(contract);
  return [...before]
    .filter(key => !after.has(key) && present.has(partsOf(key).scenario))
    .sort()
    .flatMap(key => regressionDefect(key, { retired, waived, labels }));
}

/**
 * The defect for one obligation whose accepted coverage disappeared, or none
 * when it left the denominator through an authorized route.
 * @param {string} key - The `SCENARIO:platform` key.
 * @param {object} input - Retirement records, waived keys, and PR labels.
 * @returns {object[]} Zero or one defect.
 */
function regressionDefect(key, { retired, waived, labels }) {
  const { scenario, platform } = partsOf(key);
  if (isRetired(retired.get(scenario), labels)) return [];
  if (waived.has(key) && labels.includes(BASELINE_LABEL)) return [];
  return [
    defect(
      "coverage-regression",
      `${scenario}:${platform} was covered at the base revision and is not covered here. Coverage this repository already accepted cannot be handed back quietly. Restore the mapping, or take one of the two recorded routes out — a retirements record (${RETIREMENT_FIELDS.join(", ")}) for a behavior the product no longer has, or a platformWaivers entry for a runner that cannot decide it — and get the maintainer-applied "${BASELINE_LABEL}" label on this pull request. ${routeTaken(key, { retired, waived, labels })}`
    ),
  ];
}

/**
 * Say which half of the authorization is missing, so the operator is told what
 * to do rather than only what went wrong.
 * @param {string} key - The `SCENARIO:platform` key.
 * @param {object} input - Retirement records, waived keys, labels, contract.
 * @returns {string} A one-sentence next step.
 */
function routeTaken(key, { retired, waived, labels }) {
  const { scenario } = partsOf(key);
  const record = retired.get(scenario);
  const authorized = labels.includes(BASELINE_LABEL);
  if ((record || waived.has(key)) && !authorized) {
    return `A record is present but the "${BASELINE_LABEL}" label is not: recording a reduction in the same pull request that makes it is not an authorization.`;
  }
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
    .sort()
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
  const missing = RETIREMENT_FIELDS.filter(field => !record[field]);
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

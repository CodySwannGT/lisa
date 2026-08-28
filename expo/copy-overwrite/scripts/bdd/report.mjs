// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Build the BDD coverage report.
 *
 * The report keeps five different facts apart on purpose, because collapsing
 * them is how a "100% BDD coverage" headline comes to mean nothing:
 *
 *   1. `scenarios`     — behaviors DECLARED in Gherkin.
 *   2. `traceability`  — declared obligations MAPPED to an automated test
 *                        that still contains its evidence string.
 *   3. `execution`     — mapped tests that actually RAN in a supplied run.
 *   4. pass/fail/skip  — what those runs RETURNED.
 *   5. `waived`        — obligations deliberately outside the denominator.
 *
 * Traceability coverage is NOT execution coverage and NOT a pass rate. Every
 * label in this module says which one it is.
 *
 * @module scripts/bdd/report
 */
import {
  REPORT_SCHEMA_VERSION,
  byCodeUnit,
  runnersByPlatform,
  trackerUrl,
} from "./contract.mjs";
import { isDisclosed } from "./discover.mjs";

/** An empty discovery result, for callers that do not walk the tree. */
const NO_DISCOVERY = Object.freeze({ specs: [], runners: [], roots: [] });

/**
 * Summarize what walking the project's declared roots actually found.
 *
 * Traceability answers "is every declared behavior automated". This answers
 * the other direction — "is every automated test accounted for" — and the two
 * are not the same question: a repo can be at 100% traceability while carrying
 * end-to-end tests nobody has ever mapped to a behavior.
 * @param {object} discovery - The discovery result.
 * @param {object} contract - Parsed coverage map.
 * @returns {object} The report's `testInventory` block.
 */
function buildTestInventory(discovery, contract) {
  const undisclosed = discovery.specs.filter(
    spec => !isDisclosed(spec, contract)
  );
  return {
    note: "Tests found by walking the roots declared in testDiscovery. A discovered test must be named by a mapping or by an exclusion carrying a reason; anything else is an undisclosed test, not a clean repo.",
    runners: discovery.runners,
    roots: discovery.roots,
    discovered: discovery.specs.length,
    disclosed: discovery.specs.length - undisclosed.length,
    dynamicTitles: discovery.specs.filter(spec => spec.dynamic).length,
    undisclosed: undisclosed.map(spec => ({
      runner: spec.runner,
      platforms: spec.platforms,
      file: spec.file,
      evidence: spec.evidence,
    })),
    exclusions: (contract.exclusions ?? [])
      .map(exclusion => ({
        file: exclusion.file ?? null,
        evidence: exclusion.evidence ?? null,
        reason: exclusion.reason ?? null,
      }))
      .sort((a, b) =>
        `${a.file}${a.evidence}`.localeCompare(`${b.file}${b.evidence}`)
      ),
  };
}

/**
 * Summarize a subset of obligations against the covered set.
 *
 * An empty denominator reports `percentage: null`, never 100. "Nothing was
 * required here" and "everything required here is covered" are different
 * claims, and printing the second for the first is how a platform with no
 * obligations comes to look fully covered.
 *
 * `percentage` is ROUNDED FOR DISPLAY and `exact` is not. Only `exact` is ever
 * compared against a floor: 2000 of 2001 obligations is 99.95002%, which
 * rounds to 100.0, and a genuinely-below-floor platform reporting `ok: true`
 * because of a display convention is the same class of false headline this
 * whole report is built to prevent.
 * @param {readonly object[]} subset - Obligations to count.
 * @param {ReadonlySet<string>} coveredKeys - Keys with an aligned mapping.
 * @returns {object} Covered/total/percentage/exact.
 */
function summarize(subset, coveredKeys) {
  const covered = subset.filter(item => coveredKeys.has(item.key)).length;
  const exact = subset.length === 0 ? null : (covered / subset.length) * 100;
  return {
    covered,
    total: subset.length,
    percentage: exact === null ? null : Number(exact.toFixed(1)),
    exact,
  };
}

/**
 * Expand required scenarios into one obligation per scenario-platform pair.
 * @param {readonly object[]} scenarios - Parsed scenarios.
 * @param {Map<string, string[]>} platformRunners - Platform → configured runners.
 * @returns {object[]} Declared obligations.
 */
function declaredObligations(scenarios, platformRunners) {
  return scenarios
    .filter(scenario => scenario.required)
    .flatMap(scenario =>
      scenario.platforms.map(platform => ({
        key: `${scenario.id}:${platform}`,
        scenario,
        platform,
        runners: platformRunners.get(platform) ?? [],
      }))
    );
}

/**
 * Precedence when the same test reports more than once.
 *
 * Retries and sharded runs legitimately report a test twice. Last-write-wins
 * would let a `passed` retry bury the `failed` attempt that preceded it, and
 * the whole point of the execution block is that it cannot understate
 * failures. Higher wins.
 */
const STATUS_PRECEDENCE = Object.freeze({
  failed: 3,
  skipped: 2,
  passed: 1,
});

/**
 * Rank a result status, treating anything unrecognized as the most severe.
 *
 * Unknown is ranked ABOVE failed on purpose: a status this gate does not
 * understand must never be silently outranked by a `passed` from another
 * shard (allowlist, never denylist).
 * @param {string|undefined} status - A supplied result status.
 * @returns {number} Its precedence.
 */
function statusRank(status) {
  return STATUS_PRECEDENCE[status] ?? 4;
}

/**
 * Index supplied execution results by runner, file, and evidence.
 *
 * Exported so the matrix joins results exactly as the burndown does; two
 * private copies of this rule would eventually disagree about whether a test
 * failed.
 * @param {readonly object[]} runs - Parsed execution-result documents.
 * @returns {Map<string, object>} Lookup keyed by `runner|file|evidence`.
 */
export function indexResults(runs) {
  const index = new Map();
  for (const run of runs) {
    for (const result of run.results ?? []) {
      const key = `${run.runner}|${result.file}|${result.evidence}`;
      const existing = index.get(key);
      if (
        existing &&
        statusRank(existing.status) >= statusRank(result.status)
      ) {
        continue;
      }
      index.set(key, {
        ...result,
        runner: run.runner,
        runId: run.runId ?? null,
      });
    }
  }
  return index;
}

/**
 * Join mappings against supplied execution results.
 *
 * When no run evidence is supplied this returns `supplied: false` and no
 * counts at all — it never reports zeros that could be read as "nothing
 * passed" or ones that could be read as "everything ran".
 * @param {readonly object[]} mappings - Coverage-map mappings.
 * @param {readonly object[]} runs - Parsed execution-result documents.
 * @returns {object} The execution block of the report.
 */
export function buildExecution(mappings, runs) {
  if (runs.length === 0) {
    return {
      supplied: false,
      note: "No execution evidence supplied. Traceability below proves aligned automation exists, not that it ran or passed.",
      sources: [],
      mappedTests: distinctTests(mappings).length,
    };
  }
  const index = indexResults(runs);
  const tests = distinctTests(mappings);
  const outcomes = tests.map(test => ({
    ...test,
    result: index.get(`${test.runner}|${test.file}|${test.evidence}`) ?? null,
  }));
  const count = status =>
    outcomes.filter(item => item.result?.status === status).length;
  return {
    supplied: true,
    sources: runs
      .map(run => ({
        runner: run.runner,
        runId: run.runId ?? null,
        completedAt: run.completedAt ?? null,
        resultCount: (run.results ?? []).length,
      }))
      .sort((a, b) => a.runner.localeCompare(b.runner)),
    mappedTests: tests.length,
    executed: outcomes.filter(item => item.result !== null).length,
    passed: count("passed"),
    failed: count("failed"),
    skipped: count("skipped"),
    notRun: outcomes.filter(item => item.result === null).length,
    notRunTests: outcomes
      .filter(item => item.result === null)
      .map(item => `${item.runner} ${item.file} :: ${item.evidence}`)
      .sort(byCodeUnit),
  };
}

/**
 * The distinct automated tests the map points at.
 * @param {readonly object[]} mappings - Coverage-map mappings.
 * @returns {object[]} Distinct runner/file/evidence triples, sorted.
 */
function distinctTests(mappings) {
  const seen = new Map();
  for (const mapping of mappings ?? []) {
    const key = `${mapping.runner}|${mapping.file}|${mapping.evidence}`;
    if (!seen.has(key)) {
      seen.set(key, {
        runner: mapping.runner,
        file: mapping.file,
        evidence: mapping.evidence,
      });
    }
  }
  return [...seen.values()].sort((a, b) =>
    `${a.runner}${a.file}${a.evidence}`.localeCompare(
      `${b.runner}${b.file}${b.evidence}`
    )
  );
}

/**
 * A declared floor value, or the reason it is not usable.
 *
 * Only a finite number in 0..100 is a floor. Anything else — a quoted
 * `"19"`, a null, a NaN — is `invalid`, NOT "no floor": treating a bad value
 * as absent is what let a one-character edit remove a platform from
 * enforcement while producing no defect at all.
 * @param {unknown} declared - The raw `coverageFloor` entry.
 * @returns {{state: string, value: number|null}} The classified floor.
 */
function classifyFloor(declared) {
  if (declared === undefined) return { state: "unset", value: null };
  if (typeof declared !== "number" || !Number.isFinite(declared)) {
    return { state: "invalid", value: null };
  }
  if (declared < 0 || declared > 100) return { state: "invalid", value: null };
  return { state: "declared", value: declared };
}

/**
 * Evaluate the committed coverage floor per platform.
 * @param {object} contract - Parsed coverage map.
 * @param {object} byPlatform - Traceability summary per platform.
 * @param {ReadonlySet<string>} platforms - Declared platform vocabulary.
 * @returns {object} Floor evaluation, naming unset and invalid platforms.
 */
export function evaluateFloor(contract, byPlatform, platforms) {
  const floors = contract.coverageFloor ?? {};
  const entries = [...platforms].sort(byCodeUnit).map(platform => {
    const declared = classifyFloor(floors[platform]);
    // A platform with no obligations reports `null`, not 100. It cannot clear
    // a positive floor by having nothing to measure.
    const actual = byPlatform[platform]?.percentage ?? null;
    // The UNROUNDED value decides. `actual` above is the display figure and is
    // kept only so the report and the operator message agree with the rest of
    // the traceability block.
    const exact = byPlatform[platform]?.exact ?? null;
    return [
      platform,
      {
        floor: declared.value,
        state: declared.state,
        actual,
        exact,
        ok: isFloorMet(declared, exact),
      },
    ];
  });
  return {
    byPlatform: Object.fromEntries(entries),
    unset: entries
      .filter(([, value]) => value.state === "unset")
      .map(([name]) => name),
    invalid: entries
      .filter(([, value]) => value.state === "invalid")
      .map(([name]) => name),
    ok: entries.every(([, value]) => value.ok),
  };
}

/**
 * Whether a platform clears its floor.
 *
 * An invalid floor is never "met" — a bad value must fail rather than quietly
 * disable enforcement. An unset floor has nothing to clear here; the enforced
 * mode reports its absence separately.
 * @param {{state: string, value: number|null}} declared - The classified floor.
 * @param {number|null} actual - Measured UNROUNDED percentage, or null when there are no obligations.
 * @returns {boolean} Whether the floor is satisfied.
 */
function isFloorMet(declared, actual) {
  if (declared.state === "invalid") return false;
  if (declared.state === "unset") return true;
  if (actual === null) return declared.value === 0;
  return actual + 1e-9 >= declared.value;
}

/**
 * Collect every tracker reference declared across the contract.
 * @param {readonly object[]} scenarios - Parsed scenarios.
 * @param {object} trackers - `trackers` block of the coverage map.
 * @returns {object} Tag inventory with emitted links.
 */
export function buildTrackerIndex(scenarios, trackers) {
  const tags = new Map();
  for (const scenario of scenarios) {
    for (const reference of scenario.trackers) {
      const entry = tags.get(reference.tag) ?? {
        tag: reference.tag,
        url: trackerUrl(reference, trackers),
        scenarios: [],
      };
      entry.scenarios.push(scenario.id);
      tags.set(reference.tag, entry);
    }
  }
  return {
    scenariosWithTag: scenarios.filter(scenario => scenario.trackers.length > 0)
      .length,
    scenariosWithoutTag: scenarios.filter(
      scenario => scenario.trackers.length === 0
    ).length,
    tags: [...tags.values()]
      .map(entry => ({
        ...entry,
        scenarios: [...entry.scenarios].sort(byCodeUnit),
      }))
      .sort((a, b) => a.tag.localeCompare(b.tag)),
  };
}

/**
 * Build the whole machine-readable report.
 * @param {object} input - Scenarios, contract, execution runs, and platforms.
 * @returns {object} The report envelope.
 */
export function buildReport({
  scenarios,
  contract,
  runs,
  platforms,
  unresolved = new Set(),
  discovery = NO_DISCOVERY,
}) {
  const platformRunners = runnersByPlatform(contract.runnerPlatforms);
  const declared = declaredObligations(scenarios, platformRunners);
  const waivedKeys = new Set(
    (contract.platformWaivers ?? []).flatMap(waiver =>
      (waiver.platforms ?? []).map(platform => `${waiver.scenario}:${platform}`)
    )
  );
  const obligations = declared.filter(item => !waivedKeys.has(item.key));
  const coveredKeys = coverageKeys(scenarios, contract, unresolved);
  const byPlatform = Object.fromEntries(
    [...platforms].sort(byCodeUnit).map(platform => [
      platform,
      summarize(
        obligations.filter(item => item.platform === platform),
        coveredKeys
      ),
    ])
  );
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    asOf: contract.asOf ?? null,
    scenarios: countScenarios(scenarios),
    traceability: {
      note: "Obligations whose aligned automation is mapped AND whose evidence string still resolves — a mapping whose test was renamed or deleted stops counting here immediately, even in bootstrap where the matching defect is only a warning. This is TRACEABILITY coverage, not execution coverage and not a pass rate.",
      overall: summarize(obligations, coveredKeys),
      byPlatform,
      byRunner: byRunnerSummary(contract, obligations, coveredKeys),
    },
    execution: buildExecution(contract.mappings ?? [], runs),
    testInventory: buildTestInventory(discovery, contract),
    waived: waivedSummary(contract, scenarios, declared, waivedKeys),
    floor: evaluateFloor(contract, byPlatform, platforms),
    trackers: buildTrackerIndex(scenarios, contract.trackers),
    gaps: obligations
      .filter(item => !coveredKeys.has(item.key))
      .map(item => ({
        scenario: item.scenario.id,
        name: item.scenario.name,
        feature: item.scenario.feature,
        platform: item.platform,
        runners: item.runners,
      }))
      .sort((a, b) =>
        `${a.scenario}${a.platform}`.localeCompare(`${b.scenario}${b.platform}`)
      ),
  };
}

/**
 * Every scenario-platform key a mapping covers AND still proves.
 *
 * An obligation for which no mapping evidence still resolves is excluded here,
 * not merely reported. When a behavior has multiple aligned tests, one stale
 * supplemental mapping does not erase the proof supplied by another test; the
 * stale mapping remains its own failing defect.
 * @param {readonly object[]} scenarios - Parsed scenarios.
 * @param {object} contract - Parsed coverage map.
 * @param {ReadonlySet<string>} unresolved - Keys whose evidence no longer resolves.
 * @returns {Set<string>} Covered keys.
 */
function coverageKeys(scenarios, contract, unresolved) {
  const required = new Set(
    scenarios.filter(scenario => scenario.required).map(scenario => scenario.id)
  );
  const covered = new Set();
  for (const mapping of contract.mappings ?? []) {
    if (!required.has(mapping.scenario)) continue;
    for (const platform of mapping.platforms ?? []) {
      const key = `${mapping.scenario}:${platform}`;
      if (!unresolved.has(key)) covered.add(key);
    }
  }
  return covered;
}

/**
 * Count declared scenarios by lifecycle.
 * @param {readonly object[]} scenarios - Parsed scenarios.
 * @returns {object} Declaration counts.
 */
function countScenarios(scenarios) {
  const withTag = tag =>
    scenarios.filter(s => s.lifecycle.includes(tag)).length;
  return {
    declared: scenarios.length,
    required: scenarios.filter(scenario => scenario.required).length,
    excluded: scenarios.filter(scenario => !scenario.required).length,
    blocked: withTag("blocked"),
    referenceOnly: withTag("reference-only"),
    superseded: withTag("superseded"),
  };
}

/**
 * Traceability summary per configured runner.
 * @param {object} contract - Parsed coverage map.
 * @param {readonly object[]} obligations - Non-waived obligations.
 * @param {ReadonlySet<string>} coveredKeys - Covered keys.
 * @returns {object} Per-runner summaries.
 */
function byRunnerSummary(contract, obligations, coveredKeys) {
  return Object.fromEntries(
    Object.keys(contract.runnerPlatforms ?? {})
      .sort(byCodeUnit)
      .map(runner => [
        runner,
        summarize(
          obligations.filter(item => item.runners.includes(runner)),
          coveredKeys
        ),
      ])
  );
}

/**
 * Summarize waived obligations with the full IOU record.
 * @param {object} contract - Parsed coverage map.
 * @param {readonly object[]} scenarios - Parsed scenarios.
 * @param {readonly object[]} declared - All declared obligations.
 * @param {ReadonlySet<string>} waivedKeys - Waived keys.
 * @returns {object} Waiver summary.
 */
function waivedSummary(contract, scenarios, declared, waivedKeys) {
  const byId = new Map(scenarios.map(scenario => [scenario.id, scenario]));
  const effective = declared.filter(item => waivedKeys.has(item.key));
  const effectiveKeys = new Set(effective.map(item => item.key));
  return {
    note: "A waiver is a dated IOU with a named owner and a retiring ticket. It is never coverage.",
    count: effective.length,
    entries: (contract.platformWaivers ?? [])
      .map(waiver => ({
        scenario: waiver.scenario,
        name: byId.get(waiver.scenario)?.name ?? null,
        feature: byId.get(waiver.scenario)?.feature ?? null,
        platforms: (waiver.platforms ?? []).filter(platform =>
          effectiveKeys.has(`${waiver.scenario}:${platform}`)
        ),
        runner: waiver.runner ?? null,
        owner: waiver.owner ?? null,
        reason: waiver.reason ?? null,
        ticket: waiver.ticket ?? null,
        recordedAt: waiver.recordedAt ?? null,
        expiresAt: waiver.expiresAt ?? null,
      }))
      .filter(entry => entry.platforms.length > 0)
      .sort((a, b) => a.scenario.localeCompare(b.scenario)),
  };
}

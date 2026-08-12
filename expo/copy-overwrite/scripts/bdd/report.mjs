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
  runnersByPlatform,
  trackerUrl,
} from "./contract.mjs";

const percentage = (covered, total) =>
  total === 0 ? 100 : (covered / total) * 100;

/**
 * Summarize a subset of obligations against the covered set.
 * @param {readonly object[]} subset - Obligations to count.
 * @param {ReadonlySet<string>} coveredKeys - Keys with an aligned mapping.
 * @returns {object} Covered/total/percentage.
 */
function summarize(subset, coveredKeys) {
  const covered = subset.filter(item => coveredKeys.has(item.key)).length;
  return {
    covered,
    total: subset.length,
    percentage: Number(percentage(covered, subset.length).toFixed(1)),
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
 * Index supplied execution results by runner, file, and evidence.
 * @param {readonly object[]} runs - Parsed execution-result documents.
 * @returns {Map<string, object>} Lookup keyed by `runner|file|evidence`.
 */
function indexResults(runs) {
  const index = new Map();
  for (const run of runs) {
    for (const result of run.results ?? []) {
      index.set(`${run.runner}|${result.file}|${result.evidence}`, {
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
      .sort(),
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
 * Evaluate the committed coverage floor per platform.
 * @param {object} contract - Parsed coverage map.
 * @param {object} byPlatform - Traceability summary per platform.
 * @param {ReadonlySet<string>} platforms - Declared platform vocabulary.
 * @returns {object} Floor evaluation, including which platforms declared none.
 */
export function evaluateFloor(contract, byPlatform, platforms) {
  const floors = contract.coverageFloor ?? {};
  const entries = [...platforms].sort().map(platform => {
    const declared = floors[platform];
    const actual = byPlatform[platform]?.percentage ?? 100;
    return [
      platform,
      {
        floor: typeof declared === "number" ? declared : null,
        actual,
        ok: typeof declared !== "number" || actual + 1e-9 >= declared,
      },
    ];
  });
  return {
    byPlatform: Object.fromEntries(entries),
    unset: entries
      .filter(([, value]) => value.floor === null)
      .map(([name]) => name),
    ok: entries.every(([, value]) => value.ok),
  };
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
      .map(entry => ({ ...entry, scenarios: [...entry.scenarios].sort() }))
      .sort((a, b) => a.tag.localeCompare(b.tag)),
  };
}

/**
 * Build the whole machine-readable report.
 * @param {object} input - Scenarios, contract, execution runs, and platforms.
 * @returns {object} The report envelope.
 */
export function buildReport({ scenarios, contract, runs, platforms }) {
  const platformRunners = runnersByPlatform(contract.runnerPlatforms);
  const declared = declaredObligations(scenarios, platformRunners);
  const waivedKeys = new Set(
    (contract.platformWaivers ?? []).flatMap(waiver =>
      (waiver.platforms ?? []).map(platform => `${waiver.scenario}:${platform}`)
    )
  );
  const obligations = declared.filter(item => !waivedKeys.has(item.key));
  const coveredKeys = coverageKeys(scenarios, contract);
  const byPlatform = Object.fromEntries(
    [...platforms].sort().map(platform => [
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
      note: "Obligations whose aligned automation is mapped and whose evidence string still resolves. This is TRACEABILITY coverage, not execution coverage and not a pass rate.",
      overall: summarize(obligations, coveredKeys),
      byPlatform,
      byRunner: byRunnerSummary(contract, obligations, coveredKeys),
    },
    execution: buildExecution(contract.mappings ?? [], runs),
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
 * Every scenario-platform key an existing mapping covers.
 * @param {readonly object[]} scenarios - Parsed scenarios.
 * @param {object} contract - Parsed coverage map.
 * @returns {Set<string>} Covered keys.
 */
function coverageKeys(scenarios, contract) {
  const required = new Set(
    scenarios.filter(scenario => scenario.required).map(scenario => scenario.id)
  );
  const covered = new Set();
  for (const mapping of contract.mappings ?? []) {
    if (!required.has(mapping.scenario)) continue;
    for (const platform of mapping.platforms ?? []) {
      covered.add(`${mapping.scenario}:${platform}`);
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
      .sort()
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

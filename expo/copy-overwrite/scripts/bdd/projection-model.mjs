// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Feature-local facts, sharing the gate's genuine evidence and result joins. */
import { byCodeUnit, trackerUrl } from "./contract.mjs";
import { indexResults } from "./report.mjs";
import { evidenceResolves } from "./validate.mjs";
import {
  FEATURE_PROJECTION_SCHEMA,
  PROJECTION_GENERATOR,
  projectionSourceFile,
  validateProjectionCollisions,
} from "./projection-paths.mjs";

/** Malformed optional collections remain the original validator's concern. */
const list = value => (Array.isArray(value) ? value : []);
/** Stable local vocabulary without modifying the parsed declaration. */
const words = value => [...list(value)].sort(byCodeUnit);
/** Preserve complete associated records instead of substituting a boolean. */
const recordsFor = (records, id) =>
  list(records).filter(
    record =>
      record !== null && typeof record === "object" && record.scenario === id
  );

/** Avoid crashing reportable red input solely while constructing its paperwork. */
function referenceUrl(reference, trackers) {
  if (
    reference.scheme !== "gh" &&
    typeof trackers?.keyUrlTemplate !== "string"
  ) {
    return null;
  }
  return trackerUrl(reference, trackers);
}

/** Preserve supplied/absent/not-run and the original worst-result precedence. */
function mappingExecution(mapping, results, supplied) {
  if (!supplied)
    return { supplied: false, status: "not supplied", runId: null };
  const result = results.get(
    `${mapping.runner}|${mapping.file}|${mapping.evidence}`
  );
  return {
    supplied: true,
    status: result?.status ?? "not run",
    runId: result?.runId ?? null,
  };
}

/** Keep every declared mapping and its actual evidence verdict visible. */
function mappingRows(root, scenario, context) {
  return recordsFor(context.contract.mappings, scenario.id)
    .map(mapping => ({
      ...mapping,
      scenario: mapping.scenario ?? null,
      runner: mapping.runner ?? null,
      file: mapping.file ?? null,
      evidence: mapping.evidence ?? null,
      platforms: words(mapping.platforms),
      evidenceResolution: evidenceResolves(root, mapping, context.cache),
      execution: mappingExecution(mapping, context.results, context.supplied),
    }))
    .sort((left, right) =>
      byCodeUnit(
        JSON.stringify([left.runner, left.file, left.evidence, left.platforms]),
        JSON.stringify([
          right.runner,
          right.file,
          right.evidence,
          right.platforms,
        ])
      )
    );
}

/** A waiver is outside the obligation denominator and is never coverage. */
function obligation(platform, mappings, waivers, runnerPlatforms) {
  const waived = waivers.some(record =>
    list(record.platforms).includes(platform)
  );
  const covered =
    !waived &&
    mappings.some(
      mapping =>
        mapping.platforms.includes(platform) && mapping.evidenceResolution.ok
    );
  const runners = Object.keys(runnerPlatforms ?? {})
    .filter(runner => list(runnerPlatforms[runner]).includes(platform))
    .sort(byCodeUnit);
  return { platform, runners, covered, waived, gap: !covered && !waived };
}

/** One complete scenario row; no global tally, inventory or run roster. */
function scenarioRow(root, scenario, context) {
  const mappings = mappingRows(root, scenario, context);
  const waivers = recordsFor(context.contract.platformWaivers, scenario.id);
  return {
    id: scenario.id ?? null,
    name: scenario.name,
    feature: scenario.feature,
    line: scenario.line,
    featureLine: scenario.featureLine,
    tags: words(scenario.tags),
    ownTags: words(scenario.ownTags),
    inheritedTags: words(scenario.inheritedTags),
    featureIdTags: words(scenario.featureIdTags),
    platforms: words(scenario.platforms),
    lifecycle: words(scenario.lifecycle),
    required: scenario.required,
    provenance: words(scenario.provenance),
    trackers: list(scenario.trackers)
      .map(reference => ({
        ...reference,
        url: referenceUrl(reference, context.contract.trackers),
      }))
      .sort((left, right) => byCodeUnit(left.tag, right.tag)),
    primarySteps: [...list(scenario.primarySteps)],
    mappings,
    obligations: scenario.required
      ? words(scenario.platforms).map(platform =>
          obligation(
            platform,
            mappings,
            waivers,
            context.contract.runnerPlatforms
          )
        )
      : [],
    waivers,
    retirements: recordsFor(context.contract.retirements, scenario.id),
  };
}

/** Group by source path, never by a potentially duplicate Feature title. */
export function buildFeatureModels(
  root,
  { contract, scenarios, runs = [], cache = new Map() }
) {
  const sourcePaths = [...new Set(scenarios.map(scenario => scenario.file))];
  validateProjectionCollisions(sourcePaths);
  const context = {
    contract,
    cache,
    results: indexResults(runs),
    supplied: runs.length > 0,
  };
  return sourcePaths.sort(byCodeUnit).map(sourceFile => ({
    schemaVersion: FEATURE_PROJECTION_SCHEMA,
    generator: PROJECTION_GENERATOR,
    sourceFile: projectionSourceFile(sourceFile),
    scenarios: scenarios
      .filter(scenario => scenario.file === sourceFile)
      .sort((left, right) => left.line - right.line)
      .map(scenario => scenarioRow(root, scenario, context)),
  }));
}

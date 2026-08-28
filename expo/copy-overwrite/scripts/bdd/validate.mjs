// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Contract validators for the BDD gate.
 *
 * Every function returns a flat list of defects — `{code, message}` — so the
 * caller decides whether a defect is fatal (enforced) or advisory
 * (bootstrap). No validator ever exits or logs.
 *
 * @module scripts/bdd/validate
 */
import * as fs from "node:fs";

import { byCodeUnit, runnersByPlatform } from "./contract.mjs";
import { resolveInsideRepo } from "./parse.mjs";

/**
 * Build one defect record.
 * @param {string} code - Stable machine-readable defect code.
 * @param {string} message - Operator-readable description.
 * @returns {{code: string, message: string}} The defect.
 */
const defect = (code, message) => ({ code, message });

/**
 * Structural checks every scenario owes regardless of coverage.
 * @param {readonly object[]} scenarios - Parsed scenarios.
 * @param {ReadonlySet<string>} platforms - Declared platform vocabulary.
 * @returns {object[]} Defects found.
 */
export function validateScenarios(scenarios, platforms) {
  const defects = [];
  const seen = new Map();
  for (const scenario of scenarios) {
    const at = `${scenario.file}:${scenario.line}`;
    if (scenario.ids.length !== 1) {
      defects.push(
        defect(
          "scenario-id",
          `${at} must carry exactly one @BDD-DOMAIN-NNN tag`
        )
      );
    }
    if (scenario.platforms.length === 0) {
      defects.push(
        defect(
          "scenario-platform",
          `${at} declares no platform; expected one of ${[...platforms].sort(byCodeUnit).join(", ") || "(none configured)"}`
        )
      );
    }
    if (scenario.provenance.length === 0) {
      defects.push(
        defect(
          "scenario-provenance",
          `${at} declares no @figma-*/@ratified-* provenance`
        )
      );
    }
    if (scenario.lifecycle.length > 1) {
      defects.push(
        defect(
          "scenario-lifecycle",
          `${at} carries ${scenario.lifecycle.length} lifecycle tags (${scenario.lifecycle.join(", ")}); at most one is allowed`
        )
      );
    }
    defects.push(...missingSteps(scenario, at));
    defects.push(...featureLevelId(scenario));
    if (scenario.id) defects.push(...recordId(scenario, at, seen));
  }
  return [...new Map(defects.map(item => [item.message, item])).values()];
}

/**
 * Reject a `@BDD-*` id placed on the Feature rather than a Scenario.
 *
 * Gherkin would inherit it into every scenario in the file, handing them all
 * the same identity. IDs are per-behavior, so this is always a mistake — and
 * inheriting it silently would produce a pile of duplicate-ID defects that
 * never name the real cause.
 * @param {object} scenario - Parsed scenario.
 * @returns {object[]} Defects found.
 */
function featureLevelId(scenario) {
  return (scenario.featureIdTags ?? []).map(tag =>
    defect(
      "scenario-id",
      `${scenario.file}:${scenario.featureLine} declares @${tag} on the Feature; a scenario ID identifies one behavior and is never inherited`
    )
  );
}

/**
 * Require a primary Given/When/Then in each scenario.
 * @param {object} scenario - Parsed scenario.
 * @param {string} at - Source location.
 * @returns {object[]} Defects found.
 */
function missingSteps(scenario, at) {
  return ["Given", "When", "Then"]
    .filter(step => !scenario.primarySteps.includes(step))
    .map(step => defect("scenario-steps", `${at} has no primary ${step} step`));
}

/**
 * Reject duplicate scenario IDs across the whole contract.
 * @param {object} scenario - Parsed scenario.
 * @param {string} at - Source location.
 * @param {Map<string, string>} seen - Already-claimed IDs.
 * @returns {object[]} Defects found.
 */
function recordId(scenario, at, seen) {
  if (seen.has(scenario.id)) {
    return [
      defect(
        "scenario-duplicate-id",
        `${at} reuses ${scenario.id}, already declared at ${seen.get(scenario.id)}`
      ),
    ];
  }
  seen.set(scenario.id, at);
  return [];
}

/**
 * Validate tracker tags: syntax is universal, membership is per-repo.
 *
 * A tracker-shaped tag naming a key or repo the project never declared is an
 * ORPHAN — it links nowhere and silently breaks traceability, so it fails
 * rather than being ignored. Tracker liveness is never checked.
 * @param {readonly object[]} scenarios - Parsed scenarios.
 * @param {object} trackers - `trackers` block of the coverage map.
 * @returns {object[]} Defects found.
 */
export function validateTrackerTags(scenarios, trackers) {
  const keys = new Set(trackers?.keys ?? []);
  const repos = new Set(trackers?.github?.repos ?? []);
  const defaultRepo = trackers?.github?.defaultRepo ?? null;
  const required = trackers?.required === true;
  const defects = [];
  for (const scenario of scenarios) {
    const at = `${scenario.file}:${scenario.line}`;
    if (required && scenario.trackers.length === 0) {
      defects.push(
        defect(
          "tracker-missing",
          `${at} carries no tracker tag (trackers.required is true)`
        )
      );
    }
    for (const reference of scenario.trackers) {
      const orphan = orphanReason(reference, { keys, repos, defaultRepo });
      if (orphan) {
        defects.push(
          defect("tracker-orphan", `${at} @${reference.tag}: ${orphan}`)
        );
      }
    }
  }
  return defects;
}

/**
 * The reason a syntactically valid tracker tag points nowhere, if any.
 * @param {object} reference - Parsed tracker reference.
 * @param {object} declared - Declared keys, repos, and default repo.
 * @returns {string|undefined} The orphan reason, or undefined when resolvable.
 */
function orphanReason(reference, { keys, repos, defaultRepo }) {
  if (reference.scheme === "key") {
    return keys.has(reference.key)
      ? undefined
      : `unknown tracker key ${reference.key}; declare it in trackers.keys`;
  }
  const repo = reference.repo ?? defaultRepo;
  if (!repo) {
    return "no repo named and trackers.github.defaultRepo is unset";
  }
  return repos.has(repo)
    ? undefined
    : `unknown repo ${repo}; declare it in trackers.github.repos`;
}

/**
 * Validate every scenario→test mapping, including that its evidence still
 * exists inside the mapped file.
 * @param {object} input - Root, scenarios, and the parsed contract.
 * @returns {object[]} Defects found.
 */
export function validateMappings({
  root,
  scenarios,
  contract,
  cache = new Map(),
}) {
  const byId = new Map(scenarios.map(scenario => [scenario.id, scenario]));
  const platformRunners = runnersByPlatform(contract.runnerPlatforms);
  const defects = [];
  const seen = new Set();
  for (const [index, mapping] of (contract.mappings ?? []).entries()) {
    const at = `coverage-map.mappings[${index}] ${mapping.scenario ?? "(no scenario)"}`;
    const scenario = byId.get(mapping.scenario);
    if (!scenario) {
      defects.push(
        defect("mapping-orphan", `${at}: names a scenario that does not exist`)
      );
      continue;
    }
    if (!contract.runnerPlatforms?.[mapping.runner]) {
      defects.push(
        defect("mapping-runner", `${at}: unknown runner ${mapping.runner}`)
      );
      continue;
    }
    defects.push(...mappingDuplicates(mapping, at, seen));
    defects.push(...mappingPlatforms(mapping, scenario, platformRunners, at));
    defects.push(...mappingEvidence(root, mapping, at, cache));
  }
  return defects;
}

/**
 * Reject the exact same test claim twice.
 *
 * A behavior may legitimately have more than one aligned test in the same
 * runner. Coverage still counts the scenario-platform obligation once, while
 * every distinct file/evidence pair remains falsifiable and can carry its own
 * execution result.
 * @param {object} mapping - Raw mapping entry.
 * @param {string} at - Location label.
 * @param {Set<string>} seen - Already-claimed keys.
 * @returns {object[]} Defects found.
 */
function mappingDuplicates(mapping, at, seen) {
  const defects = [];
  for (const platform of mapping.platforms ?? []) {
    const obligation = `${mapping.scenario}:${mapping.runner}:${platform}`;
    const key = JSON.stringify([
      mapping.scenario,
      mapping.runner,
      platform,
      mapping.file,
      mapping.evidence,
    ]);
    if (seen.has(key)) {
      defects.push(
        defect(
          "mapping-duplicate",
          `${at}: duplicate mapping for ${obligation} with the same file and evidence`
        )
      );
    }
    seen.add(key);
  }
  return defects;
}

/**
 * Check a mapping only claims platforms the scenario requires and its runner
 * is configured to cover.
 * @param {object} mapping - Raw mapping entry.
 * @param {object} scenario - The scenario it names.
 * @param {Map<string, string[]>} platformRunners - Platform → configured runners.
 * @param {string} at - Location label.
 * @returns {object[]} Defects found.
 */
function mappingPlatforms(mapping, scenario, platformRunners, at) {
  if (!Array.isArray(mapping.platforms) || mapping.platforms.length === 0) {
    return [defect("mapping-platform", `${at}: claims no platforms`)];
  }
  const defects = [];
  for (const platform of mapping.platforms) {
    if (!scenario.platforms.includes(platform)) {
      defects.push(
        defect(
          "mapping-platform",
          `${at}: scenario does not require ${platform}`
        )
      );
    }
    if (!(platformRunners.get(platform) ?? []).includes(mapping.runner)) {
      defects.push(
        defect(
          "mapping-runner",
          `${at}: runner ${mapping.runner} is not configured for ${platform}`
        )
      );
    }
  }
  return defects;
}

/**
 * Whether a mapping's evidence string still resolves inside the repo.
 *
 * The single source of truth for "does this mapping still prove anything",
 * shared by the defect check and by the coverage count. Two separate answers
 * to that question is how a stale mapping comes to fail validation while
 * still counting as covered.
 * @param {string} root - Repo root.
 * @param {object} mapping - Raw mapping entry.
 * @param {Map<string, string>} [cache] - Optional file-content cache.
 * @returns {{ok: boolean, code?: string, detail?: string}} The verdict.
 */
export function evidenceResolves(root, mapping, cache = new Map()) {
  if (typeof mapping.evidence !== "string" || mapping.evidence.length === 0) {
    return {
      ok: false,
      code: "mapping-evidence",
      detail: "declares no evidence string",
    };
  }
  const resolved = resolveInsideRepo(root, mapping.file);
  if (!resolved.path) {
    return {
      ok: false,
      code: "mapping-file",
      detail: `${mapping.file} — ${resolved.error}`,
    };
  }
  if (!cache.has(resolved.path)) {
    cache.set(resolved.path, fs.readFileSync(resolved.path, "utf8"));
  }
  if (!cache.get(resolved.path).includes(mapping.evidence)) {
    return {
      ok: false,
      code: "mapping-evidence",
      detail: `${mapping.file} no longer contains ${JSON.stringify(mapping.evidence)}`,
    };
  }
  return { ok: true };
}

/**
 * The scenario-platform keys for which no mapping still proves anything.
 *
 * Coverage is counted from evidence that passes this check. A behavior with
 * several aligned tests remains covered while at least one resolves; when the
 * last one goes stale, the obligation immediately stops counting. Each stale
 * mapping is still reported independently as a defect.
 * @param {object} input - Root, contract, and an optional file cache.
 * @returns {Set<string>} Keys that must not be counted as covered.
 */
export function unresolvedEvidenceKeys({ root, contract, cache = new Map() }) {
  const resolvedByKey = new Map();
  for (const mapping of contract.mappings ?? []) {
    const resolves = evidenceResolves(root, mapping, cache).ok;
    for (const platform of mapping.platforms ?? []) {
      const key = `${mapping.scenario}:${platform}`;
      resolvedByKey.set(key, (resolvedByKey.get(key) ?? false) || resolves);
    }
  }
  return new Set(
    [...resolvedByKey].filter(([, resolves]) => !resolves).map(([key]) => key)
  );
}

/**
 * Prove the mapped file still contains the exact evidence string.
 *
 * This is what makes a mapping falsifiable rather than an assertion: rename
 * or delete the test and the map breaks loudly instead of leaving a scenario
 * silently unguarded.
 * @param {string} root - Repo root.
 * @param {object} mapping - Raw mapping entry.
 * @param {string} at - Location label.
 * @param {Map<string, string>} cache - File-content cache.
 * @returns {object[]} Defects found.
 */
function mappingEvidence(root, mapping, at, cache) {
  const verdict = evidenceResolves(root, mapping, cache);
  return verdict.ok ? [] : [defect(verdict.code, `${at}: ${verdict.detail}`)];
}

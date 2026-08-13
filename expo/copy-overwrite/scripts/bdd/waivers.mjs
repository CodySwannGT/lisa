/**
 * Waiver validation.
 *
 * A waiver is a dated IOU, never coverage. It leaves the denominator, so the
 * bookkeeping it owes is strict: who owns it, why, which ticket retires it,
 * and when it expires. An IOU nobody owns and that never comes due is just a
 * quieter coverage gap.
 *
 * @module scripts/bdd/waivers
 */
import { parseTrackerTag, runnersByPlatform } from "./contract.mjs";

const defect = (code, message) => ({ code, message });

/** Bookkeeping every waiver owes whoever has to re-litigate it later. */
const REQUIRED_FIELDS = [
  "reason",
  "owner",
  "ticket",
  "recordedAt",
  "expiresAt",
];

/** ISO calendar date, the only accepted date shape. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate every waiver in the coverage map.
 * @param {object} input - Scenarios, contract, and the evaluation date.
 * @returns {object[]} Defects found.
 */
export function validateWaivers({ scenarios, contract, today }) {
  const byId = new Map(scenarios.map(scenario => [scenario.id, scenario]));
  const platformRunners = runnersByPlatform(contract.runnerPlatforms);
  const mapped = mappedKeys(contract);
  const seen = new Set();
  const defects = [];
  for (const [index, waiver] of (contract.platformWaivers ?? []).entries()) {
    const at = `coverage-map.platformWaivers[${index}] ${waiver.scenario ?? "(no scenario)"}`;
    const scenario = byId.get(waiver.scenario);
    const blocking = blockingError(waiver, scenario, at);
    if (blocking) {
      defects.push(blocking);
      continue;
    }
    defects.push(...metadataDefects(waiver, at, today));
    defects.push(...runnerDefects(waiver, platformRunners, at));
    defects.push(...platformDefects(waiver, scenario, { mapped, seen }, at));
  }
  return defects;
}

/**
 * Every `SCENARIO:platform` a mapping already claims.
 * @param {object} contract - Parsed coverage map.
 * @returns {Set<string>} Claimed keys.
 */
function mappedKeys(contract) {
  return new Set(
    (contract.mappings ?? []).flatMap(mapping =>
      (mapping.platforms ?? []).map(
        platform => `${mapping.scenario}:${platform}`
      )
    )
  );
}

/**
 * The one problem that makes a waiver unusable, so its other checks are moot.
 * @param {object} waiver - Raw waiver entry.
 * @param {object|undefined} scenario - The scenario it names, if it exists.
 * @param {string} at - Location label.
 * @returns {object|undefined} The blocking defect, or undefined.
 */
function blockingError(waiver, scenario, at) {
  if (!scenario) {
    return defect(
      "waiver-orphan",
      `${at}: names a scenario that does not exist`
    );
  }
  if (!scenario.required) {
    return defect(
      "waiver-excluded",
      `${at}: scenario is already out of the denominator (${scenario.lifecycle.join(", ")})`
    );
  }
  if (!Array.isArray(waiver.platforms) || waiver.platforms.length === 0) {
    return defect("waiver-platform", `${at}: claims no platforms`);
  }
  return undefined;
}

/**
 * Require the full owner/reason/ticket/expiry record, and refuse an expired
 * waiver — the time-box is what stops an IOU from becoming permanent.
 * @param {object} waiver - Raw waiver entry.
 * @param {string} at - Location label.
 * @param {string} today - ISO date the run is evaluated against.
 * @returns {object[]} Defects found.
 */
function metadataDefects(waiver, at, today) {
  const defects = REQUIRED_FIELDS.filter(field => !waiver[field]).map(field =>
    defect("waiver-metadata", `${at}: has no ${field}`)
  );
  for (const field of ["recordedAt", "expiresAt"]) {
    if (waiver[field] && !ISO_DATE.test(waiver[field])) {
      defects.push(
        defect(
          "waiver-metadata",
          `${at}: ${field} must be an ISO date (YYYY-MM-DD)`
        )
      );
    }
  }
  if (
    waiver.ticket &&
    !parseTrackerTag(String(waiver.ticket).replace(/^@/, ""))
  ) {
    defects.push(
      defect(
        "waiver-metadata",
        `${at}: ticket ${waiver.ticket} is not a valid tracker reference`
      )
    );
  }
  if (
    waiver.expiresAt &&
    ISO_DATE.test(waiver.expiresAt) &&
    waiver.expiresAt < today
  ) {
    defects.push(
      defect(
        "waiver-expired",
        `${at}: expired on ${waiver.expiresAt}; retire it or re-authorize it`
      )
    );
  }
  return defects;
}

/**
 * A waiver says a RUNNER cannot decide a behavior, so when a platform has
 * more than one configured runner the waiver must name which one.
 * @param {object} waiver - Raw waiver entry.
 * @param {Map<string, string[]>} platformRunners - Platform → configured runners.
 * @param {string} at - Location label.
 * @returns {object[]} Defects found.
 */
function runnerDefects(waiver, platformRunners, at) {
  const ambiguous = waiver.platforms.filter(
    platform => (platformRunners.get(platform) ?? []).length > 1
  );
  if (!waiver.runner) {
    return ambiguous.length === 0
      ? []
      : [
          defect(
            "waiver-runner",
            `${at}: ${ambiguous.join(", ")} has multiple configured runners, so the waiver must name one`
          ),
        ];
  }
  return waiver.platforms
    .filter(
      platform => !(platformRunners.get(platform) ?? []).includes(waiver.runner)
    )
    .map(platform =>
      defect(
        "waiver-runner",
        `${at}: runner ${waiver.runner} does not cover ${platform}`
      )
    );
}

/**
 * Per-platform problems on one usable waiver, recording accepted keys so the
 * duplicate check works across waivers.
 * @param {object} waiver - Raw waiver entry.
 * @param {object} scenario - The scenario it names.
 * @param {{mapped: Set<string>, seen: Set<string>}} keys - Claimed and already-seen keys.
 * @param {string} at - Location label.
 * @returns {object[]} Defects found.
 */
function platformDefects(waiver, scenario, { mapped, seen }, at) {
  const defects = [];
  for (const platform of waiver.platforms) {
    const key = `${waiver.scenario}:${platform}`;
    if (!scenario.platforms.includes(platform)) {
      defects.push(
        defect(
          "waiver-platform",
          `${at}: claims undeclared platform ${platform}`
        )
      );
      continue;
    }
    if (mapped.has(key)) {
      defects.push(
        defect("waiver-masks-mapping", `${at}: ${key} already has a mapping`)
      );
    }
    if (seen.has(key))
      defects.push(
        defect("waiver-duplicate", `${at}: duplicate waiver for ${key}`)
      );
    seen.add(key);
  }
  return defects;
}

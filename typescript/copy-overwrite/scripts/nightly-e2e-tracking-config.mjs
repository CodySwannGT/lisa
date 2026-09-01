// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Public configuration and provider dispatch for nightly-E2E tracking.
 *
 * @module scripts/nightly-e2e-tracking-config
 */
export const MAX_TRACKING_DIAGNOSTIC = 4096;
export const TRACKING_DESTINATIONS = Object.freeze([
  "github",
  "sentry",
  "jira",
  "linear",
  "none",
]);
const PROVIDER_WORKFLOWS = Object.freeze({
  github: ".github/workflows/create-github-issue-on-failure.yml",
  sentry: ".github/workflows/create-sentry-issue-on-failure.yml",
  jira: ".github/workflows/create-jira-issue-on-failure.yml",
  linear: ".github/workflows/create-linear-issue-on-failure.yml",
});
const PROVIDER_SECRETS = Object.freeze({
  github: ["PAT"],
  sentry: ["SENTRY_AUTH_TOKEN"],
  jira: ["JIRA_API_TOKEN"],
  linear: ["LINEAR_API_KEY"],
});

/** Return whether a value is a plain object. */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Throw a stable diagnostic which contains no rejected value. */
export function refuseTracking(message) {
  throw new Error(message.slice(0, MAX_TRACKING_DIAGNOSTIC));
}

/** Read one non-empty string from a selected provider block. */
function requiredString(record, key, pathName) {
  const prefix =
    "nightlyE2E.tracking.destination supports " +
    "github, sentry, jira, linear, none";
  if (!isRecord(record)) {
    refuseTracking(`${prefix}; ${pathName} must be an object`);
  }
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    refuseTracking(`${prefix}; ${pathName}.${key} must be a non-empty string`);
  }
  return value;
}

/** Resolve a selected provider's existing project configuration. */
function resolveProvider(config, destination) {
  if (destination === "github") {
    return Object.freeze({
      org: requiredString(config.github, "org", "github"),
      repo: requiredString(config.github, "repo", "github"),
    });
  }
  if (destination === "sentry") {
    return Object.freeze({
      org: requiredString(config.sentry, "org", "sentry"),
      project: requiredString(config.sentry, "project", "sentry"),
    });
  }
  if (destination === "jira") {
    return Object.freeze({
      jira: Object.freeze({
        ...config.jira,
        project: requiredString(config.jira, "project", "jira"),
      }),
      atlassian: Object.freeze({
        ...config.atlassian,
        site: requiredString(config.atlassian, "site", "atlassian"),
      }),
    });
  }
  return Object.freeze({
    ...config.linear,
    teamKey: requiredString(config.linear, "teamKey", "linear"),
  });
}

/** Resolve the public destination and reuse its existing provider block. */
export function resolveNightlyTrackingConfig(config) {
  if (!isRecord(config)) refuseTracking("project config must be an object");
  if (!("nightlyE2E" in config)) {
    return Object.freeze({ destination: "none", provider: null });
  }
  if (!isRecord(config.nightlyE2E)) {
    refuseTracking("nightlyE2E must be an object");
  }
  if (!("tracking" in config.nightlyE2E)) {
    return Object.freeze({ destination: "none", provider: null });
  }
  if (!isRecord(config.nightlyE2E.tracking)) {
    refuseTracking("nightlyE2E.tracking must be an object");
  }
  const destination =
    "destination" in config.nightlyE2E.tracking
      ? config.nightlyE2E.tracking.destination
      : "none";
  if (!TRACKING_DESTINATIONS.includes(destination)) {
    refuseTracking(
      "nightlyE2E.tracking.destination must be one of " +
        "github, sentry, jira, linear, none"
    );
  }
  return Object.freeze({
    destination,
    provider:
      destination === "none" ? null : resolveProvider(config, destination),
  });
}

/** Build the exact handoff consumed by the selected provider workflow. */
export function buildProviderDispatch(settings, plan) {
  const { destination, provider } = settings;
  if (destination === "none" || !provider) {
    refuseTracking("requested destination none has no provider dispatch");
  }
  const inputs = {
    workflow_name: "Nightly E2E condition",
    tracking_action: plan.action,
    tracking_marker: plan.marker,
    tracking_title: plan.title ?? "",
    tracking_body: plan.body ?? "",
    tracking_id: plan.trackerId ?? "",
  };
  if (destination === "sentry") {
    inputs.SENTRY_ORG = provider.org;
    inputs.SENTRY_PROJECT = provider.project;
  } else if (destination === "jira") {
    inputs.JIRA_BASE_URL = `https://${provider.atlassian.site}`;
    inputs.JIRA_USER_EMAIL = provider.atlassian.email ?? "";
    inputs.JIRA_PROJECT_KEY = provider.jira.project;
  } else if (destination === "linear") {
    inputs.team_key = provider.teamKey;
  }
  return Object.freeze({
    destination,
    workflow: PROVIDER_WORKFLOWS[destination],
    inputs: Object.freeze(inputs),
    secrets: Object.freeze([...PROVIDER_SECRETS[destination]]),
  });
}

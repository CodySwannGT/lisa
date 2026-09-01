#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Resolve and reconcile one nightly-E2E condition across provider adapters.
 *
 * @module scripts/reconcile-nightly-e2e-tracking
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
  MAX_TRACKING_DIAGNOSTIC,
  TRACKING_DESTINATIONS,
  buildProviderDispatch,
  refuseTracking as refuse,
  resolveNightlyTrackingConfig,
} from "./nightly-e2e-tracking-config.mjs";
import { runTrackingPlan } from "./reconcile-nightly-e2e-tracking-cli.mjs";

export {
  TRACKING_DESTINATIONS,
  buildProviderDispatch,
  resolveNightlyTrackingConfig,
};
export const TRACKED_SUITE_LABELS = Object.freeze([
  "🎭 Playwright Web E2E",
  "📱 Maestro Native E2E",
]);
export const CONDITION_MARKER = "<!-- lisa_nightly_e2e_condition:v1 -->";

/** Validate exact suite and tracker authority before deriving any action. */
function validateAuthority(findings, trackers) {
  const exactSuiteMessage =
    "findings must contain exactly Playwright Web E2E and Maestro Native E2E";
  if (!Array.isArray(findings) || findings.length !== 2) {
    refuse(exactSuiteMessage);
  }
  const labels = findings.map(finding => finding?.label).sort();
  const expected = [...TRACKED_SUITE_LABELS].sort();
  if (JSON.stringify(labels) !== JSON.stringify(expected)) {
    refuse(exactSuiteMessage);
  }
  if (!Array.isArray(trackers)) refuse("tracker list must be an array");
  if (trackers.some(tracker => tracker?.marker !== CONDITION_MARKER)) {
    refuse("tracker adapter returned a record outside marker authority");
  }
  if (trackers.length > 1) refuse("multiple matching condition trackers found");
}

/** Produce one destination-neutral create, refresh, close, or no-op plan. */
export function planCombinedTracking(findings, trackers) {
  validateAuthority(findings, trackers);
  const incomplete = findings.some(
    finding => !finding.complete || finding.state === "unknown"
  );
  if (incomplete) {
    return Object.freeze({
      action: "none",
      marker: CONDITION_MARKER,
      trackerId: null,
      title: null,
      body: null,
      pin: null,
      reason: "incomplete_evidence",
    });
  }
  const existing = trackers[0] ?? null;
  const red = findings.some(finding => finding.state === "fail");
  if (!red && !existing) {
    return Object.freeze({
      action: "none",
      marker: CONDITION_MARKER,
      trackerId: null,
      title: null,
      body: null,
      pin: null,
      reason: "both_suites_green",
    });
  }
  if (!red) {
    return Object.freeze({
      action: "close",
      marker: CONDITION_MARKER,
      trackerId: existing.id,
      title: null,
      body: null,
      pin: false,
      reason: "both_suites_green",
    });
  }
  const status = findings.map(
    finding =>
      `- **${finding.label}**: ${finding.state} ([run](${finding.runUrl}))`
  );
  return Object.freeze({
    action: existing ? "refresh" : "create",
    marker: CONDITION_MARKER,
    trackerId: existing?.id ?? null,
    title: "Nightly E2E condition is red",
    body: `${CONDITION_MARKER}\n## Nightly E2E condition\n\n${status.join("\n")}`,
    pin: true,
    reason: "at_least_one_suite_red",
  });
}

/** Convert a provider exception into a bounded, secret-free classification. */
function providerFailure(destination, action, error) {
  const raw = error instanceof Error ? error.message : String(error);
  const status =
    raw.match(/\bHTTP\s+\d{3}\b/iu)?.[0] ??
    raw.match(/\breadback\b.*\bauthority\b/iu)?.[0] ??
    (raw.includes("success false") ? "success false" : undefined) ??
    (raw.includes("refused") ? "refused" : "provider error");
  return new Error(
    `Requested ${destination} destination ${action} failed: ${status}`.slice(
      0,
      MAX_TRACKING_DIAGNOSTIC
    )
  );
}

/** Invoke one adapter action and wrap its errors at the trust boundary. */
async function providerCall(destination, action, invoke) {
  try {
    return await invoke();
  } catch (error) {
    throw providerFailure(destination, action, error);
  }
}

/** Reconcile the combined condition through exactly one selected adapter. */
export async function reconcileCombinedTracking(input) {
  const settings = resolveNightlyTrackingConfig(input.config);
  if (settings.destination === "none") {
    return Object.freeze({
      destination: "none",
      action: "skipped",
      trackerId: null,
      reason: "tracking_disabled",
    });
  }
  const destination = settings.destination;
  const adapters = input.adapters ?? {};
  const adapter = adapters[destination];
  if (!adapter) refuse(`${destination} adapter is unavailable`);
  const trackers = await providerCall(destination, "list", () =>
    adapter.list(CONDITION_MARKER)
  );
  const plan = planCombinedTracking(input.findings, trackers);
  if (plan.action === "none") {
    return Object.freeze({
      destination,
      action: "none",
      trackerId: null,
      reason: plan.reason,
    });
  }
  if (plan.action === "create") {
    const tracker = await providerCall(destination, "create", () =>
      adapter.create(plan)
    );
    if (adapter.pin) {
      await providerCall(destination, "pin", () => adapter.pin(tracker.id));
    }
    return Object.freeze({
      destination,
      action: "create",
      trackerId: tracker.id,
      reason: plan.reason,
    });
  }
  if (plan.action === "refresh") {
    const tracker = await providerCall(destination, "refresh", () =>
      adapter.refresh(plan.trackerId, plan)
    );
    if (adapter.pin) {
      await providerCall(destination, "pin", () => adapter.pin(tracker.id));
    }
    return Object.freeze({
      destination,
      action: "refresh",
      trackerId: tracker.id,
      reason: plan.reason,
    });
  }
  if (adapter.unpin) {
    await providerCall(destination, "unpin", () =>
      adapter.unpin(plan.trackerId)
    );
  }
  await providerCall(destination, "close", () => adapter.close(plan.trackerId));
  return Object.freeze({
    destination,
    action: "close",
    trackerId: plan.trackerId,
    reason: plan.reason,
  });
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  if (!process.argv.includes("--plan")) refuse("expected --plan");
  runTrackingPlan({
    resolveConfig: resolveNightlyTrackingConfig,
    plan: planCombinedTracking,
  });
}

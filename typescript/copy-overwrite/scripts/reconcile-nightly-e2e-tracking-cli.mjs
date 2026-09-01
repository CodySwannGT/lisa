// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * GitHub Actions output adapter for the nightly-E2E tracking planner.
 *
 * @module scripts/reconcile-nightly-e2e-tracking-cli
 */
import * as fs from "node:fs";
import { randomUUID } from "node:crypto";

/** Append one GitHub Actions output without command injection. */
function appendOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) throw new Error("GITHUB_OUTPUT is required in --plan mode");
  let delimiter = `LISA_${name}_${randomUUID()}`;
  while (String(value).includes(delimiter)) {
    delimiter = `LISA_${name}_${randomUUID()}`;
  }
  fs.appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

/**
 * Resolve config/findings into provider-job outputs.
 *
 * @param input - Pure config and plan functions
 */
export function runTrackingPlan(input) {
  const configPath = process.env.LISA_CONFIG_PATH ?? ".lisa.config.json";
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const findings = JSON.parse(process.env.NIGHTLY_E2E_FINDINGS ?? "[]");
  const settings = input.resolveConfig(config);
  const plan = input.plan(findings, []);
  let destination = settings.destination;
  let action = plan.action === "refresh" ? "create" : plan.action;
  if (settings.destination === "none") {
    action = "none";
  } else if (plan.action === "none" && plan.reason === "both_suites_green") {
    action = "close";
  } else if (plan.action === "none") {
    destination = "none";
  }
  appendOutput("destination", destination);
  appendOutput("tracking_action", action);
  appendOutput("tracking_marker", plan.marker);
  appendOutput("tracking_title", plan.title ?? "");
  appendOutput("tracking_body", plan.body ?? "");
  appendOutput("tracking_id", plan.trackerId ?? "");
  appendOutput("provider_json", JSON.stringify(settings.provider ?? {}));
  appendOutput("tracking_findings", JSON.stringify(findings));
  if (settings.destination === "none") {
    console.log("tracking_disabled");
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) fs.appendFileSync(summary, "tracking_disabled\n");
  }
}

#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Provider transport for the combined nightly-E2E condition tracker.
 *
 * @module scripts/nightly-e2e-provider-action
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
  reconcileCombinedTracking,
  resolveNightlyTrackingConfig,
} from "./reconcile-nightly-e2e-tracking.mjs";
import {
  githubAdapter,
  jiraAdapter,
} from "./nightly-e2e-provider-github-jira.mjs";
import {
  linearAdapter,
  sentryAdapter,
} from "./nightly-e2e-provider-linear-sentry.mjs";
import { fetchJson } from "./nightly-e2e-provider-support.mjs";

/** Build only the selected provider adapter. */
function selectedAdapter(destination, input) {
  return {
    github: githubAdapter,
    jira: jiraAdapter,
    linear: linearAdapter,
    sentry: sentryAdapter,
  }[destination](input);
}

/** Reconcile the selected real provider through the common state machine. */
export async function runProviderAction(input) {
  const settings = resolveNightlyTrackingConfig(input.config);
  const adapters =
    settings.destination === "none"
      ? {}
      : {
          [settings.destination]: selectedAdapter(settings.destination, input),
        };
  return await reconcileCombinedTracking({
    config: input.config,
    findings: input.findings,
    adapters,
  });
}

/** Execute from environment and print only the bounded result. */
async function main() {
  const configPath = process.env.LISA_CONFIG_PATH ?? ".lisa.config.json";
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const findings = JSON.parse(process.env.NIGHTLY_E2E_FINDINGS ?? "[]");
  const result = await runProviderAction({
    config,
    findings,
    env: process.env,
    request: fetchJson,
  });
  console.log(JSON.stringify(result));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  await main();
}

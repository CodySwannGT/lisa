#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * @file lisa-rails-prepush.mjs
 * @description Buffer Git stdin once so traceability runs even when scanning blocks.
 * @module history-secrets
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
const invocation = await import("./lib/invoked-as-script.mjs").catch(
  () => null
);
let bootstrapReady = typeof invocation?.invokedAsScript === "function";
const scripts = dirname(fileURLToPath(import.meta.url));
/** Guard managed bootstrap errors and preserve both consumers of the original stdin. */
export const main = async (remoteArgs = process.argv.slice(2)) => {
  let input;
  try {
    input = readFileSync(0);
  } catch {
    console.error(
      "Managed push input is unreadable. Retry with Git's original complete stdin stream."
    );
    return 1;
  }
  let failed = !bootstrapReady;
  try {
    const { historyPolicy } = await import("./lib/history-secret-policy.mjs");
    if (!historyPolicy(process.cwd(), "push")) {
      console.error(
        "Managed Rails history scanning requires its authored property. Run full Lisa apply to declare the required push route."
      );
      failed = true;
    }
  } catch {
    console.error(
      "Managed Rails history policy is invalid or unavailable. Repair project JSON and run full Lisa apply; scanning and traceability still execute."
    );
    failed = true;
  }
  const name = "lisa-work-item.mjs";
  const args = ["validate-push", ...remoteArgs];
  try {
    const result = spawnSync(process.execPath, [join(scripts, name), ...args], {
      input,
      encoding: "utf8",
      timeout: 300000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status !== 0) {
      console.error(
        "Work-item traceability failed. Repair the bound work item and introduced commit trailers; raw traceability output is withheld from the history-scanner boundary."
      );
      failed = true;
    }
    if (result.error || result.signal) throw new Error("Command failed");
  } catch {
    console.error(
      "Managed push command failed or timed out. Repair managed tooling and retry; raw process errors are withheld."
    );
    failed = true;
  }
  try {
    // Import/call inside this boundary instead of forwarding raw Node bootstrap
    // stderr. The scanner receives exactly the buffered Git stream.
    const { main: scan } = await import("./lisa-history-secrets.mjs");
    // Git's remote arguments bound a new ref's range by what that remote
    // already holds; without them a new branch rescans the whole history.
    if ((await scan(["pre-push", ...remoteArgs], process.cwd(), input)) !== 0)
      failed = true;
  } catch {
    console.error(
      "Managed history scanner is unavailable or damaged. Run full Lisa apply and retry; raw bootstrap errors are withheld."
    );
    failed = true;
  }
  return failed ? 1 : 0;
};
try {
  if (!bootstrapReady) throw new Error("Managed bootstrap unavailable");
  if (invocation.invokedAsScript(import.meta.url))
    process.exitCode = await main();
} catch {
  bootstrapReady = false;
  console.error(
    "Managed Rails push bootstrap is unavailable. Run full Lisa apply and retry; raw module errors are withheld."
  );
  process.exitCode = 1;
}

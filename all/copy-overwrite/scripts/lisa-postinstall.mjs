#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import { join } from "node:path";

// Preserve the names older consumers could import from this shipped script.
export const APPLY_FAILURE_MARKER = join(
  "node_modules",
  ".lisa",
  "apply-failed.json"
);

// Keep the entry point used by existing host package.json hooks. Installation
// updates the dependency; only an explicit lisa apply updates project templates.
// Do not create an apply receipt or clear an earlier failure: no apply ran.
/**
 * Print the next step without applying templates or changing prior evidence.
 * @param {string} [_cwd] Legacy project-root argument, no longer used.
 * @param {NodeJS.ProcessEnv} [_env] Legacy environment argument, no longer used.
 * @returns {void}
 */
export function runPostinstall(_cwd = process.cwd(), _env = process.env) {
  console.log(
    "lisa: installation leaves project templates unchanged. Run `lisa apply .` " +
      "to apply updates, or `lisa doctor` to check freshness."
  );
}

if (invokedAsScript(import.meta.url)) {
  runPostinstall();
  // Let piped output flush before the package manager continues.
  process.exitCode = 0;
}

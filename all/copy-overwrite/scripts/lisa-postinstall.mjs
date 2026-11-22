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
  // Name the missing plugin registration outright (#4504): nothing here runs
  // `claude plugin install`, so a fresh clone has no Lisa commands until the
  // operator runs `lisa apply .` in it.
  console.log(
    "lisa: installation leaves unrelated project templates unchanged, and Claude Code " +
      "plugins are not registered by dependency install. Run `lisa apply .` in this " +
      "project to register them and apply updates, or `lisa doctor` to check freshness."
  );
}

if (invokedAsScript(import.meta.url)) {
  runPostinstall();
  // Let piped output flush before the package manager continues.
  process.exitCode = 0;
}

#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

// Preserve the names older consumers could import from this shipped script.
export const APPLY_FAILURE_MARKER = join(
  "node_modules",
  ".lisa",
  "apply-failed.json"
);

// Keep the entry point used by existing host package.json hooks. Installation
// retires the safety net; an explicit lisa apply updates unrelated templates.
// Do not create an apply receipt or clear an earlier failure: no apply ran.
/**
 * Print the next step without applying templates or changing prior evidence.
 * @param {string} [cwd] Project root
 * @param {NodeJS.ProcessEnv} [env] Lifecycle environment
 * @returns {void}
 */
export function runPostinstall(cwd = process.cwd(), env = process.env) {
  const retirement = join(
    cwd,
    "node_modules/@codyswann/lisa/scripts/retire-native-safety-net.mjs"
  );
  if (existsSync(retirement))
    execFileSync(process.execPath, [retirement, cwd], {
      env,
      stdio: "inherit",
    });
  console.log(
    "lisa: installation leaves unrelated project templates unchanged. Run `lisa apply .` " +
      "to apply updates, or `lisa doctor` to check freshness."
  );
}

if (invokedAsScript(import.meta.url)) {
  runPostinstall();
  // Let piped output flush before the package manager continues.
  process.exitCode = 0;
}

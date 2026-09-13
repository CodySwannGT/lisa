#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

// Keep the entry point used by existing host package.json hooks. Installation
// updates the dependency; only an explicit lisa apply updates project templates.
// Do not create an apply receipt or clear an earlier failure: no apply ran.
if (invokedAsScript(import.meta.url)) {
  console.log(
    "lisa: installation leaves project templates unchanged. Run `lisa apply .` " +
      "to apply updates, or `lisa doctor` to check freshness."
  );
  // Let piped output flush before the package manager continues.
  process.exitCode = 0;
}

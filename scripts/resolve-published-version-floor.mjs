#!/usr/bin/env node
/**
 * Lisa's own entry point for the shipped published-version-floor resolution.
 *
 * `release.yml` runs `node scripts/resolve-published-version-floor.mjs`, and
 * that path is the CALLER's tree: `release.yml` is a reusable workflow, so in a
 * host project `lisa apply` writes the script from `all/copy-overwrite/scripts/`
 * and in this repository it is this file. Without it, Lisa's own release is the
 * one release that chooses its version without the guard.
 *
 * A re-export rather than a second copy, for the reason its sibling
 * `check-npm-publish-landed.mjs` gives: two copies of one check cannot be kept
 * in step by intention.
 * @module scripts/resolve-published-version-floor
 */
import process from "node:process";

import { main } from "../all/copy-overwrite/scripts/resolve-published-version-floor.mjs";

main(process.argv.slice(2))
  .then(code => {
    process.exitCode = code;
  })
  .catch(error => {
    process.stderr.write(`❌ ${error.message}\n`);
    process.exitCode = 1;
  });

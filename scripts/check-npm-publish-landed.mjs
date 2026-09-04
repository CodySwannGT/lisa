#!/usr/bin/env node
/**
 * Lisa's own entry point for the shipped npm-publish verification.
 *
 * `publish-to-npm.yml` runs `node scripts/check-npm-publish-landed.mjs`, and
 * that path is the CALLER's tree: in a host project `lisa apply` writes it from
 * `all/copy-overwrite/scripts/`, and in this repository it is this file. So the
 * step needs the path to exist here too, or Lisa's own release is the one
 * release the check never runs on.
 *
 * A re-export rather than a second copy. The sibling in the same workflow,
 * `check-release-package-identity.mjs`, is duplicated byte-for-byte across both
 * channels, and duplicated checks are exactly what drifts unnoticed — the whole
 * `hook-copy-parity` subsystem exists because two copies of one check cannot be
 * kept in step by intention. There is one implementation, and both paths reach
 * it.
 * @module scripts/check-npm-publish-landed
 */
import process from "node:process";

import { main } from "../all/copy-overwrite/scripts/check-npm-publish-landed.mjs";

main(process.argv.slice(2))
  .then(code => {
    process.exitCode = code;
  })
  .catch(error => {
    process.stderr.write(`❌ ${error.message}\n`);
    process.exitCode = 1;
  });

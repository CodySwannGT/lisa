#!/usr/bin/env node
/**
 * Lisa's own entry point for the shipped updater (CodySwannGT/lisa#4331).
 *
 * `.github/workflows/lisa-update.yml` runs `node scripts/lisa-self-update.mjs`,
 * and that path is the CALLER's tree: a host gets it from
 * `all/copy-overwrite/scripts/` on apply, and in this repository it is this
 * file. A re-export rather than a second copy, so there is one implementation;
 * here it runs in self mode because this manifest's name is `@codyswann/lisa`.
 * @module scripts/lisa-self-update
 */
import { runCli } from "../all/copy-overwrite/scripts/lisa-self-update.mjs";

runCli();

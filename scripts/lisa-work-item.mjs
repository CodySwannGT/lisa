#!/usr/bin/env node

// The installed copy lives under all/copy-overwrite. Keeping this tiny entrypoint
// makes the exact same implementation available to Lisa's own hooks and CI.
//
// runCli() is called explicitly rather than left to the implementation's own
// "am I the program?" check: from in there, import.meta.url names that file
// while argv[1] names this one, so the check cannot fire through this path and
// the hooks would pass silently while validating nothing.
import { runCli } from "../all/copy-overwrite/scripts/lisa-work-item.mjs";

runCli();

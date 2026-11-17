#!/usr/bin/env node

// The installed copy lives under all/copy-overwrite. This entrypoint runs the
// same implementation for Lisa's own work items, as scripts/lisa-work-item.mjs
// does; runCli() is called explicitly because the implementation's own
// "am I the program?" check cannot fire through this path.
import { runCli } from "../all/copy-overwrite/scripts/lisa-estimate.mjs";

process.exitCode = runCli();

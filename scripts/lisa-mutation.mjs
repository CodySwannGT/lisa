#!/usr/bin/env node

// The installed copy lives under typescript/copy-overwrite. Keeping this tiny
// entrypoint makes the exact same implementation available to Lisa's own hooks
// and CI — this repository runs the mutation gate it ships, not a variant of it.
//
// runCli() is called explicitly rather than left to the implementation's own
// "am I the program?" check: from in there, import.meta.url names that file
// while argv[1] names this one, so the check cannot fire through this path and
// the gate would exit 0 while mutating nothing.
import { runCli } from "../typescript/copy-overwrite/scripts/lisa-mutation.mjs";

runCli();

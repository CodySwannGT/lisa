#!/usr/bin/env node
/**
 * Stub `gh` for the session-manager CLI tests: `api ...` prints the file named
 * by STUB_GH_FILE (else [[]], one empty page) and exits STUB_GH_EXIT (default
 * 0). Every call is recorded through ../stub-record.mjs.
 *
 * STUB_GH_ROUTES, when set, names a JSON file of `[{match, body, exit}]`: the
 * first route whose `match` is the endpoint argument (the last argv entry)
 * answers instead, so a test can give each endpoint its own reply. An endpoint
 * no route matches exits 1, the way gh reports an unreadable resource.
 */
import { readFileSync } from "node:fs";

import { record } from "../stub-record.mjs";

record("gh");
const routesFile = process.env.STUB_GH_ROUTES;
if (routesFile) {
  const endpoint = process.argv[process.argv.length - 1];
  const routes = JSON.parse(readFileSync(routesFile, "utf8"));
  const route = routes.find(entry => entry.match === endpoint);
  process.stdout.write(route ? JSON.stringify(route.body) : "");
  process.exitCode = route ? Number(route.exit ?? 0) : 1;
} else {
  const file = process.env.STUB_GH_FILE;
  process.stdout.write(file ? readFileSync(file, "utf8") : "[[]]");
  process.exitCode = Number(process.env.STUB_GH_EXIT ?? 0);
}

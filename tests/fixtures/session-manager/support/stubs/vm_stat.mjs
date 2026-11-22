#!/usr/bin/env node
/**
 * Stub `vm_stat` for the session-manager CLI tests: prints the macOS fixture
 * ../../vm_stat.txt, and records the call through ../stub-record.mjs.
 */
import { readFileSync } from "node:fs";

import { record } from "../stub-record.mjs";

record("vm_stat");
process.stdout.write(
  readFileSync(new URL("../../vm_stat.txt", import.meta.url), "utf8")
);

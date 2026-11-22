/**
 * Vitest setup file for the test access map (CodySwannGT/lisa#4593).
 *
 * Runs before each test file in the worker. It names the file for the tracer
 * through `LISA_ACCESS_MAP_TEST_FILE`, which every child the test spawns
 * inherits, and after the file adds every module Vitest's own module runner
 * evaluated for it. Those modules (the test file, its TypeScript imports) are
 * transformed in the main process and never reach a Node loader hook, so the
 * tracer alone would miss them. Then it flushes the tracer's records.
 *
 * Only the worker that first claimed attribution renames the file: a nested
 * Vitest run a test spawns inherits the outer test's name, so what the nested
 * run touches is charged to the test that started it.
 *
 * No-op when the tracer is not loaded.
 * @module test-access-map-setup
 */
import { isAbsolute } from "node:path";

import { afterAll } from "vitest";

const tracer = globalThis[Symbol.for("lisa.testAccessMap")];
const state = globalThis.__vitest_worker__;
const owner = process.env["LISA_ACCESS_MAP_OWNER_PID"];
const mine = owner === undefined || owner === String(process.pid);

if (tracer !== undefined && state?.filepath && mine) {
  const testFile = state.filepath;

  process.env["LISA_ACCESS_MAP_OWNER_PID"] = String(process.pid);
  process.env["LISA_ACCESS_MAP_TEST_FILE"] = testFile;

  afterAll(() => {
    const modules = state.evaluatedModules?.fileToModulesMap;
    // Builtins are keyed by bare name ("fs"); only absolute ids are files.
    if (modules !== undefined)
      [...modules.keys()].filter(id => isAbsolute(id)).forEach(tracer.record);
    tracer.flush();
  });
}

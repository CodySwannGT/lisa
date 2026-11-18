/**
 * @file process-environment.test.ts
 * @description Pins that Lisa's one environment accessor reads and writes
 * `process.env` at call time, so a host that reassigns `process.env` (common in
 * Jest setups) is read correctly afterwards.
 * @module utils
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  currentEnvironment,
  readEnv,
  writeEnv,
} from "../../../src/utils/process-environment.js";

const ORIGINAL = process.env;
const NAME = "LISA_PROCESS_ENVIRONMENT_PROBE";

afterEach(() => {
  process.env = ORIGINAL;
});

describe("process environment accessor", () => {
  it("reads a reassigned process.env, not the object seen at import", () => {
    process.env = { [NAME]: "replaced" };
    expect(readEnv(NAME)).toBe("replaced");
    expect(currentEnvironment()).toBe(process.env);
  });

  it("writes and removes variables on the current process.env", () => {
    process.env = {};
    writeEnv(NAME, "set");
    expect(process.env[NAME]).toBe("set");
    writeEnv(NAME, undefined);
    expect(NAME in process.env).toBe(false);
  });
});

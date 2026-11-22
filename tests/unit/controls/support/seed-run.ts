/**
 * Running `lisa controls seed` in-process against fixture repositories, for
 * the suites that check what it decides, declares and refuses
 * (CodySwannGT/lisa#4984).
 * @module tests/unit/controls/support/seed-run
 */
import { expect } from "vitest";

import {
  runSeed,
  type SeedOutput,
} from "../../../../src/controls/commands/seed.js";
import {
  buildControlAuditFixture,
  type ControlAuditFixtureFiles,
  type ControlAuditFixtureName,
} from "../../../helpers/control-audit-fixtures.js";
import { NOW } from "../audit-report-facts.js";
import { keep, type Run } from "./report-check-run.js";

/** The file the declaration lives in. */
export const CONFIG = ".lisa.config.json";

/**
 * Build a fixture, removed after the case.
 * @param name - Which fixture
 * @param extraFiles - Files committed with it
 * @returns The repository root
 */
export function repository(
  name: ControlAuditFixtureName,
  extraFiles: ControlAuditFixtureFiles = {}
): string {
  return keep(buildControlAuditFixture(name, { extraFiles })).repoPath;
}

/**
 * Run the command in-process and capture what it prints.
 * @param target - The path argument, as an operator would type it
 * @returns Exit code and printed lines
 */
export async function seed(target: string): Promise<Run> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runSeed(target, {
    now: NOW,
    stdout: line => {
      stdout.push(line);
    },
    stderr: line => {
      stderr.push(line);
    },
  });
  return { code, stdout, stderr };
}

/**
 * Run the command and parse the document it printed.
 * @param target - The repository
 * @returns The document
 */
export async function seeded(target: string): Promise<SeedOutput> {
  const run = await seed(target);
  expect(run.stderr).toEqual([]);
  expect(run.code).toBe(0);
  expect(run.stdout).toHaveLength(1);
  return JSON.parse(String(run.stdout[0])) as SeedOutput;
}

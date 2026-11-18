/**
 * The repositories the configure suites run in, and what they read back from
 * them (CodySwannGT/lisa#4984).
 * @module tests/integration/support/configure-repositories
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach } from "vitest";

import type { ControlRegister } from "../../../src/controls/register-types.js";
import {
  buildControlAuditFixture,
  type ControlAuditFixture,
  type ControlAuditFixtureFiles,
  type ControlAuditFixtureName,
} from "../../helpers/control-audit-fixtures.js";
import { installLisaCommand } from "./audit-skill-run.js";

/** The file the declaration lives in, from the repository root. */
export const CONFIG = ".lisa.config.json";

/** The file the register is written to, from the repository root. */
export const REGISTER = ".lisa/controls/register.json";

/**
 * The skill's block that lists what the working copy holds. The skill runs
 * it twice: in the preflight, before anything is written, and at the end.
 */
export const CHANGED_BLOCK = "git status --porcelain --untracked-files=all";

/** A TypeScript package that has the tasks some of Lisa's checks run. */
export const PACKAGE_WITH_TASKS = `${JSON.stringify(
  {
    name: "fixture-paved",
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: { lint: "eslint .", typecheck: "tsc --noEmit", build: "tsc" },
    devDependencies: { typescript: "^5.9.3" },
  },
  null,
  2
)}\n`;

const fixtures: ControlAuditFixture[] = [];
const lisa = { folder: "", remove: (): void => undefined };

/**
 * Put a `lisa` command on a private PATH folder for every case of a suite,
 * and remove it and every fixture the case built afterwards.
 * @returns Reads the folder holding the command, inside a case
 */
export function useConfigureRepositories(): () => string {
  beforeEach(() => {
    Object.assign(lisa, installLisaCommand());
  });
  afterEach(() => {
    lisa.remove();
    fixtures.splice(0).forEach(built => {
      built.cleanup();
    });
  });
  return () => lisa.folder;
}

/**
 * Build a fixture, removed after the case.
 * @param name - Which fixture
 * @param extraFiles - Files committed with it
 * @returns The repository root
 */
export function configureRepository(
  name: ControlAuditFixtureName,
  extraFiles: ControlAuditFixtureFiles = {}
): string {
  const built = buildControlAuditFixture(name, { extraFiles });
  fixtures.push(built);
  return built.repoPath;
}

/**
 * The SHA-256 of a file in a repository.
 * @param repoPath - The repository root
 * @param relative - The file, from the repository root
 * @returns The digest in hex
 */
export function hashOf(repoPath: string, relative: string): string {
  return createHash("sha256")
    .update(readFileSync(path.join(repoPath, relative)))
    .digest("hex");
}

/**
 * Read the register a repository holds.
 * @param repoPath - The repository root
 * @returns The parsed register
 */
export function writtenRegister(repoPath: string): ControlRegister {
  return JSON.parse(
    readFileSync(path.join(repoPath, REGISTER), "utf8")
  ) as ControlRegister;
}

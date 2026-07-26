/**
 * Ruby/Bundler coverage for the dependencies/supply-chain readiness producer
 * (B5, PRD #1739, #1896).
 * @module tests/unit/cli/doctor-readiness-supply-chain-ruby
 */
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { assessDependenciesSupplyChainDimension } from "../../../src/cli/doctor-readiness-supply-chain.js";
import { assessReadiness } from "../../../src/cli/doctor-readiness-blockers.js";
import {
  asFindings,
  FAIL,
  makeScratchRepo,
  PASS,
  writeRepoFile,
} from "../../helpers/readiness-workflow-fixtures.js";

/** The ship blocker this producer can stand up. */
const BLOCKER_ID = "B5";

/** The Ruby manifest B5 reads when no package.json exists. */
const GEMFILE = "Gemfile";

/** The Bundler lockfile B5 requires for repeatable installs. */
const GEMFILE_LOCK = "Gemfile.lock";

/** The update-bot config path used as a Ruby dependency-audit gate. */
const DEPENDABOT_PATH = ".github/dependabot.yml";

/** A dependabot config that watches Bundler dependencies. */
const BUNDLER_DEPENDABOT_YML = [
  "version: 2",
  "updates:",
  "  - package-ecosystem: bundler",
  '    directory: "/"',
  "    schedule:",
  "      interval: weekly",
  "",
].join("\n");

let tempDir: string | undefined;

/**
 * Resolve a scratch repository for one test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await makeScratchRepo("supply-chain-ruby");
  return tempDir;
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("assessDependenciesSupplyChainDimension — Ruby/Bundler repositories", () => {
  it("FAILs with B5 instead of SKIP when a Gemfile lacks Bundler confidence evidence", async () => {
    const cwd = await getTempDir();
    await writeRepoFile(
      cwd,
      GEMFILE,
      [
        'source "https://rubygems.org"',
        'gem "rails", "~> 7.2.0"',
        'gem "pg"',
        "",
      ].join("\n")
    );

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain(GEMFILE_LOCK);
    expect(finding?.evidence).toContain("Ruby dependency-audit gate");
    expect(finding?.evidence).toContain("pg");
    expect(assessReadiness([record]).blockers[0].id).toBe(BLOCKER_ID);
  });

  it("PASSes a locked and audited Bundler repository with constrained gems", async () => {
    const cwd = await getTempDir();
    await writeRepoFile(
      cwd,
      GEMFILE,
      [
        'source "https://rubygems.org"',
        'gem "rails", "~> 7.2.0"',
        'gem "pg", "~> 1.5"',
        "",
      ].join("\n")
    );
    await writeRepoFile(cwd, GEMFILE_LOCK, "GEM\n  specs:\n");
    await writeRepoFile(cwd, DEPENDABOT_PATH, BUNDLER_DEPENDABOT_YML);

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(PASS);
    expect(assessReadiness([record]).blockers).toEqual([]);
    const findings = asFindings(record.findings);
    expect(findings[0].evidence).toContain(GEMFILE);
    expect(findings[0].evidence).toContain(GEMFILE_LOCK);
    for (const finding of findings) {
      expect(Object.hasOwn(finding, "blocker")).toBe(false);
    }
  });
});

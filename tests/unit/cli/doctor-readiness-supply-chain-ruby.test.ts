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
  makeScratchRepo,
  SKIP,
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

/** Shared RubyGems source declaration used by fixture Gemfiles. */
const RUBYGEMS_SOURCE = 'source "https://rubygems.org"';

/** Constrained pg dependency used by passing and audit-gate fixtures. */
const CONSTRAINED_PG_GEM = 'gem "pg", "~> 1.5"';

/** Minimal Bundler lockfile body used by fixture repositories. */
const MINIMAL_GEMFILE_LOCK = "GEM\n  specs:\n";

/** Evidence text emitted when no Ruby dependency-audit gate is present. */
const RUBY_AUDIT_GATE_EVIDENCE = "Ruby dependency-audit gate";

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
      [RUBYGEMS_SOURCE, 'gem "rails", "~> 7.2.0"', 'gem "pg"', ""].join("\n")
    );

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe("FAIL");
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain(GEMFILE_LOCK);
    expect(finding?.evidence).toContain(RUBY_AUDIT_GATE_EVIDENCE);
    expect(finding?.evidence).toContain("pg");
    expect(assessReadiness([record]).blockers[0].id).toBe(BLOCKER_ID);
  });

  it("PASSes a locked and audited Bundler repository with constrained gems", async () => {
    const cwd = await getTempDir();
    await writeRepoFile(
      cwd,
      GEMFILE,
      [RUBYGEMS_SOURCE, 'gem "rails", "~> 7.2.0"', CONSTRAINED_PG_GEM, ""].join(
        "\n"
      )
    );
    await writeRepoFile(cwd, GEMFILE_LOCK, MINIMAL_GEMFILE_LOCK);
    await writeRepoFile(cwd, DEPENDABOT_PATH, BUNDLER_DEPENDABOT_YML);

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe("PASS");
    expect(assessReadiness([record]).blockers).toEqual([]);
    const findings = asFindings(record.findings);
    expect(findings[0].evidence).toContain(GEMFILE);
    expect(findings[0].evidence).toContain(GEMFILE_LOCK);
    expect(findings[0].evidence).not.toContain("audit exception");
    for (const finding of findings) {
      expect(Object.hasOwn(finding, "blocker")).toBe(false);
    }
  });

  it("SKIPs with an explicit reason when Gemfile delegates through gemspec", async () => {
    const cwd = await getTempDir();
    await writeRepoFile(
      cwd,
      GEMFILE,
      [RUBYGEMS_SOURCE, "gemspec", ""].join("\n")
    );

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(SKIP);
    const findings = asFindings(record.findings);
    expect(findings[0].reason).toContain("gemspec");
    expect(findings[0].reason).not.toContain(
      "owns no Ruby third-party surface"
    );
    expect(assessReadiness([record]).blockers).toEqual([]);
  });

  it("does not accept commented Bundler audit mentions as Ruby audit gates", async () => {
    const cwd = await getTempDir();
    await writeRepoFile(
      cwd,
      GEMFILE,
      [RUBYGEMS_SOURCE, CONSTRAINED_PG_GEM, ""].join("\n")
    );
    await writeRepoFile(cwd, GEMFILE_LOCK, MINIMAL_GEMFILE_LOCK);
    await writeRepoFile(
      cwd,
      ".github/workflows/quality.yml",
      "jobs:\n  test:\n    steps:\n      # - run: bundle audit\n"
    );

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe("FAIL");
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain(RUBY_AUDIT_GATE_EVIDENCE);
  });

  it("does not accept Renovate unless it names Bundler coverage", async () => {
    const cwd = await getTempDir();
    await writeRepoFile(
      cwd,
      GEMFILE,
      [RUBYGEMS_SOURCE, CONSTRAINED_PG_GEM, ""].join("\n")
    );
    await writeRepoFile(cwd, GEMFILE_LOCK, MINIMAL_GEMFILE_LOCK);
    await writeRepoFile(cwd, "renovate.json", '{"enabledManagers":["npm"]}\n');

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe("FAIL");
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain(RUBY_AUDIT_GATE_EVIDENCE);
  });
});

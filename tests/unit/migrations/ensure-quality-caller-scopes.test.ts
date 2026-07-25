import * as fs from "fs-extra";
import * as path from "node:path";
import type { ProjectType } from "../../../src/core/config.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { EnsureQualityCallerScopesMigration } from "../../../src/migrations/ensure-quality-caller-scopes.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const CI_FILE = path.join(".github", "workflows", "ci.yml");

/** The scope line the migration must insert. */
const ISSUES_READ = "      issues: read";

/** A caller with an explicit, restrictive permissions block — the broken shape. */
const RESTRICTIVE_CALLER = `name: CI

on:
  pull_request:

jobs:
  quality:
    name: Quality Checks
    permissions:
      contents: read
      pull-requests: write
    uses: CodySwannGT/lisa/.github/workflows/quality.yml@main
    with:
      node_version: '22.21.1'
    secrets:
      SONAR_TOKEN: \${{ secrets.SONAR_TOKEN }}

  other:
    name: Something else
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`;

describe("EnsureQualityCallerScopesMigration", () => {
  let migration: EnsureQualityCallerScopesMigration;
  let tempDir: string;
  let projectDir: string;

  beforeEach(async () => {
    migration = new EnsureQualityCallerScopesMigration();
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(path.join(projectDir, ".github", "workflows"));
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Build a migration context for testing.
   * @param dryRun - Whether to run in dry-run mode
   * @param detectedTypes - Detected project types
   * @returns A migration context suitable for tests
   */
  function createContext(
    dryRun = false,
    detectedTypes: readonly ProjectType[] = ["typescript"]
  ): MigrationContext {
    return {
      projectDir,
      lisaDir: path.join(tempDir, "lisa"),
      detectedTypes,
      dryRun,
      logger: new SilentLogger(),
    };
  }

  /**
   * Write the project's ci.yml.
   * @param content - File contents
   */
  async function writeCi(content: string): Promise<void> {
    await fs.writeFile(path.join(projectDir, CI_FILE), content);
  }

  /**
   * Read the project's ci.yml back.
   * @returns File contents
   */
  async function readCi(): Promise<string> {
    return fs.readFile(path.join(projectDir, CI_FILE), "utf8");
  }

  /**
   * Write .lisa.config.json with the given tracker.
   * @param tracker - Tracker name
   */
  async function writeTracker(tracker: string): Promise<void> {
    await fs.writeJson(path.join(projectDir, ".lisa.config.json"), { tracker });
  }

  it("adds only the missing scopes and never downgrades an existing one", async () => {
    await writeCi(RESTRICTIVE_CALLER);

    expect(await migration.applies(createContext())).toBe(true);
    await migration.apply(createContext());
    const updated = await readCi();

    expect(updated).toContain(ISSUES_READ);
    // pull-requests was already granted at write — a downgrade to read would
    // silently break any called job that needs to write.
    expect(updated).toContain("      pull-requests: write");
    expect(updated).not.toContain("      pull-requests: read");
  });

  it("is idempotent", async () => {
    await writeCi(RESTRICTIVE_CALLER);
    await migration.apply(createContext());
    const first = await readCi();

    expect(await migration.applies(createContext())).toBe(false);
    await migration.apply(createContext());

    expect(await readCi()).toBe(first);
  });

  it("preserves the host's comments and unrelated jobs", async () => {
    await writeCi(`jobs:
  quality:
    permissions:
      # deliberately narrow, do not widen
      contents: read
    uses: CodySwannGT/lisa/.github/workflows/quality.yml@main

  deploy:
    permissions:
      contents: write
    runs-on: ubuntu-latest
`);

    await migration.apply(createContext());
    const updated = await readCi();

    expect(updated).toContain("      # deliberately narrow, do not widen");
    // The unrelated job's permissions must be untouched.
    expect(updated).toContain(
      "  deploy:\n    permissions:\n      contents: write"
    );
    expect(updated.match(/issues: read/gu)).toHaveLength(1);
  });

  it("leaves a caller with no permissions block alone", async () => {
    // No block means the job inherits the repo default, which is typically
    // permissive enough already. Inventing a block would RESTRICT scopes the
    // called jobs may rely on.
    await writeCi(`jobs:
  quality:
    uses: CodySwannGT/lisa/.github/workflows/quality.yml@main
    secrets: inherit
`);

    expect(await migration.applies(createContext())).toBe(false);
  });

  it("never rewrites secrets: inherit into an explicit map", async () => {
    await writeTracker("jira");
    await writeCi(`jobs:
  quality:
    permissions:
      contents: read
      issues: read
      pull-requests: read
    uses: CodySwannGT/lisa/.github/workflows/quality.yml@main
    secrets: inherit
`);

    expect(await migration.applies(createContext())).toBe(false);
    const updated = await readCi();
    expect(updated).toContain("secrets: inherit");
    expect(updated).not.toContain("JIRA_API_TOKEN");
  });

  it("maps only the credentials the configured tracker actually uses", async () => {
    await writeTracker("linear");
    await writeCi(RESTRICTIVE_CALLER);

    await migration.apply(createContext());
    const updated = await readCi();

    expect(updated).toContain(
      "      LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}"
    );
    expect(updated).not.toContain("JIRA_API_TOKEN");
  });

  it("adds no secret noise to a github-tracker project", async () => {
    await writeTracker("github");
    await writeCi(RESTRICTIVE_CALLER);

    await migration.apply(createContext());
    const updated = await readCi();

    expect(updated).toContain(ISSUES_READ);
    expect(updated).not.toContain("LINEAR_API_KEY");
    expect(updated).not.toContain("JIRA_API_TOKEN");
  });

  it("handles the rails caller too", async () => {
    await writeCi(`jobs:
  quality:
    permissions:
      contents: read
    uses: CodySwannGT/lisa/.github/workflows/quality-rails.yml@main
`);

    expect(await migration.applies(createContext())).toBe(true);
    await migration.apply(createContext());

    expect(await readCi()).toContain(ISSUES_READ);
  });

  it("ignores a project that does not call the reusable quality workflow", async () => {
    await writeCi(`jobs:
  quality:
    permissions:
      contents: read
    uses: ./.github/workflows/something-else.yml
`);

    expect(await migration.applies(createContext())).toBe(false);
  });

  it("ignores a project with no ci.yml", async () => {
    expect(await migration.applies(createContext())).toBe(false);
    expect((await migration.apply(createContext())).action).toBe("noop");
  });

  it("writes nothing in dry-run mode", async () => {
    await writeCi(RESTRICTIVE_CALLER);

    const result = await migration.apply(createContext(true));

    expect(result.action).toBe("applied");
    expect(await readCi()).toBe(RESTRICTIVE_CALLER);
  });

  it("keeps the file parseable as YAML", async () => {
    await writeTracker("jira");
    await writeCi(RESTRICTIVE_CALLER);

    await migration.apply(createContext());
    const { load } = await import("js-yaml");
    const parsed = load(await readCi()) as {
      jobs: Record<
        string,
        { permissions?: Record<string, string>; secrets?: unknown }
      >;
    };

    expect(parsed.jobs["quality"]?.permissions).toEqual({
      contents: "read",
      "pull-requests": "write",
      issues: "read",
    });
    expect(parsed.jobs["quality"]?.secrets).toMatchObject({
      JIRA_API_TOKEN: "${{ secrets.JIRA_API_TOKEN }}",
      JIRA_LOGIN: "${{ secrets.JIRA_LOGIN }}",
    });
    expect(parsed.jobs["other"]).toBeDefined();
  });
});

/**
 * The migration that reaches the installed base — so the properties worth
 * proving are the ones that decide whether it is safe to let it run there.
 *
 * Three of these tests exist because the alternative is a specific, observed
 * failure rather than a hypothetical:
 *
 * - **A decline must report `skipped`, never `applied`.** A migration that
 *   claimed success having changed nothing would be recorded as done and never
 *   reconsidered, leaving every reference mutable forever while the record said
 *   otherwise. That is the shape this codebase keeps finding: work that stops
 *   happening with nothing saying so.
 * - **An install must not rewrite a workflow.** A reviewed, checked-in
 *   declaration of what runs against a repository is not something `bun install`
 *   may edit — measured in a caller repo in the portfolio, where an install
 *   changed a CI contract nobody authored (#3574).
 * - **A host's own edits must survive.** These files ship `create-only` and are
 *   marked as the host's, so the migration rewrites matched lines and nothing
 *   else.
 *
 * Every resolver here is a stub. The migration must never reach the network in
 * a test, and injecting the resolver is what makes "no network" a case that can
 * be exercised at all rather than a branch nobody runs.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 * @module tests/unit/migrations/ensure-third-party-action-pins
 */
import os from "node:os";
import path from "node:path";

import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SilentLogger } from "../../../src/logging/silent-logger.js";
import {
  EnsureThirdPartyActionPinsMigration,
  type ShaResolver,
} from "../../../src/migrations/ensure-third-party-action-pins.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";

/** A workflow carrying one credentialed third-party ref plus exempt ones. */
const SEEDED_WORKFLOW = [
  "name: Release and Deploy",
  "jobs:",
  "  deploy:",
  "    steps:",
  "      - uses: actions/checkout@v6",
  "      - uses: noliran/branch-based-secrets@v1",
  "        with:",
  "          secrets: AWS_ACCOUNT_ID",
  "      - uses: CodySwannGT/lisa/.github/workflows/gates.yml@main",
  "      - name: Setup Bun",
  "        uses: oven-sh/setup-bun@v2",
  "",
].join("\n");

/** The SHA every stub resolver returns for a reference it can resolve. */
const RESOLVED_SHA = "ef9182f16f118c7c3d05c36973546ebc990b8c69";

/** A second SHA, so a partial resolution is distinguishable. */
const OTHER_SHA = "0c5077e51419868618aeaa5fe8019c62421857d6";

/** The action whose ref resolves to {@link OTHER_SHA} in these stubs. */
const BUN_REPO = "setup-bun";

/**
 * Resolver that resolves everything.
 * @param _owner - Action owner, unused
 * @param repo - Action repository
 * @returns A distinct SHA per repository
 */
const resolvesAll: ShaResolver = async (_owner, repo) =>
  repo === BUN_REPO ? OTHER_SHA : RESOLVED_SHA;

/**
 * Resolver that reaches nothing, as an offline machine does.
 * @returns Always null
 */
const resolvesNothing: ShaResolver = async () => null;

describe("EnsureThirdPartyActionPinsMigration", () => {
  let tempDir: string;
  let projectDir: string;
  let workflow: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-pinmig-"));
    projectDir = path.join(tempDir, "project");
    workflow = path.join(projectDir, ".github", "workflows", "deploy.yml");
    await fs.ensureDir(path.dirname(workflow));
    await fs.writeFile(workflow, SEEDED_WORKFLOW);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  const ctx = (
    overrides: Partial<MigrationContext> = {}
  ): MigrationContext => ({
    projectDir,
    lisaDir: path.join(tempDir, "lisa"),
    detectedTypes: [],
    dryRun: false,
    logger: new SilentLogger(),
    ...overrides,
  });

  it("applies when a mutable third-party reference is present", async () => {
    const migration = new EnsureThirdPartyActionPinsMigration(resolvesAll);
    expect(await migration.applies(ctx())).toBe(true);
  });

  it("pins each reference and records what the SHA carries", async () => {
    const migration = new EnsureThirdPartyActionPinsMigration(resolvesAll);
    const result = await migration.apply(ctx());
    const after = await fs.readFile(workflow, "utf8");

    expect(result.action).toBe("applied");
    expect(after).toContain(
      "- uses: noliran/branch-based-secrets@ef9182f16f118c7c3d05c36973546ebc990b8c69 # v1"
    );
    expect(after).toContain(
      "uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2"
    );
  });

  it("leaves GitHub-owned and first-party references alone", async () => {
    const migration = new EnsureThirdPartyActionPinsMigration(resolvesAll);
    await migration.apply(ctx());
    const after = await fs.readFile(workflow, "utf8");

    expect(after).toContain("- uses: actions/checkout@v6");
    expect(after).toContain(
      "- uses: CodySwannGT/lisa/.github/workflows/gates.yml@main"
    );
  });

  it("keeps a host's own edits to the rest of the file", async () => {
    // The file ships `create-only` and is marked as the host's. Rewriting it
    // wholesale would be an overwrite of somebody else's work.
    const diverged = SEEDED_WORKFLOW.replace(
      "  deploy:",
      "  deploy:\n    # our own note, do not remove"
    );
    await fs.writeFile(workflow, diverged);
    const migration = new EnsureThirdPartyActionPinsMigration(resolvesAll);
    await migration.apply(ctx());

    expect(await fs.readFile(workflow, "utf8")).toContain(
      "# our own note, do not remove"
    );
  });

  it("is a no-op once every reference is pinned", async () => {
    const migration = new EnsureThirdPartyActionPinsMigration(resolvesAll);
    await migration.apply(ctx());

    expect(await migration.applies(ctx())).toBe(false);
    expect((await migration.apply(ctx())).action).toBe("noop");
  });

  it("declines an install rather than rewriting a reviewed workflow", async () => {
    const migration = new EnsureThirdPartyActionPinsMigration(resolvesAll);
    const result = await migration.apply(ctx({ postinstallSafe: true }));

    expect(result.action).toBe("skipped");
    expect(result.changedFiles).toEqual([]);
    expect(await fs.readFile(workflow, "utf8")).toBe(SEEDED_WORKFLOW);
  });

  it("names the references and the command when it declines an install", async () => {
    const migration = new EnsureThirdPartyActionPinsMigration(resolvesAll);
    const result = await migration.apply(ctx({ postinstallSafe: true }));

    expect(result.message).toContain("noliran/branch-based-secrets@v1");
    expect(result.message).toContain("npx @codyswann/lisa@latest .");
  });

  it("reports SKIPPED, not applied, when nothing can be resolved", async () => {
    // The failure that matters: `applied` here would be recorded as done and
    // never retried, leaving the references mutable while the record said they
    // were pinned.
    const migration = new EnsureThirdPartyActionPinsMigration(resolvesNothing);
    const result = await migration.apply(ctx());

    expect(result.action).toBe("skipped");
    expect(result.changedFiles).toEqual([]);
    expect(await fs.readFile(workflow, "utf8")).toBe(SEEDED_WORKFLOW);
  });

  it("says an unreachable lookup is not a breakage", async () => {
    const migration = new EnsureThirdPartyActionPinsMigration(resolvesNothing);
    const result = await migration.apply(ctx());

    expect(result.message).toContain("Nothing is broken");
    expect(result.message).toContain("rate-limited");
  });

  it("pins what resolved and names what did not", async () => {
    /**
     * Resolver that reaches one action and not the other.
     * @param _owner - Action owner, unused
     * @param repo - Action repository
     * @returns A SHA for the resolvable action, null for the rest
     */
    const partial: ShaResolver = async (_owner, repo) =>
      repo === BUN_REPO ? OTHER_SHA : null;
    const migration = new EnsureThirdPartyActionPinsMigration(partial);
    const result = await migration.apply(ctx());
    const after = await fs.readFile(workflow, "utf8");

    expect(result.action).toBe("applied");
    expect(after).toContain("- uses: noliran/branch-based-secrets@v1");
    expect(after).toContain(
      "uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2"
    );
    expect(result.message).toContain("1 reference(s) could not be looked up");
  });

  it("writes nothing on a dry run", async () => {
    const migration = new EnsureThirdPartyActionPinsMigration(resolvesAll);
    const result = await migration.apply(ctx({ dryRun: true }));

    expect(result.action).toBe("applied");
    expect(await fs.readFile(workflow, "utf8")).toBe(SEEDED_WORKFLOW);
  });

  it("is a no-op in a project with no workflows at all", async () => {
    await fs.remove(path.join(projectDir, ".github"));
    const migration = new EnsureThirdPartyActionPinsMigration(resolvesAll);

    expect(await migration.applies(ctx())).toBe(false);
    expect((await migration.apply(ctx())).action).toBe("noop");
  });
});

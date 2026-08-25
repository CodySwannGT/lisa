/**
 * Regression tests for CodySwannGT/lisa#3050 — the consumer-facing half.
 *
 * A create-only artifact cannot fix itself and an unapplied checkout will not
 * notice it is behind, so the party who has to act is the consumer, and the
 * advisory has to reach them where they are. These tests pin what the advisory
 * says, and — because an advisory that fires on a converged project is noise an
 * operator learns to ignore — that a project genuinely in step is NOT reported.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkTwoChannelDrift } from "../../../src/cli/doctor-two-channel-drift.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const CHECK_NAME = "Two-channel delivery drift";

/** The reusable every fixture calls. */
const WORKFLOW = "quality.yml";

/** The caller-tree path that reusable reads. */
const PROVER = "scripts/prover.mjs";

/** A caller job tracking the live channel. */
const LIVE_CALLER = `jobs:\n  q:\n    uses: CodySwannGT/lisa/.github/workflows/${WORKFLOW}@main\n`;

/** Placeholder contents for an artifact whose presence is the whole point. */
const ARTIFACT_BODY = "//\n";

/**
 * One coupling shaped the way the shipped ledger records them.
 * @param overrides - Fields this test cares about
 * @returns The coupling
 */
function ledgerCoupling(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    key: `${WORKFLOW}::${PROVER}`,
    workflow: WORKFLOW,
    path: PROVER,
    channel: "apply",
    verdict: "apply-lagged",
    remedy: "run-lisa-apply",
    guarded: true,
    lanes: ["all/copy-overwrite"],
    detail: "the workflow half arrived and the artifact half did not",
    ...overrides,
  };
}

describe("two-channel drift doctor check", () => {
  let tempDir: string;
  let projectDir: string;
  let ledgerPath: string;

  /**
   * Write a caller workflow into the project.
   * @param name - Workflow file name
   * @param body - Its contents
   */
  async function writeCaller(name: string, body: string): Promise<void> {
    const directory = path.join(projectDir, ".github", "workflows");
    await fs.ensureDir(directory);
    await fs.writeFile(path.join(directory, name), body);
  }

  /**
   * Write the shipped ledger.
   * @param couplings - Couplings it should record
   * @param ratified - Accepted source-only exceptions by coupling key
   */
  async function writeLedger(
    couplings: readonly Record<string, unknown>[],
    ratified: Readonly<Record<string, string>> = {}
  ): Promise<void> {
    await fs.writeJson(ledgerPath, { ratified, couplings });
  }

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
    ledgerPath = path.join(tempDir, "two-channel-couplings.json");
    await fs.ensureDir(projectDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("passes a project that calls no Lisa reusable at all, and says the zero is determinate", async () => {
    await writeLedger([ledgerCoupling()]);
    const result = await checkTwoChannelDrift(projectDir, ledgerPath);
    expect(result.name).toBe(CHECK_NAME);
    expect(result.status).toBe("ok");
    expect(result.detail).toContain("determinate zero");
  });

  it("ignores a caller pinned to an immutable ref, whose halves cannot fall out of step", async () => {
    await writeCaller(
      "ci.yml",
      `jobs:\n  q:\n    uses: CodySwannGT/lisa/.github/workflows/${WORKFLOW}@v3.0.0\n`
    );
    await writeLedger([ledgerCoupling()]);
    const result = await checkTwoChannelDrift(projectDir, ledgerPath);
    expect(result.status).toBe("ok");
    expect(result.detail).toContain("determinate zero");
  });

  it("does not report a consumer whose tree satisfies every coupling", async () => {
    // The negative control. An advisory that fires on a converged project is
    // noise, and an operator who learns to ignore it will ignore the real one.
    await writeCaller("ci.yml", LIVE_CALLER);
    await writeLedger([ledgerCoupling()]);
    await fs.outputFile(
      path.join(projectDir, ...PROVER.split("/")),
      ARTIFACT_BODY
    );
    const result = await checkTwoChannelDrift(projectDir, ledgerPath);
    // Status only, deliberately. This control has to pass against a check that
    // reports all-clear unconditionally as well as against the real one — a
    // control that only holds for the implementation it ships with is
    // mirroring the assertion rather than guarding it.
    expect(result.status).toBe("ok");
  });

  it("warns a consumer whose tree lacks an apply-delivered artifact, naming it and the adoption step", async () => {
    await writeCaller("ci.yml", LIVE_CALLER);
    await writeLedger([ledgerCoupling()]);
    const result = await checkTwoChannelDrift(projectDir, ledgerPath);
    expect(result.status).toBe("warn");
    expect(result.detail).toContain(WORKFLOW);
    expect(result.detail).toContain(PROVER);
    expect(result.detail).toContain("Run `lisa apply`");
  });

  it("fails a consumer lacking a create-only artifact, because no apply and no bump brings it", async () => {
    await writeCaller("ci.yml", LIVE_CALLER);
    await writeLedger([
      ledgerCoupling({
        verdict: "never-delivered",
        remedy: "adopt-the-artifact",
        channel: "create-only",
      }),
    ]);
    const result = await checkTwoChannelDrift(projectDir, ledgerPath);
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("never refreshes it");
  });

  it("honors a ledger-ratified source-only coupling without hiding the exception", async () => {
    await writeCaller("ci.yml", LIVE_CALLER);
    const coupling = ledgerCoupling({
      verdict: "undelivered",
      remedy: "author-the-artifact",
      lanes: [],
    });
    await writeLedger([coupling], {
      [`${WORKFLOW}::${PROVER}`]: "This branch is unreachable in consumers.",
    });
    const result = await checkTwoChannelDrift(projectDir, ledgerPath);
    expect(result.status).toBe("ok");
    expect(result.detail).toContain("Honored 1 ledger-ratified exception");
  });

  it("excludes a delivery lane for a stack the target does not use", async () => {
    await writeCaller("ci.yml", LIVE_CALLER);
    await writeLedger([ledgerCoupling({ lanes: ["expo/copy-overwrite"] })]);
    const result = await checkTwoChannelDrift(projectDir, ledgerPath);
    expect(result.status).toBe("ok");
    expect(result.detail).toContain("Inspected 0 coupling(s)");
  });

  it("checks a stack-specific delivery lane when that stack is active", async () => {
    await writeCaller("ci.yml", LIVE_CALLER);
    await fs.writeJson(path.join(projectDir, "package.json"), {
      dependencies: { expo: "latest" },
    });
    await writeLedger([ledgerCoupling({ lanes: ["expo/copy-overwrite"] })]);
    const result = await checkTwoChannelDrift(projectDir, ledgerPath);
    expect(result.status).toBe("warn");
    expect(result.detail).toContain(PROVER);
  });

  it("does not require a caller-tree copy for a package-backed coupling", async () => {
    await writeCaller("ci.yml", LIVE_CALLER);
    await writeLedger([
      ledgerCoupling({
        verdict: "package-backed",
        remedy: "use-package-command",
        lanes: ["all/package-lisa"],
      }),
    ]);
    const result = await checkTwoChannelDrift(projectDir, ledgerPath);
    expect(result.status).toBe("ok");
    expect(result.detail).toContain("Inspected 0 coupling(s)");
  });

  it("uses named-gate guidance for a genuine undelivered artifact", async () => {
    await writeCaller("ci.yml", LIVE_CALLER);
    await writeLedger([
      ledgerCoupling({
        verdict: "undelivered",
        remedy: "author-the-artifact",
        lanes: [],
      }),
    ]);
    const result = await checkTwoChannelDrift(projectDir, ledgerPath);
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("named gate `off`");
    expect(result.detail).not.toContain("skip_jobs");
  });

  it("only reports couplings belonging to reusables the consumer actually calls", async () => {
    await writeCaller("ci.yml", LIVE_CALLER);
    await writeLedger([
      ledgerCoupling(),
      ledgerCoupling({
        key: "load-test.yml::scripts/k6-run.sh",
        workflow: "load-test.yml",
        path: "scripts/k6-run.sh",
      }),
    ]);
    await fs.outputFile(
      path.join(projectDir, ...PROVER.split("/")),
      ARTIFACT_BODY
    );
    const result = await checkTwoChannelDrift(projectDir, ledgerPath);
    expect(result.status).toBe("ok");
    expect(result.detail).toContain("Inspected 1 coupling(s)");
  });

  it("warns rather than passes when the installed Lisa predates the ledger", async () => {
    await writeCaller("ci.yml", LIVE_CALLER);
    const result = await checkTwoChannelDrift(projectDir, ledgerPath);
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("DID NOT RUN");
  });

  it("fails on an unreadable ledger rather than reporting all-clear", async () => {
    await writeCaller("ci.yml", LIVE_CALLER);
    await fs.writeFile(ledgerPath, "{ not json");
    const result = await checkTwoChannelDrift(projectDir, ledgerPath);
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("must not look the same");
  });

  it("fails on a ledger carrying no couplings rather than reporting all-clear", async () => {
    await writeCaller("ci.yml", LIVE_CALLER);
    await writeLedger([]);
    const result = await checkTwoChannelDrift(projectDir, ledgerPath);
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("compared against");
  });

  it("prints the inspected count on a clean result, so silence is never mistaken for absence", async () => {
    await writeCaller("ci.yml", LIVE_CALLER);
    await writeLedger([ledgerCoupling()]);
    await fs.outputFile(
      path.join(projectDir, ...PROVER.split("/")),
      ARTIFACT_BODY
    );
    const result = await checkTwoChannelDrift(projectDir, ledgerPath);
    expect(result.detail).toMatch(/Inspected \d+ coupling\(s\)/);
    expect(result.detail).toContain(WORKFLOW);
  });
});

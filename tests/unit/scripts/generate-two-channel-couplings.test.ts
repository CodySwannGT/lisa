/**
 * Regression tests for CodySwannGT/lisa#3050 — the gate's exit codes.
 *
 * The classifier can say "this run measured nothing"; these tests pin that the
 * CLI around it actually FAILS on that answer rather than printing it and
 * exiting zero. That distinction is the whole ticket in miniature: an empty
 * sweep and a converged tree must not produce the same result, because this
 * class of defect is failures that read as normal.
 *
 * The last test is the live control — the gate run against this repository, the
 * one tree where both halves exist — so a green suite over synthetic fixtures
 * can never be the only evidence the gate works.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDeliveryInventory,
  main,
} from "../../../scripts/generate-two-channel-couplings.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** Where the fast channel's bodies live, relative to a root. */
const WORKFLOWS_DIR = [".github", "workflows"] as const;

/** A reusable workflow whose only step reads one caller-tree script. */
const REUSABLE = [
  "on:",
  "  workflow_call:",
  "jobs:",
  "  gate:",
  "    steps:",
  "      - name: 🧪 Prove it",
  "        run: node scripts/prover.mjs",
  "",
].join("\n");

/** The caller directory both halves of the fixture use. */
const SCRIPTS = "scripts";

/** Where the gate writes its ledger, relative to a root. */
const LEDGER = [SCRIPTS, "two-channel-couplings.json"] as const;

/** Placeholder contents for a delivered artifact. */
const ARTIFACT_BODY = "//\n";

/** The caller-tree path the fixture workflow reads. */
const PROVER = "prover.mjs";

/** The reusable the fixture workflow is. */
const WORKFLOW = "quality.yml";

/** The refreshing strategy directory. */
const COPY_OVERWRITE = "copy-overwrite";

/** The refreshing lane a delivered artifact is written into. */
const APPLY_LANE = ["all", COPY_OVERWRITE, SCRIPTS] as const;

/** The scaffold-time-only lane an unrefreshed artifact is written into. */
const CREATE_ONLY_LANE = ["expo", "create-only", SCRIPTS] as const;

describe("generate-two-channel-couplings CLI", () => {
  let tempDir: string;
  let root: string;

  /**
   * Run the gate quietly and return its exit code.
   * @param argv - Arguments after the script name
   * @returns The exit code
   */
  function run(argv: readonly string[]): number {
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      return main(argv);
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  }

  beforeEach(async () => {
    tempDir = await createTempDir();
    root = path.join(tempDir, "repo");
    await fs.ensureDir(root);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("fails operationally when it discovered no reusable workflows", async () => {
    await fs.outputFile(path.join(root, ...APPLY_LANE, PROVER), ARTIFACT_BODY);
    expect(run(["--root", root])).toBe(2);
  });

  it("fails operationally when the delivery inventory is empty", async () => {
    // Every path would resolve to `undelivered` and the run would report a
    // fleet of findings it never measured — the same defect, inverted.
    await fs.outputFile(path.join(root, ...WORKFLOWS_DIR, WORKFLOW), REUSABLE);
    expect(run(["--root", root])).toBe(2);
  });

  it("fails operationally when --root does not exist", () => {
    expect(run(["--root", path.join(tempDir, "nowhere")])).toBe(2);
  });

  it("fails on an unratified create-only coupling", async () => {
    await fs.outputFile(path.join(root, ...WORKFLOWS_DIR, WORKFLOW), REUSABLE);
    await fs.outputFile(
      path.join(root, ...CREATE_ONLY_LANE, PROVER),
      ARTIFACT_BODY
    );
    expect(run(["--root", root])).toBe(1);
  });

  it("fails on an unratified undelivered coupling", async () => {
    await fs.outputFile(path.join(root, ...WORKFLOWS_DIR, WORKFLOW), REUSABLE);
    await fs.outputFile(
      path.join(root, ...APPLY_LANE, "other.mjs"),
      ARTIFACT_BODY
    );
    expect(run(["--root", root])).toBe(1);
  });

  it("cannot be regenerated past: writing the ledger records a finding, it does not ratify it", async () => {
    await fs.outputFile(path.join(root, ...WORKFLOWS_DIR, WORKFLOW), REUSABLE);
    await fs.outputFile(
      path.join(root, ...CREATE_ONLY_LANE, PROVER),
      ARTIFACT_BODY
    );
    expect(run(["--root", root])).toBe(1);
    // The ledger now exists and is current, and the gate still fails.
    expect(run(["--root", root])).toBe(1);
  });

  it("passes once the finding carries a ratification", async () => {
    await fs.outputFile(path.join(root, ...WORKFLOWS_DIR, WORKFLOW), REUSABLE);
    await fs.outputFile(
      path.join(root, ...CREATE_ONLY_LANE, PROVER),
      ARTIFACT_BODY
    );
    run(["--root", root]);
    const ledgerPath = path.join(root, ...LEDGER);
    const ledger = (await fs.readJson(ledgerPath)) as {
      ratified: Record<string, string>;
    };
    await fs.writeJson(ledgerPath, {
      ...ledger,
      ratified: {
        [`${WORKFLOW}::scripts/${PROVER}`]:
          "scaffold-time only, adopted by hand",
      },
    });
    expect(run(["--root", root])).toBe(0);
  });

  it("fails on a ratification whose coupling no longer exists", async () => {
    await fs.outputFile(path.join(root, ...WORKFLOWS_DIR, WORKFLOW), REUSABLE);
    await fs.outputFile(path.join(root, ...APPLY_LANE, PROVER), ARTIFACT_BODY);
    await fs.outputJson(path.join(root, ...LEDGER), {
      ratified: { [`${WORKFLOW}::scripts/gone.mjs`]: "nothing reads this" },
      couplings: [],
    });
    expect(run(["--root", root])).toBe(1);
  });

  it("passes a tree whose only host-only coupling is apply-delivered", async () => {
    // The negative control at the CLI layer: a tree in step must exit 0, or
    // every failure above is indistinguishable from the gate simply being red.
    await fs.outputFile(path.join(root, ...WORKFLOWS_DIR, WORKFLOW), REUSABLE);
    await fs.outputFile(path.join(root, ...APPLY_LANE, PROVER), ARTIFACT_BODY);
    expect(run(["--root", root])).toBe(0);
  });

  it("reports --check against a stale ledger as a failure", async () => {
    await fs.outputFile(path.join(root, ...WORKFLOWS_DIR, WORKFLOW), REUSABLE);
    await fs.outputFile(path.join(root, ...APPLY_LANE, PROVER), ARTIFACT_BODY);
    await fs.outputJson(path.join(root, ...LEDGER), {
      ratified: {},
      couplings: [],
    });
    expect(run(["--root", root, "--check"])).toBe(1);
  });

  it("sorts the lanes it records, so the ledger's bytes do not depend on who generated it", async () => {
    // This bit for real. `readdirSync` returns filesystem order, and bun and
    // vitest disagreed about it, so the ledger rendered under one runtime was
    // reported stale by the other — a derived artifact nobody could keep
    // current. Regression, not hypothetical.
    await fs.outputFile(
      path.join(root, "typescript", COPY_OVERWRITE, SCRIPTS, PROVER),
      ARTIFACT_BODY
    );
    await fs.outputFile(
      path.join(root, "rails", COPY_OVERWRITE, SCRIPTS, PROVER),
      ARTIFACT_BODY
    );
    expect(buildDeliveryInventory(root).get(`${SCRIPTS}/${PROVER}`)).toEqual([
      "rails/copy-overwrite",
      "typescript/copy-overwrite",
    ]);
  });

  it("passes --check against this repository, where both halves actually exist", () => {
    // The live control. Synthetic fixtures prove the branches; only the real
    // tree proves the extraction reads Lisa's own workflows correctly.
    const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
    expect(run(["--root", repoRoot, "--check"])).toBe(0);
  });
});

/**
 * Contract tests for `docs/nightly-e2e-gate.md` itself — the specification the
 * reusable workflow and the shipped guard implement.
 *
 * Split out of `nightly-e2e-health-workflow.test.ts`, which proves the WIRING.
 * The split is not cosmetic: a claim in the doc and a claim in a workflow fail
 * in different ways. A wiring drift deadlocks pull requests; a doc drift sends
 * an operator down a path that does not exist, which is exactly what the two
 * 2026-08-19 amendments below were written to stop happening again.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const GUARD_REL =
  "typescript/copy-overwrite/scripts/check-nightly-e2e-health.mjs";

/**
 * Reads a repo-relative file.
 *
 * @param rel - Path relative to the repository root
 * @returns The file contents
 */
const read = (rel: string): string =>
  fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

describe("the contract document and its proof stay together", () => {
  // Collapsed to one line: the doc is hard-wrapped at 80 columns, so a phrase
  // this test looks for can legitimately straddle a newline.
  const doc = read("docs/nightly-e2e-gate.md").replace(/\s+/g, " ");

  it("states the allowlist-never-denylist doctrine the guard implements", () => {
    for (const rule of [
      "Allowlist, never denylist",
      "Limits are source constants, never env-readable",
      "One shared resolution function, resolved at call time",
    ]) {
      expect(doc).toContain(rule);
    }
  });

  // Includes both 2026-08-19 amendments, which LOOSENED this contract:
  // admin-merge is no longer denied outright (that is a claim about a
  // CONSUMER's ruleset, which this repo cannot make, so the doc says where to
  // look it up), and the second-party requirement is gone. An amendment must be
  // RECORDED with the measurement that forced it, never quietly dropped.
  it("states the bypass rules, its provenance, and both amendments", () => {
    for (const rule of [
      "self-service",
      "Auto-expiry",
      "maintainers only",
      "preferred",
      // Provenance: the plan revision, the original ruling, and both
      // 2026-08-19 amendments with the measurement behind each.
      "2026-08-12-r3",
      "ratified 2026-08-12",
      "Amendment — 2026-08-19 (self-bypass)",
      "bypass_actors",
      "93 pull requests",
    ]) {
      expect(doc.toLowerCase()).toContain(rule.toLowerCase());
    }
  });

  it("documents the versioning and rollback policy (A5)", () => {
    expect(doc).toContain("Consumers pin an immutable ref");
    expect(doc).toContain("NIGHTLY_E2E_CONTRACT_VERSION");
    expect(doc).toContain("Rollback is");
  });

  it("documents doctor discovery, direct-call adoption, and probe residuals", () => {
    for (const rule of [
      "`lisa doctor` follows active repository-event workflows",
      "Direct invocation is supported",
      "2.353.0+",
      "--refresh-templates=scripts/check-nightly-e2e-health.mjs",
      "The reaper is never proof",
      "Network access is not fully governed",
      "256 workflow files",
      "15 seconds across the scan",
    ]) {
      expect(doc).toContain(rule);
    }
  });

  it("row 26: doc, guard and caller agree on the completeness rule", () => {
    // A row that lives only in code is a row the next reader will "simplify"
    // away — and the unblock path must survive the tightening, or a red nightly
    // becomes a day-long merge freeze with no escape but the bypass.
    expect(doc).toContain(
      "GitHub concludes a run `success` when its jobs were skipped"
    );
    expect(doc).toContain(
      'The discriminator is "was this run PARTIAL?", never "was this a dispatch?"'
    );
    expect(doc).toContain(
      "Nothing about *being* a dispatch disqualifies a run; being a partial one does"
    );
    expect(read(GUARD_REL)).toContain("incomplete_run");
    // The platform picker is the surface that produced the false green, so the
    // warning belongs where the operator chooses the value.
    expect(
      read("expo/create-only/.github/workflows/maestro-e2e.yml")
    ).toContain("NARROWING THIS DOES NOT CLEAR THE NIGHTLY GATE");
  });
});

/**
 * Tests for the per-change verification (UAT) coverage gate and its wiring.
 * Verification IS UAT — one concept; this guards the concrete enforcement layer.
 */
import { beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT_REL =
  "typescript/copy-overwrite/scripts/check-verification-coverage.mjs";
const GAME_SCENE = "src/game/scenes/Game.ts";

/**
 * Read a repo-relative text file.
 * @param relativePath - Repo-relative path
 * @returns File contents
 */
function read(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8");
}

/** Input to the pure coverage evaluator. */
interface CoverageInput {
  readonly changedFiles: string[];
  readonly changeTypes: string[];
  readonly labels: string[];
}
/** Verdict from the pure coverage evaluator. */
interface CoverageResult {
  readonly required: boolean;
  readonly ok: boolean;
  readonly exempt?: boolean;
  readonly reason: string;
}

describe("check-verification-coverage", () => {
  // Dynamic import via a runtime URL keeps this typed as `any` (no .mjs decls).
  let evaluate: (input: CoverageInput) => CoverageResult;

  beforeAll(async () => {
    const url = pathToFileURL(path.join(REPO_ROOT, SCRIPT_REL)).href;
    const mod = await import(url);
    evaluate = mod.evaluateVerificationCoverage;
  });

  it("does not require a delta for non-behavioral changes", () => {
    const r = evaluate({
      changedFiles: ["src/foo.ts"],
      changeTypes: ["chore", "docs"],
      labels: [],
    });
    expect(r.required).toBe(false);
    expect(r.ok).toBe(true);
  });

  it("passes a feat that ships a tests/e2e spec", () => {
    const r = evaluate({
      changedFiles: [GAME_SCENE, "tests/e2e/game.spec.ts"],
      changeTypes: ["feat"],
      labels: [],
    });
    expect(r.ok).toBe(true);
    expect(r.exempt).toBeUndefined();
  });

  it("passes a fix that ships a tests/verification spec", () => {
    const r = evaluate({
      changedFiles: ["src/logic/score.ts", "tests/verification/score.spec.ts"],
      changeTypes: ["fix"],
      labels: [],
    });
    expect(r.ok).toBe(true);
  });

  it("fails a feat with no verification delta and no exempt label", () => {
    const r = evaluate({
      changedFiles: [GAME_SCENE],
      changeTypes: ["feat"],
      labels: [],
    });
    expect(r.required).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("allows a behavioral change with the logged verification-exempt label", () => {
    const r = evaluate({
      changedFiles: [GAME_SCENE],
      changeTypes: ["fix"],
      labels: ["verification-exempt"],
    });
    expect(r.ok).toBe(true);
    expect(r.exempt).toBe(true);
  });
});

describe("verification (UAT) gate wiring", () => {
  it("frames verification AS UAT (one concept) in the eager rule", () => {
    const rule = read("plugins/src/base/rules/eager/verification.md");
    expect(rule).toContain("Verification IS UAT");
    expect(rule).toContain("evidence/<ticket>/");
    expect(rule).toContain("verification-exempt");
    expect(rule).toContain("product-walkthrough");
    // No parallel "acceptance-uat" skill should be referenced.
    expect(rule).not.toContain("acceptance-uat");
  });

  it("does not ship a parallel acceptance-uat skill", () => {
    expect(
      fs.existsSync(
        path.join(REPO_ROOT, "plugins/src/base/skills/acceptance-uat")
      )
    ).toBe(false);
  });

  it("wires the verification_coverage CI job behind verify_enforced", () => {
    const wf = read(".github/workflows/quality.yml");
    expect(wf).toContain("verify_enforced");
    expect(wf).toContain("verification_coverage");
    expect(wf).toContain("check-verification-coverage.mjs");
  });

  it("ships the coverage script as a managed downstream script", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, SCRIPT_REL))).toBe(true);
  });

  it("ignores committed evidence from prettier", () => {
    expect(read(".prettierignore")).toContain("evidence/**");
  });
});

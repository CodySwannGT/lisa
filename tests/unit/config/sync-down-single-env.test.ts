/**
 * Regression guard for the reusable back-sync workflow: on a single-environment
 * repo the run must be skipped, and .lisa.config.json is authoritative — an
 * explicitly-passed `chain` input on such a repo is dead wiring and must be
 * ignored rather than driving sync PRs to branches that do not exist.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { load as loadYaml } from "js-yaml";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const WORKFLOW_REL = ".github/workflows/reusable-claude-sync-down-branches.yml";

const readWorkflow = (): string =>
  fs.readFileSync(path.join(REPO_ROOT, WORKFLOW_REL), "utf-8");

describe("reusable-claude-sync-down-branches single-environment skip", () => {
  it("checks out the deploy config unconditionally (needed even with a chain input)", () => {
    const wf = loadYaml(readWorkflow()) as {
      readonly jobs?: {
        readonly sync?: {
          readonly steps?: readonly {
            readonly name?: string;
            readonly if?: string;
          }[];
        };
      };
    };
    const checkout = wf.jobs?.sync?.steps?.find(s =>
      (s.name ?? "").startsWith("Checkout source branch")
    );
    expect(checkout).toBeDefined();
    // The old `if: inputs.chain == ''` skipped the checkout on the explicit-chain
    // path, which then could not consult config for single-env detection.
    expect(checkout?.if).toBeUndefined();
  });

  it("skips single-env repos from config even when an explicit chain is passed", () => {
    // The resolve step must consult .lisa.config.json BEFORE honoring the chain
    // input, emit a `value={}` no-op chain, and note that config is authoritative.
    const raw = readWorkflow();
    expect(raw).toContain("declares a single environment");
    expect(raw).toContain("config is authoritative");
    // The distinct-branch count gate (<= 1 => single-env => skip).
    expect(raw).toContain('[ "$DISTINCT" = "0" ] || [ "$DISTINCT" = "1" ]');
    // The single-env branch must precede (and thus win over) the explicit-chain
    // branch in the same script.
    const singleEnv = raw.indexOf("declares a single environment");
    const explicitChain = raw.indexOf("Using explicit chain input.");
    expect(singleEnv).toBeGreaterThan(-1);
    expect(explicitChain).toBeGreaterThan(-1);
    expect(singleEnv).toBeLessThan(explicitChain);
  });
});

/**
 * Lisa's OWN reviewed snapshot of what its merge rules require.
 *
 * `.github/required-checks.json` did not exist here until #2933. Without it the
 * `🔒 Skipped Required Checks` job took its second `exit 0` and reported
 * SUCCESS, so the guard against silencing required checks had never compared a
 * skip token against a required context on the repository that ships it.
 *
 * These cases pin the two things that make the file an ANSWER rather than a
 * placeholder: it enforces (no `enforcement` ramp), and its snapshot is
 * transcribed and unexpired. The prover's own loader is used to judge both, so
 * the bar here cannot drift from the bar in CI.
 *
 * The workflow assertions are the cheap counterpart to
 * `tests/integration/skipped-required-checks-gate-fail-closed.test.ts`, which
 * executes the step. A one-word edit turns an `exit 1` back into an `exit 0`
 * and restores a permanently green gate; asserting the absence of the two
 * messages that used to precede them catches a literal revert.
 *
 * @module tests/unit/config/required-checks-declaration
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const PROVER_REL =
  "typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs";

const DECLARATION_REL = ".github/required-checks.json";

const QUALITY_WORKFLOW_REL = ".github/workflows/quality.yml";

/** The two branch rulesets whose required contexts this snapshot transcribes. */
const RULESET_IDS = [11912821, 18805189];

/** What the prover exports, as this suite consumes it. */
interface GuardModule {
  loadDeclaration(rootDir: string): Record<string, unknown>;
  snapshotTrust(
    declaration: Record<string, unknown>,
    now?: number
  ): { trusted: boolean; reason: string };
}

/**
 * Reads a repo-relative file as text.
 *
 * @param relative - Path relative to the repository root
 * @returns The file contents
 */
const read = (relative: string): string =>
  fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");

describe("Lisa's own required-checks declaration", () => {
  let mod: GuardModule;
  let declaration: Record<string, unknown>;

  beforeAll(async () => {
    mod = (await import(
      pathToFileURL(path.join(REPO_ROOT, PROVER_REL)).href
    )) as unknown as GuardModule;
    declaration = mod.loadDeclaration(REPO_ROOT);
  });

  it("exists and loads under the prover's own validation", () => {
    // `loadDeclaration` throws on every structurally unusable shape, so a
    // successful load is the whole assertion — restating its rules here would
    // let the two drift apart.
    expect(fs.existsSync(path.join(REPO_ROOT, DECLARATION_REL))).toBe(true);
    expect(Array.isArray(declaration.required_contexts)).toBe(true);
  });

  it("omits `enforcement`, so findings BLOCK rather than report", () => {
    // The seeds Lisa ships set `warn` so a fresh install does not go red on
    // arrival. This snapshot has been transcribed, so the ramp does not apply
    // and leaving it would be the softest possible version of the gate.
    expect(declaration.enforcement).toBeUndefined();
  });

  it("names the live rulesets it was transcribed from", () => {
    const ruleset = declaration.ruleset as Record<string, unknown>;
    expect(ruleset.repo).toBe("CodySwannGT/lisa");
    expect(ruleset.ids).toEqual(RULESET_IDS);
  });

  it("carries a transcription the prover still trusts", () => {
    // An unstamped or expired snapshot makes the prover refuse to answer, which
    // reddens CI. That is the design; failing here first names the remedy
    // (re-run the `gh api` line in the file's own `_readme`) before CI does.
    const trust = mod.snapshotTrust(declaration);
    expect(trust.reason).toBe("");
    expect(trust.trusted).toBe(true);
  });

  it("points at workflows that exist", () => {
    for (const relative of declaration.workflows as readonly string[]) {
      expect(fs.existsSync(path.join(REPO_ROOT, relative)), relative).toBe(
        true
      );
    }
  });

  it("recognizes CodeRabbit's confirmed approval description as review evidence", () => {
    const evidenceChecks = declaration.evidence_bearing_checks as Record<
      string,
      { satisfy?: readonly string[] }
    >;

    expect(evidenceChecks.CodeRabbit?.satisfy).toContain("Review approved");
  });
});

describe("the 🔒 Skipped Required Checks step", () => {
  it("no longer carries either message that preceded an `exit 0`", () => {
    const text = read(QUALITY_WORKFLOW_REL);
    expect(text).not.toContain(
      "not present — project not yet on this template"
    );
    expect(text).not.toContain(
      "Lisa ships a seed; run \\`lisa apply\\` to get it. Skipping."
    );
  });

  it("names both missing inputs as errors", () => {
    const text = read(QUALITY_WORKFLOW_REL);
    expect(text).toContain("Skipped-required-check prover missing");
    expect(text).toContain("Required-checks declaration missing");
  });
});

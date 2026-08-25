/**
 * The declaration-versus-live comparison, on the path a machine takes.
 *
 * The comparison had existed for some time as a finished script nothing
 * invoked. These tests pin the two properties that make it a control rather
 * than a document: it runs from the scheduled health path without a human
 * typing anything, and every source it cannot reach is `warn`, never `pass`.
 * @module tests/unit/health/declared-checks
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  declaredChecksDriftFinding,
  declaredChecksFinding,
} from "../../../src/health/declared-checks-inspection.js";
import type {
  HealthRuleset,
  RulesetReader,
} from "../../../src/health/ruleset-inspection.js";
import { classifyDeclarationDrift } from "../../../src/core/gate-declaration-drift.js";

const WORKFLOW = "🔍 Quality Checks";
const TYPE_CHECK = `${WORKFLOW} / 🔍 Type Check`;
const SECURITY = `${WORKFLOW} / 🔒 Security Scan`;
const GITHUB = { github: { org: "example", repo: "project" } };

/**
 * A project whose settings file carries the given gates block.
 * @param gates - The gates block
 * @returns Absolute project root
 */
async function projectWith(gates: unknown): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "lisa-declared-checks-"));
  await writeFile(
    path.join(root, ".lisa.config.json"),
    JSON.stringify({ ...GITHUB, gates }, null, 2),
    "utf8"
  );
  return root;
}

/**
 * A reader answering with one ruleset requiring the given contexts.
 * @param contexts - Contexts the live ruleset requires
 * @param rulesetName - The ruleset's name, defaulting to one Lisa manages
 * @returns An injectable reader
 */
function liveRequiring(
  contexts: readonly string[],
  rulesetName = "quality checks"
): RulesetReader {
  const ruleset: HealthRuleset = {
    name: rulesetName,
    target: "branch",
    enforcement: "active",
    conditions: {},
    rules: [
      {
        type: "required_status_checks",
        parameters: {
          required_status_checks: contexts.map(context => ({ context })),
        },
      },
    ],
  };
  return async () => [ruleset];
}

/** A reader that fails the way an unauthenticated machine fails. */
const unreachable: RulesetReader = () => {
  throw new Error("HTTP 401");
};

/**
 * Run the check with the deadline arguments a probe supplies.
 * @param root - Project root
 * @param reader - Ruleset reader
 * @returns The finding
 */
async function run(
  root: string,
  reader: RulesetReader
): ReturnType<typeof declaredChecksDriftFinding> {
  return await declaredChecksDriftFinding(
    root,
    GITHUB,
    reader,
    5_000,
    new AbortController().signal
  );
}

describe("declaredChecksDriftFinding", () => {
  it("passes only when every live requirement is governed by a declaration", async () => {
    const finding = await run(
      await projectWith({ "type-correctness": { "pull-request": "required" } }),
      liveRequiring([TYPE_CHECK])
    );

    expect(finding.status).toBe("pass");
  });

  it("fails when protection requires a context the settings file switched off", async () => {
    const finding = await run(
      await projectWith({ "type-correctness": { "pull-request": "off" } }),
      liveRequiring([TYPE_CHECK])
    );

    expect(finding.status).toBe("fail");
    expect(finding.reason).toContain("enforced-declared-off");
  });

  it("fails when a declared requirement is enforced by nothing", async () => {
    const finding = await run(
      await projectWith({ "type-correctness": { "pull-request": "required" } }),
      liveRequiring(["CodeRabbit"])
    );

    expect(finding.status).toBe("fail");
    expect(finding.reason).toContain("declared-not-enforced");
  });

  it("warns rather than fails when protection requires an undeclared gate's context", async () => {
    const finding = await run(await projectWith({}), liveRequiring([SECURITY]));

    expect(finding.status).toBe("warn");
    expect(finding.reason).toContain("enforced-undeclared");
  });

  it("reports an unreadable live ruleset as unproven, never as a match", async () => {
    const finding = await run(await projectWith({}), unreachable);

    expect(finding.status).toBe("warn");
    expect(finding.reason.startsWith("Unproven:")).toBe(true);
  });

  it("reports an unconfigured repository as unproven rather than passing", async () => {
    const finding = await declaredChecksDriftFinding(
      await projectWith({}),
      {},
      liveRequiring([TYPE_CHECK]),
      5_000,
      new AbortController().signal
    );

    expect(finding.status).toBe("warn");
    expect(finding.reason.startsWith("Unproven:")).toBe(true);
  });

  it("reports an unreadable gates block as unproven rather than as no declarations", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lisa-declared-checks-"));
    await writeFile(path.join(root, ".lisa.config.json"), "{ not json", "utf8");

    const finding = await run(root, liveRequiring([TYPE_CHECK]));

    expect(finding.status).toBe("warn");
    expect(finding.reason.startsWith("Unproven:")).toBe(true);
  });
});

describe("a required context Lisa's own rename made unpostable", () => {
  // #3067, end to end on the real shipped registry: `🔎 AST Grep Scan` is the
  // string 4.x retired, and `structural-rules` still carries it in
  // `previousLabels`. Every assertion below therefore runs against the real
  // rename rather than a fixture that merely resembles one.
  const AST_GREP = `${WORKFLOW} / 🔎 AST Grep Scan`;
  const STRUCTURAL = `${WORKFLOW} / 🔎 Structural Rules`;
  const HAND_MADE = "enforce pr rules";
  const DECLARED = { "structural-rules": { "pull-request": "required" } };

  it("fails, and says the check can never report rather than that it failed", async () => {
    const finding = await run(
      await projectWith(DECLARED),
      liveRequiring([AST_GREP, STRUCTURAL], HAND_MADE)
    );

    expect(finding.status).toBe("fail");
    expect(finding.reason).toContain("nothing will ever post");
    expect(finding.reason).toContain("AST Grep Scan");
    expect(finding.reason).toContain("Waiting for status to be reported");
  });

  it("names the ruleset it found it in, which Lisa does not manage", async () => {
    const finding = await run(
      await projectWith(DECLARED),
      liveRequiring([AST_GREP], HAND_MADE)
    );

    // The whole failure mode is that both the ruleset script and the ruleset
    // half of health are scoped per MANAGED ruleset name, so a hand-made one
    // is invisible to them. This reader answers with a ruleset by a name no
    // Lisa template ships, and the finding still has to name it.
    expect(finding.reason).toContain(HAND_MADE);
    expect(finding.reason).toContain("never edited automatically");
  });

  it("reports zero rulesets as an inspection that happened, not a clean one", async () => {
    const nothingRead: RulesetReader = async () => [];

    const finding = await run(await projectWith(DECLARED), nothingRead);

    expect(finding.status).not.toBe("pass");
    expect(finding.reason.startsWith("Unproven:")).toBe(true);
    expect(finding.reason).toContain("inspected nothing rather than finding");
  });

  // THE NEGATIVE CONTROL. Current label plus a third-party app status: nothing
  // here is unpostable, and the check must stay quiet. A sweep that flagged
  // every externally-produced context would be noise.
  it("does not flag a repository whose required contexts are all produced", async () => {
    const finding = await run(
      await projectWith(DECLARED),
      liveRequiring([STRUCTURAL, "CodeRabbit"], HAND_MADE)
    );

    expect(finding.status).toBe("pass");
    expect(finding.reason).not.toContain("nothing will ever post");
  });
});

describe("declaredChecksFinding", () => {
  it("never turns a third-party context into a finding of its own", () => {
    const finding = declaredChecksFinding(
      classifyDeclarationDrift({
        surface: "live-ruleset",
        owners: new Map(),
        enforced: [
          {
            context: "CodeRabbit",
            ruleset: "base",
            source: "the repository's live rulesets",
          },
        ],
      })
    );

    expect(finding.status).toBe("pass");
  });
});

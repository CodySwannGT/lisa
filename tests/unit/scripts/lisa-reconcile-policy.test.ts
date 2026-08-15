/**
 * Tests for ruleset reconciliation — the behaviors that read the live repo.
 *
 * Three of them carry the weight, and each encodes a measured incident:
 *
 * 1. **UNPROVEN is not clean.** A failed read returns `contexts: null`, not
 *    `{missing: [], extra: [], matched: []}` — because empty sets are exactly
 *    what a clean repository looks like, and a reader who cannot tell them
 *    apart reports "policy matches" having checked nothing.
 * 2. **An EXTRA context is never deleted silently.** Most are external apps
 *    Lisa does not declare (`SonarCloud Code Analysis`), so converging by
 *    deletion strips live protection on the first run.
 * 3. **The alias window.** Both the old and the new context are required for one
 *    release during a rename, or in-flight PRs block on a context that will
 *    never report again — and the fastest fix for whoever is blocked is
 *    deleting the requirement, which is how a rename removes a gate.
 *
 * The pure comparison helpers are covered in `lisa-reconcile-policy-units`.
 * @module tests/unit/scripts/lisa-reconcile-policy
 */

import { describe, expect, it } from "vitest";

import {
  UNPROVEN,
  VERDICT,
  exitCodeFor,
  reconcile,
  render,
} from "../../../all/copy-overwrite/scripts/lisa-reconcile-policy.mjs";
import { QUALITY } from "./lisa-gates-fixtures.js";
import {
  ACTIONS_ID,
  GATES,
  type GhState,
  LINT,
  REPO,
  SONAR,
  TYPES,
  baseRuleset,
  boom,
  gitHub,
  recorded,
  run,
  writes,
  writtenContexts,
} from "./lisa-reconcile-policy-fixtures.js";

const REPAIR = "repair";
const MANUAL = "manual";

describe("UNPROVEN is its own state, never clean and never a drift report", () => {
  const cases: [string, GhState, string][] = [
    [
      "gh is not installed",
      {
        index: {
          ok: false,
          stdout: "",
          stderr: "spawn gh ENOENT",
          missing: true,
        },
      },
      UNPROVEN.NO_CLI,
    ],
    [
      "gh is unauthenticated",
      { index: boom("gh auth login required") },
      UNPROVEN.UNAUTHENTICATED,
    ],
    [
      "the API refuses the read",
      { index: boom("HTTP 403: Upgrade to GitHub Team") },
      UNPROVEN.API_ERROR,
    ],
    [
      "the response is not JSON",
      { index: { ok: true, stdout: "<html>502</html>", stderr: "" } },
      UNPROVEN.MALFORMED,
    ],
  ];

  for (const [label, state, reason] of cases) {
    it(`reports ${reason} when ${label}`, () => {
      const { result } = run(state);
      expect(result.verdict).toBe(VERDICT.UNPROVEN);
      expect(result.unproven?.reason).toBe(reason);
      // Null, not []. Empty sets are what CLEAN looks like.
      expect(result.contexts).toBeNull();
      expect(result.settings).toBeNull();
    });
  }

  it("preserves the failure text verbatim so the operator can act on it", () => {
    const { result } = run({ index: boom("HTTP 403: Upgrade to GitHub Team") });
    expect(result.unproven?.detail).toContain("Upgrade to GitHub Team");
    expect(result.unproven?.command).toBe(`gh api repos/${REPO}/rulesets`);
  });

  it("is unproven when the index reads but a ruleset detail does not", () => {
    // Half a required list compared against a whole declaration reports drift
    // that may not exist.
    const { result } = run({
      rulesets: [baseRuleset([LINT])],
      detail: boom("HTTP 500"),
    });
    expect(result.verdict).toBe(VERDICT.UNPROVEN);
  });

  it("is unproven when the repository settings read fails", () => {
    const { result } = run({
      rulesets: [baseRuleset([LINT, TYPES])],
      settings: boom("HTTP 404"),
    });
    expect(result.verdict).toBe(VERDICT.UNPROVEN);
  });

  it("is unproven when no repository could be resolved", () => {
    const result = reconcile({ repo: null, gates: GATES, gh: gitHub({}) });
    expect(result.unproven?.reason).toBe(UNPROVEN.NO_REPO);
    expect(result.contexts).toBeNull();
  });

  it("exits 2 in every mode, including report, and writes nothing", () => {
    for (const onDrift of [REPAIR, "report", "block"]) {
      const { result, calls } = run({ index: boom("HTTP 500") }, { onDrift });
      expect(exitCodeFor(result)).toBe(2);
      expect(writes(calls)).toEqual([]);
    }
  });

  it("never renders as a match", () => {
    const report = render(run({ index: boom("HTTP 500") }).result);
    expect(report).toContain("UNPROVEN");
    expect(report).toContain('This is not "matches"');
    expect(report).not.toMatch(/^MATCHED/mu);
  });
});

describe("reconcile", () => {
  it("matches when the live contexts equal the derived ones", () => {
    const { result, calls } = run({
      rulesets: [baseRuleset([LINT, TYPES])],
      settings: {},
    });
    expect(result.verdict).toBe(VERDICT.MATCHED);
    expect(result.contexts?.matched).toHaveLength(2);
    expect(result.plan).toEqual([]);
    expect(writes(calls)).toEqual([]);
    expect(exitCodeFor(result)).toBe(0);
  });

  it("adds a MISSING context under repair, by writing the ruleset", () => {
    const { result, calls } = run({
      rulesets: [baseRuleset([LINT])],
      settings: {},
    });
    expect(result.verdict).toBe(VERDICT.DRIFT);
    expect(result.contexts?.missing).toEqual([TYPES]);

    const [write] = writes(calls);
    expect(write.args).toEqual([
      "api",
      "-X",
      "PUT",
      `repos/${REPO}/rulesets/7`,
      "--input",
      "-",
    ]);
    expect(writtenContexts(write.input)).toEqual([LINT, TYPES]);
    // Read-only fields are rejected by the API, so the payload must not carry
    // the ones the live object came back with.
    const payload = JSON.parse(write.input ?? "{}");
    expect(payload.id).toBeUndefined();
    expect(payload._links).toBeUndefined();
    expect(payload.created_at).toBeUndefined();
  });

  it("patches repository settings that drifted from the policy block", () => {
    const { calls } = run(
      { rulesets: [baseRuleset([LINT, TYPES])], settings: { has_wiki: true } },
      { policy: { repository: { has_wiki: false } } }
    );
    const [write] = writes(calls);
    expect(write.args).toEqual([
      "api",
      "-X",
      "PATCH",
      `repos/${REPO}`,
      "--input",
      "-",
    ]);
    expect(JSON.parse(write.input ?? "{}")).toEqual({ has_wiki: false });
  });

  it("reports ruleset-shape policy drift instead of reshaping rules itself", () => {
    // Reshaping rules from two places is how a repair strips a rule it did not
    // understand, so the script that builds them keeps ownership.
    const { result, calls } = run(
      { rulesets: [baseRuleset([LINT, TYPES])], settings: {} },
      { policy: { history: { linear: true } } }
    );
    expect(writes(calls)).toEqual([]);
    expect(result.plan).toEqual([
      {
        kind: MANUAL,
        message: expect.stringContaining("lisa-github-rulesets.sh"),
      },
    ]);
    expect(result.verdict).toBe(VERDICT.DRIFT);
  });
});

describe("an EXTRA context is reported, never removed by default", () => {
  const withSonar: GhState = {
    rulesets: [baseRuleset([LINT, TYPES, SONAR])],
    settings: {},
  };

  it("leaves it in place and names it", () => {
    const { result, calls } = run(withSonar);
    expect(result.contexts?.extra).toEqual([
      {
        context: SONAR,
        integration_id: ACTIONS_ID,
        ruleset: "base",
        rulesetId: 7,
      },
    ]);
    expect(writes(calls)).toEqual([]);
    const [action] = result.plan;
    expect(action.kind).toBe(MANUAL);
    expect(action.message).toContain(SONAR);
    expect(action.message).toContain("NOT removed");
    expect(action.message).toContain("--prune");
  });

  it("removes it only when --prune is passed explicitly", () => {
    const { calls } = run(withSonar, { prune: true });
    expect(writtenContexts(writes(calls)[0].input)).toEqual([LINT, TYPES]);
  });

  it("still writes nothing under --prune when --dry-run is also set", () => {
    const { calls } = run(withSonar, { prune: true, dryRun: true });
    expect(writes(calls)).toEqual([]);
  });
});

describe("the alias window", () => {
  it("requires both the old and the new context for one release", () => {
    const { result } = run(
      { rulesets: [baseRuleset([LINT, TYPES])], settings: {} },
      { previousLabels: ["🧽 Lint"] }
    );
    expect(result.declared).toContain(`${QUALITY} / 🧽 Lint`);
    expect(result.contexts?.missing).toEqual([`${QUALITY} / 🧽 Lint`]);
  });

  it("does not report the retired context as EXTRA while the window is open", () => {
    // The mirror failure: without the pass-through the still-required old
    // context reads as unmanaged, and `--prune` would delete it mid-rename.
    const { result } = run(
      {
        rulesets: [baseRuleset([LINT, TYPES, `${QUALITY} / 🧽 Lint`])],
        settings: {},
      },
      { previousLabels: ["🧽 Lint"] }
    );
    expect(result.verdict).toBe(VERDICT.MATCHED);
    expect(result.contexts?.extra).toEqual([]);
  });
});

describe("on_drift and --dry-run", () => {
  const drifted: GhState = { rulesets: [baseRuleset([LINT])], settings: {} };

  it("writes nothing under report, and exits 0", () => {
    const { result, calls } = run(drifted, { onDrift: "report" });
    expect(writes(calls)).toEqual([]);
    expect(result.plan).not.toEqual([]);
    expect(exitCodeFor(result)).toBe(0);
  });

  it("writes nothing under block, and exits non-zero", () => {
    const { result, calls } = run(drifted, { onDrift: "block" });
    expect(writes(calls)).toEqual([]);
    expect(exitCodeFor(result)).toBe(1);
  });

  it("writes nothing under --dry-run even when on_drift is repair", () => {
    const { result, calls } = run(drifted, { onDrift: REPAIR, dryRun: true });
    expect(writes(calls)).toEqual([]);
    expect(
      result.plan.some((action: { kind: string }) => action.kind === "contexts")
    ).toBe(true);
    expect(render(result)).toContain("nothing was written");
  });

  it("reads on_drift from the policy block when no override is given", () => {
    const gh = gitHub(drifted);
    const result = reconcile({
      repo: REPO,
      gates: GATES,
      gh,
      policy: { on_drift: "block" },
    });
    expect(result.onDrift).toBe("block");
    expect(writes(recorded(gh.mock.calls))).toEqual([]);
  });

  it("exits 1 when a repair write fails, rather than claiming it converged", () => {
    const { result } = run({ ...drifted, write: boom("HTTP 422") });
    expect(exitCodeFor(result)).toBe(1);
    expect(render(result)).toContain("FAILED");
  });

  it("refuses to guess a target ruleset instead of writing to the wrong one", () => {
    const { result, calls } = run({
      rulesets: [
        baseRuleset([LINT]),
        { ...baseRuleset([LINT]), id: 9, name: "quality" },
      ],
      settings: {},
    });
    expect(writes(calls)).toEqual([]);
    expect(result.plan[0]).toEqual({
      kind: MANUAL,
      message: expect.stringContaining("--ruleset="),
    });
  });
});

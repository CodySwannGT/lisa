/**
 * Tests for what a measured drift COSTS — the exit code, not the comparison.
 *
 * Three defects live here, and all three are the same shape as the ones the
 * comparison itself was built to avoid: a check whose result does not match
 * what it measured.
 *
 * 1. **`block` has to be passable.** An external app's context is EXTRA by
 *    construction, and this script refuses to remove one. Failing `block` on it
 *    made the mode permanently red on any repository with SonarCloud or
 *    CodeRabbit, and the only ways out — `--prune`, or deleting the check —
 *    both remove live protection. A gate that cannot pass while the repository
 *    is correct is as broken as one that cannot fail.
 * 2. **A printed instruction is not a failed write.** `applyRepairs` records a
 *    `manual` action as `applied: false` because nothing was written, and the
 *    exit code read that as a repair that GitHub refused.
 * 3. **An awaited context is not posted by Actions.** Pinning `CodeRabbit` to
 *    the Actions integration requires a status the one app that can post it is
 *    not allowed to satisfy — a required check that blocks every pull request
 *    forever.
 * @module tests/unit/scripts/lisa-reconcile-policy-verdicts
 */

import { describe, expect, it } from "vitest";

import {
  UNPROVEN,
  VERDICT,
  exitCodeFor,
  reconcile,
  render,
  resolveRepo,
  rulesetPayload,
} from "../../../all/copy-overwrite/scripts/lisa-reconcile-policy.mjs";
import { PULL_REQUEST, REVIEW_BOT } from "./lisa-gates-fixtures.js";
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
  run,
  writes,
} from "./lisa-reconcile-policy-fixtures.js";

const BLOCK = "block";
const REPAIR = "repair";
const NAME_WITH_OWNER = "acme/other";

/** A repository whose only difference is a context nothing declares. */
const EXTRA_ONLY: GhState = {
  rulesets: [baseRuleset([LINT, TYPES, SONAR])],
  settings: {},
};

/** A repository missing a declared context — drift a repair can converge. */
const MISSING_ONE: GhState = {
  rulesets: [baseRuleset([LINT])],
  settings: {},
};

/** Gates that additionally await a signal Lisa does not post. */
const AWAITING = {
  ...GATES,
  "code-review": { [PULL_REQUEST]: { level: "required", await: REVIEW_BOT } },
};

/**
 * The required-status-check entries a written payload carries.
 * @param input - The JSON body piped to `gh`.
 * @returns Each entry, integration id included.
 */
const writtenChecks = (
  input: string | undefined
): { context: string; integration_id?: number }[] =>
  JSON.parse(input ?? "{}").rules[0].parameters.required_status_checks;

describe("EXTRA-only drift under on_drift=block", () => {
  it("reports the difference by name but does not fail the run", () => {
    const { result } = run(EXTRA_ONLY, { onDrift: BLOCK });
    expect(result.verdict).toBe(VERDICT.DRIFT);
    expect(result.blocking).toBe(false);
    expect(exitCodeFor(result)).toBe(0);
    const report = render(result);
    expect(report).toContain(SONAR);
    expect(report).toContain("this run passes");
  });

  it("still fails on drift a repair could converge", () => {
    // The half that must not weaken: a MISSING context is Lisa's to add, so
    // `block` fails on it exactly as before.
    const { result } = run(MISSING_ONE, { onDrift: BLOCK });
    expect(result.blocking).toBe(true);
    expect(exitCodeFor(result)).toBe(1);
  });

  it("still fails on settings drift with no context drift at all", () => {
    const { result } = run(
      { rulesets: [baseRuleset([LINT, TYPES])], settings: { has_wiki: true } },
      { onDrift: BLOCK, policy: { repository: { has_wiki: false } } }
    );
    expect(exitCodeFor(result)).toBe(1);
  });

  it("fails on an EXTRA once --prune has made it removable", () => {
    // Under `--prune` the operator has said the extras should go, so they are
    // convergeable again — and therefore blocking again.
    const { result } = run(EXTRA_ONLY, { onDrift: BLOCK, prune: true });
    expect(result.blocking).toBe(true);
    expect(exitCodeFor(result)).toBe(1);
  });
});

describe("exitCodeFor and advisory manual steps", () => {
  it("does not report an un-pruned EXTRA as a repair write that failed", () => {
    const { result, calls } = run(EXTRA_ONLY, { onDrift: REPAIR });
    expect(writes(calls)).toEqual([]);
    expect(result.outcomes).toEqual([
      {
        action: expect.objectContaining({ kind: "manual" }),
        applied: false,
        note: expect.stringContaining(SONAR),
      },
    ]);
    expect(exitCodeFor(result)).toBe(0);
  });

  it("still reports a write GitHub actually refused", () => {
    const { result } = run({ ...MISSING_ONE, write: boom("HTTP 422") });
    expect(exitCodeFor(result)).toBe(1);
  });
});

describe("an awaited context is added unpinned", () => {
  it("pins a workflow context to Actions and leaves an awaited one open", () => {
    const payload = rulesetPayload(baseRuleset([]), {
      add: [LINT, REVIEW_BOT],
      awaited: [REVIEW_BOT],
    });
    expect(payload.rules[0].parameters.required_status_checks).toEqual([
      { context: LINT, integration_id: ACTIONS_ID },
      { context: REVIEW_BOT },
    ]);
  });

  it("writes the awaited context without an integration id end to end", () => {
    // Pinned to 15368, `CodeRabbit` could only be satisfied by GitHub Actions,
    // which never posts it — the requirement would never clear.
    const { calls } = run(MISSING_ONE, { gates: AWAITING });
    const checks = writtenChecks(writes(calls)[0]?.input);
    expect(checks).toContainEqual({ context: REVIEW_BOT });
    expect(checks).toContainEqual({
      context: TYPES,
      integration_id: ACTIONS_ID,
    });
  });
});

describe("resolveRepo", () => {
  it("distinguishes a missing gh from a repository nothing named", () => {
    const absent = () => ({
      ok: false,
      stdout: "",
      stderr: "spawn gh ENOENT",
      missing: true,
    });
    expect(resolveRepo(null, {}, absent)).toEqual({
      repo: null,
      ghMissing: true,
    });

    const result = reconcile({
      repo: null,
      ghMissing: true,
      gates: GATES,
      gh: gitHub({}),
    });
    expect(result.unproven?.reason).toBe(UNPROVEN.NO_CLI);
  });

  it("keeps repository-unresolved when gh answered but named nothing", () => {
    const silent = () => ({ ok: true, stdout: "\n", stderr: "" });
    expect(resolveRepo(null, {}, silent)).toEqual({
      repo: null,
      ghMissing: false,
    });
    const result = reconcile({ repo: null, gates: GATES, gh: gitHub({}) });
    expect(result.unproven?.reason).toBe(UNPROVEN.NO_REPO);
  });

  it("prefers an explicit flag, then the config, over asking gh at all", () => {
    const refuse = () => {
      throw new Error("gh must not be consulted");
    };
    expect(resolveRepo(REPO, {}, refuse).repo).toBe(REPO);
    expect(
      resolveRepo(null, { github: { org: "acme", repo: "other" } }, refuse).repo
    ).toBe(NAME_WITH_OWNER);
  });
});

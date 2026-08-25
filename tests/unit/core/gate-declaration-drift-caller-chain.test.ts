/**
 * The declaration-drift comparator's half of the per-declaration caller chain.
 *
 * `contextsFor` is not the only thing that turns a declaration into the name
 * of a required check — this comparator builds the same string, from the same
 * registry label, to decide whether the settings file and the ruleset agree.
 * Honouring the override in one and not the other would leave the doctor line
 * this field exists to clear (`Required checks match what the settings file
 * declares?`) permanently red on any project that adopted it, which is the
 * defect one level along rather than a fix.
 *
 * Fails CLOSED throughout. A required context nothing posts does not turn a
 * pull request red: GitHub holds it at "Expected — Waiting for status to be
 * reported", indefinitely. So a chain this comparator cannot join must report
 * that nothing was compared, never the caller-wide name the declaration has
 * just disowned.
 * @module tests/unit/core/gate-declaration-drift-caller-chain
 */
import { describe, expect, it } from "vitest";

import {
  contextOwners,
  type MergeContextRegistry,
} from "../../../src/core/gate-declaration-drift.js";

const WORKFLOW = "🔍 Quality Checks";
const LINT = `${WORKFLOW} / 🧹 Lint`;
const REQUIRED = "required";

/** A registry with two gates and a resolver that honours the gates block. */
const REGISTRY: MergeContextRegistry = {
  REGISTRY: {
    lint: { label: "🧹 Lint", moments: ["pull-request", "push"] },
    "code-review": {
      label: "🤖 Code Review",
      moments: ["pull-request"],
    },
  },
  resolveMoment: () => [],
  momentFamily: moment => moment,
};

describe("contextOwners with a per-declaration caller chain", () => {
  const CALLER = "🎭 PR Browser Coverage";
  /** The stub registry, taught to resolve and join a declared chain. */
  const WITH_OVERRIDE: MergeContextRegistry = {
    ...REGISTRY,
    resolveMoment: ({ gates }) =>
      Object.entries(gates).map(([id, value]) => {
        const entry = (value as Record<string, unknown>)["pull-request"];
        const declared = entry as Record<string, unknown>;
        return {
          id,
          level: String(declared["level"]),
          mode: "run",
          awaits: null,
          callerChain: declared["caller_chain"] as readonly string[],
        };
      }),
    callerPrefix: chain => (Array.isArray(chain) ? chain : [chain]).join(" / "),
  };

  it("owns the context that gate's own prover posts", () => {
    const map = contextOwners({
      registry: WITH_OVERRIDE,
      gates: {
        lint: { "pull-request": { level: REQUIRED, caller_chain: [CALLER] } },
      },
      workflowName: WORKFLOW,
    });

    expect(map.get(`${CALLER} / 🧹 Lint`)?.declaration).toBe(REQUIRED);
    // And the gate no longer owns the facade name at all. One gate cannot own
    // two contexts here: listing both would make the facade name a SECOND
    // required context — one nothing posts — and GitHub holds such a check
    // "Expected — Waiting for status to be reported" rather than failing it.
    // A ruleset still pinning the old name is caught where it can be caught
    // against reality, by `lisa-reconcile-policy`'s EXTRA-context arm reading
    // the live ruleset, not by this offline comparison inventing a second
    // requirement.
    expect(map.has(LINT)).toBe(false);
  });

  it("refuses to guess when the installed registry cannot join a chain", () => {
    // Fail CLOSED. The alternative is to derive the caller-wide name for a
    // gate whose declaration has just said that name is wrong, which reports
    // agreement about a check GitHub will hold "Expected" for ever.
    const older: MergeContextRegistry = {
      ...WITH_OVERRIDE,
      callerPrefix: undefined,
    };

    expect(() =>
      contextOwners({
        registry: older,
        gates: {
          lint: { "pull-request": { level: REQUIRED, caller_chain: [CALLER] } },
        },
        workflowName: WORKFLOW,
      })
    ).toThrow(/too old/);
  });

  it("derives the caller-wide name when nothing overrides it (control)", () => {
    expect(
      contextOwners({
        registry: WITH_OVERRIDE,
        gates: { lint: { "pull-request": { level: REQUIRED } } },
        workflowName: WORKFLOW,
      }).get(LINT)?.declaration
    ).toBe(REQUIRED);
  });
});

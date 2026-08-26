/**
 * Tests for the per-declaration caller-chain override.
 *
 * The gap this closes: a gate can be proved by a workflow that is not the
 * quality facade, and until now no declaration could say so. Every run-mode
 * context was derived by prefixing the gate's label with the CALLER-wide
 * chain, so a project proving one property from a workflow of its own derived
 * a name that workflow never posts — and a required context nothing posts does
 * not fail a pull request. GitHub holds it at "Expected — Waiting for status to
 * be reported", indefinitely, with no red tick to chase and no log to open.
 *
 * Which cuts both ways, and both directions are asserted here. An override
 * that derived a name nothing posts would red-wall every pull request in the
 * repository; changing what an EXISTING declaration derives would strand every
 * consumer pinned to the old string the same way. The negative controls at the
 * bottom are the second half.
 * @module tests/unit/scripts/lisa-gates-caller-chain-override
 */

import { describe, expect, it } from "vitest";

import {
  callerPrefix,
  contextsFor,
  resolveMoment,
  validateGates,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import {
  LINT_LABEL,
  LINT_TASK,
  PULL_REQUEST,
  QUALITY,
  REVIEW_BOT,
} from "./lisa-gates-fixtures.js";

/** The outermost job on the release path, from `deploy.yml`. */
const RELEASE = "Release";

/** A prover job outside the facade, in a caller repo in the portfolio. */
const BROWSER_CALLER = "🎭 PR Browser Coverage";

/** `e2e-browser`'s registry label. */
const BROWSER_LABEL = "🎭 Browser Journeys";

/** The label `e2e-browser` carried before it was renamed. */
const BROWSER_FORMER = "🎭 Playwright E2E Tests";

/** What the outside prover actually posts. */
const BROWSER_CONTEXT = `${BROWSER_CALLER} / ${BROWSER_LABEL}`;

/** What the facade-derived name would have been, and what nothing posts. */
const FACADE_BROWSER = `${QUALITY} / ${BROWSER_LABEL}`;

/** The task the outside-proved gate names for itself. */
const BROWSER_TASK = "test:e2e:pr";

/** Two gates: one inside the facade, one proved outside it. */
const GATES = {
  "code-style": { run: LINT_TASK, [PULL_REQUEST]: "required" },
  "e2e-browser": {
    run: BROWSER_TASK,
    [PULL_REQUEST]: { level: "required", caller_chain: [BROWSER_CALLER] },
  },
};

describe("contextsFor with a per-declaration caller chain", () => {
  it("derives the chain the outside prover posts, not the facade's", () => {
    // The defect, reproduced. Before the field existed this derived
    // `🔍 Quality Checks / 🎭 Browser Journeys`, which the playwright
    // workflow never posts, and no declaration could correct it.
    const derived = contextsFor(GATES) as string[];

    expect(derived).toContain(BROWSER_CONTEXT);
    expect(derived).not.toContain(FACADE_BROWSER);
  });

  it("takes the same chain written as one slash-joined string", () => {
    const derived = contextsFor({
      ...GATES,
      "e2e-browser": {
        run: BROWSER_TASK,
        [PULL_REQUEST]: { level: "required", caller_chain: BROWSER_CALLER },
      },
    }) as string[];

    expect(derived).toContain(BROWSER_CONTEXT);
  });

  it("does not resurrect the gate's retired label under the override", () => {
    // Registry previousLabels prove what Lisa no longer posts. Carrying one
    // through a caller-chain override would create the same permanent Expected
    // check as carrying it through the default chain.
    expect(contextsFor(GATES) as string[]).not.toContain(
      `${BROWSER_CALLER} / ${BROWSER_FORMER}`
    );
  });

  it("overrides only its own gate, leaving the caller's chain to the rest", () => {
    // The two inputs shape one string and must not fight. The overridden gate
    // ignores the release-path chain because that chain does not reach its
    // prover; the gate inside the facade still carries every level of it.
    const derived = contextsFor(GATES, {
      callerChain: [RELEASE, QUALITY],
    }) as string[];

    expect(derived).toContain(`${RELEASE} / ${QUALITY} / 🧹 Lint`);
    expect(derived).toContain(BROWSER_CONTEXT);
    expect(derived).not.toContain(`${RELEASE} / ${BROWSER_CONTEXT}`);
  });

  it("refuses a blank level in an override instead of deriving it", () => {
    // `" / 🎭 Browser Journeys"` is plausible-looking and posted by nothing.
    expect(() =>
      contextsFor({
        "e2e-browser": {
          run: BROWSER_TASK,
          [PULL_REQUEST]: { level: "required", caller_chain: ["", "x"] },
        },
      })
    ).toThrow(/caller chain/);
  });

  it("exposes the declared chain on the resolved gate, raw", () => {
    const resolved = resolveMoment({ gates: GATES, moment: PULL_REQUEST });
    const browser = resolved.find(gate => gate.id === "e2e-browser");
    const lint = resolved.find(gate => gate.id === "code-style");

    expect(browser?.callerChain).toEqual([BROWSER_CALLER]);
    expect(lint?.callerChain).toBeNull();
  });
});

describe("callerPrefix", () => {
  it("joins a declared chain the same way every derivation does", () => {
    expect(callerPrefix([RELEASE, QUALITY])).toBe(`${RELEASE} / ${QUALITY}`);
    expect(callerPrefix(`${RELEASE} / ${QUALITY}`)).toBe(
      `${RELEASE} / ${QUALITY}`
    );
  });

  it("throws on a chain no run could post rather than guessing one", () => {
    expect(() => callerPrefix([])).toThrow(/caller chain/);
    expect(() => callerPrefix(["  "])).toThrow(/caller chain/);
  });
});

describe("validateGates refuses an override at declaration time", () => {
  it("refuses one on an awaited moment, where no chain prefixes anything", () => {
    const problems = validateGates({
      "code-review": {
        [PULL_REQUEST]: {
          level: "required",
          await: REVIEW_BOT,
          caller_chain: [BROWSER_CALLER],
        },
      },
    }) as string[];

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("caller_chain");
    expect(problems[0]).toContain(REVIEW_BOT);
  });

  it("refuses one at a moment that posts no status at all", () => {
    const problems = validateGates({
      "code-style": {
        run: LINT_TASK,
        push: { level: "required", caller_chain: [BROWSER_CALLER] },
      },
    }) as string[];

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("caller_chain");
    expect(problems[0]).toContain("push");
  });

  it("refuses a level that is not a string", () => {
    const problems = validateGates({
      "code-style": {
        run: LINT_TASK,
        [PULL_REQUEST]: { level: "required", caller_chain: [7] },
      },
    }) as string[];

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("caller_chain");
  });

  it("refuses a blank level, naming the pending-forever consequence", () => {
    const problems = validateGates({
      "code-style": {
        run: LINT_TASK,
        [PULL_REQUEST]: { level: "required", caller_chain: [QUALITY, ""] },
      },
    }) as string[];

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("Waiting for status to be reported");
  });

  it("refuses one declared for the whole gate rather than for a moment", () => {
    // The chain is a property of one moment's wiring: the same job posts a
    // one-level name on the pull-request path and a two-level one on the
    // release path. A gate-level value asserts one chain for both.
    const problems = validateGates({
      "code-style": {
        run: LINT_TASK,
        caller_chain: [BROWSER_CALLER],
        [PULL_REQUEST]: "required",
      },
    }) as string[];

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`gates."code-style"."caller_chain"`);
    expect(problems[0]).toContain(PULL_REQUEST);
  });

  it("accepts a well-formed override", () => {
    expect(validateGates(GATES)).toEqual([]);
  });
});

describe("no override (negative control)", () => {
  const PLAIN = {
    "code-style": { run: LINT_TASK, [PULL_REQUEST]: "required" },
    "code-review": { [PULL_REQUEST]: { level: "required", await: REVIEW_BOT } },
  };

  it("derives exactly the strings the live rulesets are pinned to", () => {
    // Hardcoded, not computed. Every ruleset in the fleet is pinned to these;
    // a change that served the override case by moving them would strand all
    // of them at "Expected — Waiting for status to be reported", and would
    // fail here instead.
    expect(contextsFor(PLAIN)).toEqual([LINT_LABEL, REVIEW_BOT]);
    expect(contextsFor(PLAIN, { workflowName: QUALITY })).toEqual([
      LINT_LABEL,
      REVIEW_BOT,
    ]);
    expect(contextsFor(PLAIN, { callerChain: [RELEASE, QUALITY] })).toEqual([
      REVIEW_BOT,
      `${RELEASE} / ${QUALITY} / 🧹 Lint`,
    ]);
  });

  it("still validates clean, with the field absent", () => {
    expect(validateGates(PLAIN)).toEqual([]);
  });
});

/**
 * Validation of `unenforceable_on`, the key a gate's moment entry uses to
 * name the coding agents the rule cannot be enforced on at that moment.
 *
 * Some agents have no hook that can refuse a file write. Where one of them is
 * on a repository's roster, the gap is written into the declaration so the
 * control register carries it. Every refusal here is read by an operator, so
 * each assertion checks that the message names the gate and the key at fault
 * (CodySwannGT/lisa#4990).
 * @module tests/unit/scripts/lisa-gates-unenforceable-on
 */
import { describe, expect, it } from "vitest";

import {
  AGENT_MOMENTS,
  CODING_AGENTS,
  resolveMoment,
  UNENFORCEABLE_ON_FIELD,
  validateGates,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { HARNESS_VALUES } from "../../../src/core/config.js";

/** A gate this project invented, so the registry has no opinion about it. */
const GATE = "x-lint";

/** The moment an agent's edit-time hook carries. */
const POST_TOOL = "post-tool";

/** An agent with no hook that can refuse a write. */
const HOOKLESS = "agy";

/** The title shared by every table of malformed values. */
const REFUSED_WHEN = "is refused when it is %s";

/**
 * Where a problem about the key is reported.
 * @param moment - The moment the key is declared at
 * @returns The key, as a refusal names it
 */
const where = (moment: string = POST_TOOL): string =>
  `gates."${GATE}"."${moment}".${UNENFORCEABLE_ON_FIELD}`;

/**
 * A gates block holding one custom gate that names agents at one moment.
 * @param agents - The moment's `unenforceable_on` value, well-formed or not
 * @param moment - The moment the key is declared at
 * @returns The gates block
 */
const blockWith = (
  agents: unknown,
  moment: string = POST_TOOL
): Record<string, unknown> => ({
  [GATE]: {
    run: "lint",
    [moment]: { level: "required", [UNENFORCEABLE_ON_FIELD]: agents },
  },
});

/**
 * The problems reported for one custom gate naming the given agents.
 * @param agents - The moment's `unenforceable_on` value
 * @param moment - The moment the key is declared at
 * @returns Every problem validation reports
 */
const problemsFor = (agents: unknown, moment?: string): string[] =>
  validateGates(blockWith(agents, moment));

describe("the agents a moment cannot be enforced on", () => {
  it("are named with the names the harness setting uses", () => {
    expect(UNENFORCEABLE_ON_FIELD).toBe("unenforceable_on");
    expect(CODING_AGENTS).toEqual(
      HARNESS_VALUES.filter(harness => harness !== "fleet")
    );
  });

  it("belong only to the moments a coding agent's own hooks carry", () => {
    expect(AGENT_MOMENTS).toEqual(["session-start", "pre-tool", POST_TOOL]);
  });

  it.each([
    ["one agent", [HOOKLESS]],
    ["several agents", [HOOKLESS, "copilot"]],
    ["every agent Lisa supports", [...CODING_AGENTS]],
  ])("are accepted as %s", (_name, agents) => {
    expect(problemsFor(agents)).toEqual([]);
  });

  it.each(AGENT_MOMENTS)("are accepted at %s", moment => {
    expect(problemsFor([HOOKLESS], moment)).toEqual([]);
  });

  it("leave a gate that names none exactly as it was", () => {
    expect(
      validateGates({ [GATE]: { run: "lint", [POST_TOOL]: "required" } })
    ).toEqual([]);
  });

  it("change nothing about what the moment resolves to", () => {
    const resolve = (gates: Record<string, unknown>): unknown =>
      resolveMoment({
        gates,
        moment: POST_TOOL,
        runner: "npm run",
        scripts: { lint: "eslint ." },
      });

    expect(resolve(blockWith([HOOKLESS]))).toEqual(
      resolve({ [GATE]: { run: "lint", [POST_TOOL]: "required" } })
    );
  });
});

describe("a value that is not a list of agents", () => {
  it.each([
    ["one agent's name on its own", HOOKLESS],
    ["an empty list", []],
    ["null", null],
    ["an object", { agy: true }],
    ["true", true],
  ])(REFUSED_WHEN, (_name, agents) => {
    const problems = problemsFor(agents);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${where()} is ${JSON.stringify(agents)}`);
    expect(problems[0]).toContain(`["${HOOKLESS}"]`);
  });
});

describe("an agent the list names", () => {
  it.each([
    ["one Lisa does not support", "emacs"],
    ["written with a capital", "Agy"],
    ["the whole fleet", "fleet"],
    ["blank", ""],
    ["a number", 7],
  ])(REFUSED_WHEN, (_name, agent) => {
    const problems = problemsFor([HOOKLESS, agent]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${where()}[1] is ${JSON.stringify(agent)}`);
    expect(problems[0]).toContain(CODING_AGENTS.join(", "));
  });

  it("is refused when it is named twice", () => {
    const problems = problemsFor([HOOKLESS, "copilot", HOOKLESS]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${where()} names "${HOOKLESS}" twice`);
  });
});

describe("the key at a moment no coding agent's hook carries", () => {
  it.each(["commit", "push", "pull-request", "pre-deploy:production"])(
    "is refused at %s",
    moment => {
      const problems = problemsFor([HOOKLESS], moment);

      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(where(moment));
      expect(problems[0]).toContain(AGENT_MOMENTS.join(", "));
    }
  );

  it("is refused once, without also judging its contents", () => {
    expect(problemsFor(["emacs"], "commit")).toHaveLength(1);
  });
});

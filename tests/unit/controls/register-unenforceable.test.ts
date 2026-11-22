/**
 * What the control register says about a rule a coding agent cannot enforce.
 *
 * A check declared at an agent moment runs because the agent's own hook calls
 * the gate runner. An agent with no hook that can refuse a write never calls
 * it, and the declaration says so on the moment entry. The register carries
 * the agent's name onto the enforcement point at that moment, so a reader of
 * the register sees the gap (CodySwannGT/lisa#4990).
 */
import { describe, expect, it } from "vitest";

import {
  AGENT_MOMENTS,
  CODING_AGENTS,
} from "../../../src/controls/coding-agents.js";
import { serializeControlRegister } from "../../../src/controls/register.js";
import { UNENFORCEABLE_ON_KEY } from "../../../src/controls/unenforceable-agents.js";
import {
  F_MIXED_GATES,
  evidenceAt,
  registerSchema,
  registerSchemaErrors,
  shippedGates,
  type GatesBlock,
} from "../../helpers/control-register.js";
import { entryOf, registerOf } from "./support/register-build.js";
import { BARE_ENTRY, registerWith } from "./support/register-samples.js";

const POST_TOOL = "post-tool";
const CODING_AGENT = "coding-agent";
const LINT_API = "code-style@api";
const LINT_WEB = "code-style@web";

/** F-mixed with its lint check also declared at the edit-time moment. */
const AT_EDIT_TIME: GatesBlock = {
  ...F_MIXED_GATES,
  "code-style": {
    ...(F_MIXED_GATES["code-style"] as object),
    [POST_TOOL]: "required",
  },
};

/**
 * The same declaration, naming agents the edit-time check cannot run on.
 * @param agents - The agents, in the order the declaration lists them
 * @returns The `gates` block
 */
function unenforceableOn(agents: readonly string[]): GatesBlock {
  return {
    ...F_MIXED_GATES,
    "code-style": {
      ...(F_MIXED_GATES["code-style"] as object),
      [POST_TOOL]: { level: "required", [UNENFORCEABLE_ON_KEY]: agents },
    },
  };
}

/**
 * An enforcement point of a sample entry with the given agents on it.
 * @param agents - The point's `unenforceable_on`, well-formed or not
 * @returns One line per finding of the published schema
 */
function schemaErrorsFor(agents: unknown): readonly string[] {
  return registerSchemaErrors(
    registerWith({
      ...BARE_ENTRY,
      enforcement_points: [
        {
          moment: POST_TOOL,
          level: "required",
          location: CODING_AGENT,
          unenforceable_on: agents,
        },
      ],
    })
  );
}

describe("the names the register and the gate registry share", () => {
  it("are the same in both", async () => {
    const registry = (await shippedGates()) as unknown as Readonly<
      Record<string, unknown>
    >;

    expect(UNENFORCEABLE_ON_KEY).toBe(registry.UNENFORCEABLE_ON_FIELD);
    expect(CODING_AGENTS).toEqual(registry.CODING_AGENTS);
    expect(AGENT_MOMENTS).toEqual(registry.AGENT_MOMENTS);
  });
});

describe("an agent the declaration says cannot enforce a moment", () => {
  it("is named on that enforcement point of every entry of the gate", async () => {
    const register = await registerOf(unenforceableOn(["agy"]));

    expect(
      [LINT_API, LINT_WEB].map(id => entryOf(register, id).enforcement_points)
    ).toEqual(
      [LINT_API, LINT_WEB].map(() => [
        {
          moment: POST_TOOL,
          level: "required",
          location: CODING_AGENT,
          unenforceable_on: ["agy"],
        },
        { moment: "commit", level: "required", location: "local-checkout" },
        {
          moment: "pull-request",
          level: "required",
          location: "hosting-platform",
        },
      ])
    );
  });

  it("is listed in one fixed order, whatever order the declaration uses", async () => {
    const [forward, backward] = await Promise.all([
      registerOf(unenforceableOn(["agy", "copilot"])),
      registerOf(unenforceableOn(["copilot", "agy"])),
    ]);

    expect(
      entryOf(forward, LINT_API).enforcement_points[0]?.unenforceable_on
    ).toEqual(["agy", "copilot"]);
    expect(serializeControlRegister(backward)).toBe(
      serializeControlRegister(forward)
    );
  });

  it("is left off a gate that names none", async () => {
    const register = await registerOf(AT_EDIT_TIME);

    expect(entryOf(register, LINT_API).enforcement_points[0]).toEqual({
      moment: POST_TOOL,
      level: "required",
      location: CODING_AGENT,
    });
    expect(serializeControlRegister(register)).not.toContain(
      UNENFORCEABLE_ON_KEY
    );
  });

  it("is carried at a moment before the write as well", async () => {
    const register = await registerOf({
      "x-secrets": {
        "pre-tool": { level: "required", [UNENFORCEABLE_ON_KEY]: ["agy"] },
        parts: [
          {
            scope: ".",
            command: ["node", "scan.mjs"],
            evidence: evidenceAt("scan.mjs"),
          },
        ],
      },
    });

    expect(entryOf(register, "x-secrets@.").enforcement_points).toEqual([
      {
        moment: "pre-tool",
        level: "required",
        location: CODING_AGENT,
        unenforceable_on: ["agy"],
      },
    ]);
  });

  it("produces a register the published schema accepts", async () => {
    expect(
      registerSchemaErrors(await registerOf(unenforceableOn(["agy", "devin"])))
    ).toEqual([]);
  });
});

describe("the agents an enforcement point names in the published schema", () => {
  it("are the agents the gates declaration may name", () => {
    const schema = registerSchema() as {
      readonly $defs: {
        readonly enforcement_point: {
          readonly properties: {
            readonly unenforceable_on: {
              readonly items: { readonly enum: readonly string[] };
            };
          };
        };
      };
    };

    expect(
      schema.$defs.enforcement_point.properties.unenforceable_on.items.enum
    ).toEqual(CODING_AGENTS);
  });

  it.each([
    ["one agent", ["agy"]],
    ["every agent", [...CODING_AGENTS]],
  ])("are accepted as %s", (_name, agents) => {
    expect(schemaErrorsFor(agents)).toEqual([]);
  });

  it.each([
    ["an empty list", []],
    ["an agent Lisa does not know", ["emacs"]],
    ["the same agent twice", ["agy", "agy"]],
    ["one name on its own", "agy"],
  ])("are refused as %s", (_name, agents) => {
    expect(schemaErrorsFor(agents)).not.toEqual([]);
  });
});

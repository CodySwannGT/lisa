/**
 * Resolution of a gate that declares `parts`.
 *
 * A gate with parts resolves to one entry per part at every moment it is
 * declared at, each carrying the folder it covers (`scope`) and the argument
 * list that checks it (`argv`). A gate with no parts must resolve exactly as
 * it did before the key existed — field for field — because every hook and
 * workflow in an installed repository already reads those entries.
 * @module tests/unit/scripts/lisa-gates-parts-resolution
 */
import { describe, expect, it } from "vitest";

import {
  configurationProblems,
  contextsFor,
  PROOF_DIRECTORY,
  resolveMoment,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

const COMMIT = "commit";
const PUSH = "push";
const PULL_REQUEST = "pull-request";

/** A gate this project invented, proved by a different command per folder. */
const LINT = "x-lint";

const API_COMMAND = ["go", "vet", "./..."];
const WEB_COMMAND = ["npm", "run", "lint"];

/** How the push-moment prover prints a measured failure. */
const PUSH_SHAPE = "✖ push lint";

const API_PART = { scope: "api", command: API_COMMAND };
const WEB_PART = { scope: "web", command: WEB_COMMAND };

/** The keys every resolved entry carried before parts existed, in order. */
const ESTABLISHED_KEYS = [
  "id",
  "level",
  "mode",
  "awaits",
  "postedBy",
  "declared",
  "task",
  "command",
  "label",
  "work",
  "alias",
  "evidence",
  "callerChain",
  "failureShape",
  "mayRewrite",
  "costly",
];

/** One resolved entry, as far as these assertions read it. */
interface ResolvedEntry {
  readonly id: string;
  readonly level: string;
  readonly mode: string;
  readonly task: string | null;
  readonly command: string | null;
  readonly failureShape: string[] | null;
  readonly scope?: string;
  readonly argv?: string[] | null;
}

/**
 * Resolve a gates block at one moment.
 * @param gates - The gates block
 * @param moment - The moment to resolve at
 * @param includeOff - Whether to report gates declared off
 * @returns The resolved entries
 */
const resolveAt = (
  gates: Record<string, unknown>,
  moment: string,
  includeOff = false
): ResolvedEntry[] =>
  resolveMoment({ gates, moment, runner: "bun run", includeOff });

describe("resolveMoment on a gate with parts", () => {
  const gates = {
    [LINT]: {
      [COMMIT]: "required",
      [PUSH]: "optional",
      [PULL_REQUEST]: "off",
      parts: [API_PART, WEB_PART],
    },
  };

  it("returns one entry per part, each with its scope and argument list", () => {
    expect(resolveAt(gates, COMMIT)).toEqual([
      {
        id: LINT,
        level: "required",
        mode: "run",
        awaits: null,
        postedBy: null,
        // The project's own `run:` task. A gate with parts names none: what
        // runs is the part's argument list, carried in `argv`.
        declared: null,
        // No task and no `<runner> <task>` string. A part's command is never
        // joined into text, because text is what a shell would be handed.
        task: null,
        command: null,
        label: LINT,
        work: null,
        alias: null,
        evidence: null,
        callerChain: null,
        failureShape: null,
        mayRewrite: false,
        costly: false,
        scope: "api",
        argv: API_COMMAND,
      },
      {
        id: LINT,
        level: "required",
        mode: "run",
        awaits: null,
        postedBy: null,
        declared: null,
        task: null,
        command: null,
        label: LINT,
        work: null,
        alias: null,
        evidence: null,
        callerChain: null,
        failureShape: null,
        mayRewrite: false,
        costly: false,
        scope: "web",
        argv: WEB_COMMAND,
      },
    ]);
  });

  it("adds scope and argv after the keys every entry already had", () => {
    const [entry] = resolveAt(gates, COMMIT);

    expect(Object.keys(entry ?? {})).toEqual([
      ...ESTABLISHED_KEYS,
      "scope",
      "argv",
    ]);
  });

  it("carries the level declared at each moment", () => {
    expect(resolveAt(gates, PUSH).map(entry => entry.level)).toEqual([
      "optional",
      "optional",
    ]);
  });

  it("returns nothing at a moment the gate is not declared at", () => {
    expect(resolveAt(gates, "post-tool")).toEqual([]);
  });

  it("returns nothing for a moment declared off, unless asked", () => {
    expect(resolveAt(gates, PULL_REQUEST)).toEqual([]);
  });

  it("reports each part of a gate declared off, with nothing to run", () => {
    expect(resolveAt(gates, PULL_REQUEST, true)).toEqual([
      {
        id: LINT,
        level: "off",
        mode: "off",
        awaits: null,
        postedBy: null,
        declared: null,
        task: null,
        command: null,
        label: LINT,
        work: null,
        alias: null,
        evidence: null,
        callerChain: null,
        failureShape: null,
        mayRewrite: false,
        costly: false,
        scope: "api",
        argv: null,
      },
      {
        id: LINT,
        level: "off",
        mode: "off",
        awaits: null,
        postedBy: null,
        declared: null,
        task: null,
        command: null,
        label: LINT,
        work: null,
        alias: null,
        evidence: null,
        callerChain: null,
        failureShape: null,
        mayRewrite: false,
        costly: false,
        scope: "web",
        argv: null,
      },
    ]);
  });

  it("keeps the parts in the order they were declared", () => {
    const reversed = {
      [LINT]: { [COMMIT]: "required", parts: [WEB_PART, API_PART] },
    };

    expect(resolveAt(reversed, COMMIT).map(entry => entry.scope)).toEqual([
      "web",
      "api",
    ]);
  });

  it("hands out a copy of the argument list, never the declaration's own", () => {
    const [entry] = resolveAt(gates, COMMIT);
    entry?.argv?.push("--fix");

    expect(API_COMMAND).toEqual(["go", "vet", "./..."]);
    expect(resolveAt(gates, COMMIT)[0]?.argv).toEqual(API_COMMAND);
  });
});

describe("resolveMoment on a registry gate with parts", () => {
  const SHAPE = ["lint failed"];
  const gates = {
    "code-style": {
      [COMMIT]: "required",
      [PUSH]: { level: "required", failure_shape: [PUSH_SHAPE] },
      [PULL_REQUEST]: {
        level: "required",
        caller_chain: ["Checks"],
      },
      parts: [
        {
          scope: "api",
          command: API_COMMAND,
          proof: {
            violation: `${PROOF_DIRECTORY}lint-api.violation.patch`,
            failure_shape: SHAPE,
          },
        },
        WEB_PART,
      ],
    },
  };

  it("keeps the gate's label and ordering flags on every part", () => {
    expect(
      resolveMoment({ gates, moment: COMMIT }).map(entry => ({
        label: entry.label,
        mayRewrite: entry.mayRewrite,
        costly: entry.costly,
      }))
    ).toEqual([
      { label: "🧹 Lint", mayRewrite: true, costly: false },
      { label: "🧹 Lint", mayRewrite: true, costly: false },
    ]);
  });

  it("never resolves a part to the registry's default task", () => {
    // `code-style` defaults to the `lint` script, and this project has one.
    // The part's command is the prover; naming the script as well would give
    // one entry two things to run.
    const resolved = resolveMoment({
      gates,
      moment: COMMIT,
      scripts: { lint: "eslint ." },
    });

    expect(
      resolved.map(entry => [entry.mode, entry.task, entry.command])
    ).toEqual([
      ["run", null, null],
      ["run", null, null],
    ]);
  });

  it("reads how a part's failure prints from its proof", () => {
    expect(resolveAt(gates, COMMIT).map(entry => entry.failureShape)).toEqual([
      SHAPE,
      null,
    ]);
  });

  it("prefers the shape declared for the moment over the part's", () => {
    expect(resolveAt(gates, PUSH).map(entry => entry.failureShape)).toEqual([
      [PUSH_SHAPE],
      [PUSH_SHAPE],
    ]);
  });

  it("carries the moment's caller chain on every part", () => {
    expect(
      resolveMoment({ gates, moment: PULL_REQUEST }).map(
        entry => entry.callerChain
      )
    ).toEqual([["Checks"], ["Checks"]]);
  });

  it("derives one required context for the gate, not one per part", () => {
    expect(contextsFor(gates, { callerChain: ["Quality"] })).toEqual([
      "Checks / 🧹 Lint",
    ]);
  });

  it("is not reported as unrunnable for lacking the default script", () => {
    // A known manifest with no `lint` script is what makes a bare declaration
    // of this gate unrunnable. With parts, the gate carries its own commands.
    const withParts = configurationProblems({
      gates,
      policy: {},
      scripts: {},
      executedMoments: { moments: [], families: [] },
    });
    const bare = configurationProblems({
      gates: { "code-style": { [COMMIT]: "required" } },
      policy: {},
      scripts: {},
      executedMoments: { moments: [], families: [] },
    });

    expect(withParts.blocking).toEqual([]);
    expect(bare.blocking).toHaveLength(1);
    expect(bare.blocking[0]).toContain("UNRUNNABLE");
  });
});

describe("resolveMoment beside a gate with parts", () => {
  const plain = {
    "code-style": { run: "lint", [COMMIT]: "required" },
    "type-correctness": { [PUSH]: "required" },
  };

  it("resolves a gate with no parts to exactly the keys it always had", () => {
    const mixed = {
      ...plain,
      [LINT]: { [COMMIT]: "required", parts: [API_PART, WEB_PART] },
    };
    const [codeStyle] = resolveAt(mixed, COMMIT);

    expect(codeStyle?.id).toBe("code-style");
    expect(Object.keys(codeStyle ?? {})).toEqual(ESTABLISHED_KEYS);
    expect(codeStyle).toEqual(resolveAt(plain, COMMIT)[0]);
  });

  it("is unchanged by criteria, owner and tier on a gate with no parts", () => {
    const described = {
      "code-style": {
        ...plain["code-style"],
        criteria: ["SI7"],
        owner: "Platform team",
        tier: "advisory",
      },
      "type-correctness": plain["type-correctness"],
    };

    for (const moment of [COMMIT, PUSH]) {
      expect(resolveAt(described, moment)).toEqual(resolveAt(plain, moment));
    }
  });

  it("orders parts among other gates by gate id", () => {
    const mixed = {
      "x-zeta": { run: "zeta", [COMMIT]: "required" },
      [LINT]: { [COMMIT]: "required", parts: [WEB_PART, API_PART] },
      "x-alpha": { run: "alpha", [COMMIT]: "required" },
    };

    expect(
      resolveAt(mixed, COMMIT).map(entry => [entry.id, entry.scope])
    ).toEqual([
      ["x-alpha", undefined],
      [LINT, "web"],
      [LINT, "api"],
      ["x-zeta", undefined],
    ]);
  });
});

describe("resolveMoment on malformed parts", () => {
  it.each([
    ["a command written as one string", [{ scope: "api", command: "go vet" }]],
    ["a scope outside the repository", [{ scope: "../api", command: ["go"] }]],
    ["two parts sharing a scope", [API_PART, API_PART]],
    ["parts that are not a list", API_PART],
  ])("refuses %s rather than hand it to a runner", (_name, parts) => {
    const gates = { [LINT]: { [COMMIT]: "required", parts } };

    expect(() => resolveAt(gates, COMMIT)).toThrow(
      /Invalid gates configuration:\n {2}gates\."x-lint"\.parts/u
    );
  });

  it("refuses them at a moment the gate is not even declared at", () => {
    // Same reason a typo'd moment key is refused at every moment: a block
    // that is wrong is wrong whichever moment asked.
    const gates = {
      [LINT]: { [COMMIT]: "required", parts: [{ scope: "api" }] },
    };

    expect(() => resolveAt(gates, PUSH)).toThrow(
      /gates\."x-lint"\.parts\[0\]\.command is missing/u
    );
  });

  it("reports a misspelt moment and a malformed part in one refusal", () => {
    const gates = {
      [LINT]: {
        [COMMIT]: "required",
        pull_request: "required",
        parts: [{ scope: "api", command: "go vet" }],
      },
    };

    expect(() => resolveAt(gates, COMMIT)).toThrow(
      /Invalid gates configuration:\n {2}gates\."x-lint"\."pull_request" [^\n]+\n {2}gates\."x-lint"\.parts\[0\]\.command/u
    );
  });

  it("is listed as a blocking problem by the reading validate prints", () => {
    // The reading asks the resolver whether each declaration has something to
    // run. On a malformed part the resolver refuses, and that refusal must
    // not replace the list of problems the operator is waiting for.
    const { blocking } = configurationProblems({
      gates: {
        "code-style": {
          [COMMIT]: "required",
          parts: [{ scope: "api", command: "go vet" }],
        },
      },
      policy: {},
      scripts: {},
      executedMoments: { moments: [], families: [] },
    });

    expect(blocking).toHaveLength(1);
    expect(blocking[0]).toContain('gates."code-style".parts[0].command');
  });

  it("refuses a second prover beside the parts", () => {
    const gates = {
      [LINT]: {
        [COMMIT]: { level: "required", run: "lint" },
        parts: [API_PART],
      },
    };

    expect(() => resolveAt(gates, COMMIT)).toThrow(
      /gates\."x-lint"\."commit"\.run/u
    );
  });
});

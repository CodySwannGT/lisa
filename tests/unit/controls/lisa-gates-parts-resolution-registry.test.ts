/**
 * Resolution of a registry gate that declares `parts`, of malformed parts, and
 * of a gate with parts that names a second prover at another moment.
 *
 * Split from `lisa-gates-parts-resolution.test.ts`, which says why a gate with
 * no parts must resolve exactly as it did before the key existed.
 * @module tests/unit/controls/lisa-gates-parts-resolution-registry
 */
import { describe, expect, it } from "vitest";

import {
  configurationProblems,
  contextsFor,
  PROOF_DIRECTORY,
  resolveMoment,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import {
  API_COMMAND,
  API_PART,
  COMMIT,
  LINT,
  PULL_REQUEST,
  PUSH,
  PUSH_SHAPE,
  resolveAt,
  WEB_PART,
} from "./support/lisa-gates-parts-resolution-helpers.js";

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

describe("resolveMoment on a second prover declared at another moment", () => {
  // `await` at pull-request beside parts is refused, at pull-request. The
  // gate's parts are well formed, so commit has exactly one thing to run and
  // nothing about it is in doubt.
  const gates = {
    [LINT]: {
      [COMMIT]: "required",
      [PULL_REQUEST]: { level: "required", await: "ci/style" },
      parts: [API_PART],
    },
  };

  it("resolves the moment the problem does not apply at", () => {
    expect(
      resolveAt(gates, COMMIT).map(({ argv, scope }) => ({ argv, scope }))
    ).toEqual([{ argv: API_COMMAND, scope: "api" }]);
  });

  it("still refuses the moment it does apply at", () => {
    expect(() => resolveAt(gates, PULL_REQUEST)).toThrow(
      /Invalid gates configuration:\n {2}gates\."x-lint"\."pull-request"\.await is declared on a gate that has parts/u
    );
  });

  it("is still a blocking problem in the reading validate prints", () => {
    const { blocking } = configurationProblems({
      gates,
      policy: {},
      scripts: {},
      executedMoments: { moments: [], families: [] },
    });

    expect(blocking.join("\n")).toContain(
      'gates."x-lint"."pull-request".await is declared on a gate that has parts'
    );
  });

  it("still refuses a task named for the whole gate, at every moment", () => {
    const wholeGate = {
      [LINT]: { [COMMIT]: "required", run: "lint", parts: [API_PART] },
    };

    expect(() => resolveAt(wholeGate, PUSH)).toThrow(/gates\."x-lint"\.run/u);
  });
});

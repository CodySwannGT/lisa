/** Observe the standalone workflow's exact plan without starting a subprocess. @module */
import { describe, expect, it } from "vitest";

import {
  contextsFor,
  momentLegs,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

const MOMENT = "pull-request";
const WORKFLOW = ".github/workflows/host-controls.yml";
const EXECUTOR = { platform: "github", path: WORKFLOW };
const CHAIN = ["Host Controls", "Required"];
const LINT = "code-style";
const TESTS = "test-correctness";
const CUSTOM = "x-host-check";

describe("standalone workflow gate plan", () => {
  it("gives scoped checks one job with the exact required name and timeout", () => {
    const gates = {
      [LINT]: {
        [MOMENT]: { level: "required", run: "lint", executor: EXECUTOR },
      },
      [TESTS]: {
        [MOMENT]: {
          level: "required",
          caller_chain: CHAIN,
          executor: EXECUTOR,
        },
        parts: ["api", "web"].map(scope => ({
          scope,
          command: ["node", "check.mjs"],
        })),
      },
    };
    const legs = momentLegs({ gates, moment: MOMENT, hostWorkflow: WORKFLOW });
    expect(legs).toEqual([
      {
        gate: LINT,
        label: "🧹 Lint",
        context: "🔍 Quality Checks / 🧹 Lint",
        level: "required",
        action: "run",
        runner: "node",
        task: "scripts/lisa-run-gates.mjs --moment=pull-request --builtins=none --parts=all --gate=code-style",
        timeout: 15,
      },
      {
        gate: TESTS,
        label: "🧪 Run Unit Tests",
        context: "Host Controls / Required / 🧪 Run Unit Tests",
        level: "required",
        action: "run",
        runner: "node",
        task: "scripts/lisa-run-gates.mjs --moment=pull-request --builtins=none --parts=all --gate=test-correctness",
        timeout: 60,
      },
    ]);
    expect(contextsFor(gates)).toEqual([
      "🔍 Quality Checks / 🧹 Lint",
      "Host Controls / Required / 🧪 Run Unit Tests",
    ]);
  });

  it("reports off and unproved gates without scheduling any other executor", () => {
    const gates = {
      [LINT]: { [MOMENT]: { level: "off", executor: EXECUTOR } },
      [CUSTOM]: { [MOMENT]: { level: "required", executor: EXECUTOR } },
      "build-integrity": {
        [MOMENT]: {
          level: "required",
          run: "build",
          executor: { platform: "github", path: ".github/workflows/other.yml" },
        },
      },
      "type-correctness": {
        [MOMENT]: {
          level: "required",
          run: "typecheck",
          executor: { platform: "gitlab", path: WORKFLOW },
        },
      },
      "code-review": {
        [MOMENT]: {
          level: "required",
          await: "Code Review",
          executor: EXECUTOR,
        },
      },
    };
    const legs = momentLegs({
      gates,
      moment: MOMENT,
      scripts: {},
      hostWorkflow: WORKFLOW,
    });
    expect(legs).toEqual([
      expect.objectContaining({
        gate: LINT,
        level: "off",
        action: "report",
        runner: "",
        task: "",
      }),
      expect.objectContaining({
        gate: CUSTOM,
        level: "required",
        action: "unproved",
        runner: "",
        task: "",
      }),
    ]);
  });

  it.each([
    ["push", WORKFLOW],
    [MOMENT, ""],
    [MOMENT, ".github/workflows/archive/old.yml"],
    [MOMENT, ".github/workflows/host-controls.json"],
  ])("rejects moment %s and workflow %j", (moment, hostWorkflow) => {
    expect(() => momentLegs({ gates: {}, moment, hostWorkflow })).toThrow(
      "Use --host-workflow=.github/workflows/<file>.yml with --moment=pull-request."
    );
  });
});

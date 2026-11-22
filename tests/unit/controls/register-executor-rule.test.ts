/**
 * The gates of one repository name one pull-request executor, or none.
 *
 * One command runs every gate declared at the pull-request moment, so they
 * all run from the same pipeline file. A declaration that names the file on
 * some gates and not on others would leave part of the register reading as
 * enforced with nothing on record to say so; one that names two files says
 * something that cannot be true. Both are refused before a register is
 * written (CodySwannGT/lisa#4991).
 */
import { describe, expect, it } from "vitest";

import { executorsAgree } from "../../../src/controls/pull-request-executor.js";
import { CONTROL_REGISTER_RULES } from "../../../src/controls/register-rules.js";
import {
  F_MIXED_GATES,
  F_PAVED_GATES,
  declarationOf,
  type GatesBlock,
} from "../../helpers/control-register.js";
import {
  LISA_WRITTEN,
  PIPELINE,
  buildExecutorRegister,
  withExecutor,
} from "./support/executor-fixtures.js";

const OTHER = { platform: "gitlab", path: "ci/other.yml" };

/**
 * A custom gate checked at pull-request.
 * @param entry - Its pull-request entry
 * @returns The gate
 */
function gate(entry: unknown): Readonly<Record<string, unknown>> {
  return { run: "lint", "pull-request": entry };
}

/**
 * The problems the rule reports for a declaration.
 * @param block - The `gates` block
 * @returns One line per problem
 */
function problemsOf(block: GatesBlock): readonly string[] {
  return executorsAgree({ declaration: declarationOf(block) });
}

describe("the rule", () => {
  it("is one of the rules a declaration is held to", () => {
    expect(CONTROL_REGISTER_RULES).toContain(executorsAgree);
  });

  it.each([
    ["names no executor", F_MIXED_GATES],
    ["names the same one on every gate", withExecutor(F_MIXED_GATES)],
    [
      "names the same one Lisa wrote",
      withExecutor(F_PAVED_GATES, LISA_WRITTEN),
    ],
    [
      "names one that differs only in the project's own keys",
      {
        "x-a": gate({ level: "required", executor: PIPELINE }),
        "x-b": gate({
          level: "optional",
          executor: { ...PIPELINE, "x-note": "owned by ops" },
        }),
      },
    ],
  ])("accepts a declaration that %s", (_name, block) => {
    expect(problemsOf(block)).toEqual([]);
  });

  it("refuses two different executors, naming who says what", () => {
    const problems = problemsOf({
      "x-a": gate({ level: "required", executor: PIPELINE }),
      "x-b": gate({ level: "required", executor: OTHER }),
      "x-c": gate({ level: "required", executor: PIPELINE }),
    });

    expect(problems).toEqual([
      'The gates block in .lisa.config.json names more than one file that runs the gates on a pull request: "x-a" and "x-c" name .gitlab-ci.yml on gitlab; "x-b" names ci/other.yml on gitlab. One command runs every gate checked at the pull-request moment, so they all run from one file. Write the same executor on each of these gates.',
    ]);
  });

  it("refuses the same file on two platforms", () => {
    expect(
      problemsOf({
        "x-a": gate({ level: "required", executor: PIPELINE }),
        "x-b": gate({
          level: "required",
          executor: { ...PIPELINE, platform: "gitea" },
        }),
      })
    ).toHaveLength(1);
  });

  it("refuses a gate checked at pull-request that names none when another names one", () => {
    const problems = problemsOf({
      "x-a": gate({ level: "required", executor: PIPELINE }),
      "x-b": gate("required"),
      "x-c": gate({ level: "optional" }),
    });

    expect(problems).toEqual([
      'The gate "x-b" in .lisa.config.json is checked at the pull-request moment but does not name the file that runs it there, and the gate "x-a" does (.gitlab-ci.yml on gitlab). One command runs every gate checked at that moment, so they all run from one file. Name it on "x-b" too: "pull-request": { "level": "required", "executor": { "platform": "gitlab", "path": ".gitlab-ci.yml" } }, keeping anything else that entry already says.',
      'The gate "x-c" in .lisa.config.json is checked at the pull-request moment but does not name the file that runs it there, and the gate "x-a" does (.gitlab-ci.yml on gitlab). One command runs every gate checked at that moment, so they all run from one file. Name it on "x-c" too: "pull-request": { "level": "optional", "executor": { "platform": "gitlab", "path": ".gitlab-ci.yml" } }, keeping anything else that entry already says.',
    ]);
  });

  it.each([
    ["is off at pull-request", gate("off")],
    ["is off there, written as an object", gate({ level: "off" })],
    ["is not declared at pull-request", { run: "lint", commit: "required" }],
    [
      "waits there for a check another system reports",
      gate({ level: "required", await: "Review Bot" }),
    ],
  ])("leaves alone a gate that %s", (_name, other) => {
    expect(
      problemsOf({
        "x-a": gate({ level: "required", executor: PIPELINE }),
        "x-b": other,
      })
    ).toEqual([]);
  });

  it("does not excuse a gate whose await names nothing, as the gate registry does not", () => {
    expect(
      problemsOf({
        "x-a": gate({ level: "required", executor: PIPELINE }),
        "x-b": gate({ level: "required", await: "" }),
      })
    ).toHaveLength(1);
  });

  it("is not asked to agree with an executor on a gate that is off", () => {
    expect(
      problemsOf({
        "x-a": gate({ level: "off", executor: OTHER }),
        "x-b": gate({ level: "required", executor: PIPELINE }),
      })
    ).toEqual([]);
  });
});

describe("a declaration the rule refuses", () => {
  it("produces no register", async () => {
    const built = await buildExecutorRegister({
      "x-a": gate({ level: "required", executor: PIPELINE }),
      "x-b": gate("required"),
    });

    expect(built.problems).toHaveLength(1);
    expect(built.problems?.[0]).toContain('The gate "x-b"');
  });
});

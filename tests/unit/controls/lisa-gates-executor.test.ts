/**
 * Validation of `executor`, the key a gate's pull-request moment uses to name
 * the file that runs the gates on the platform hosting the repository.
 *
 * Lisa ships that file for one platform. On any other, the host's agent writes
 * it, and the declaration says where it is so the control register can record
 * the fact. Every refusal here is read by an operator, so each assertion
 * checks that the message names the gate and the key at fault
 * (CodySwannGT/lisa#4991).
 * @module tests/unit/controls/lisa-gates-executor
 */
import { describe, expect, it } from "vitest";

import {
  EXECUTOR_FIELD,
  EXECUTOR_FIELDS,
  LISA_EXECUTOR_PLATFORM,
  PULL_REQUEST,
  resolveMoment,
  validateGates,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

/** A gate this project invented, so the registry has no opinion about it. */
const GATE = "x-lint";

/** Where every problem about that gate's executor is reported. */
const WHERE = `gates."${GATE}"."${PULL_REQUEST}".${EXECUTOR_FIELD}`;

/** Where a platform Lisa ships nothing for reads its pipeline from. */
const PIPELINE_FILE = ".gitlab-ci.yml";

/** A pipeline file on a platform Lisa ships nothing for. */
const EXECUTOR = { platform: "gitlab", path: PIPELINE_FILE };

/** The title shared by every table of malformed values. */
const REFUSED_WHEN = "is refused when it is %s";

/**
 * A gates block holding one custom gate with an executor at one moment.
 * @param executor - The moment's `executor` value, well-formed or not
 * @param moment - The moment the executor is declared at
 * @returns The gates block
 */
const blockWith = (
  executor: unknown,
  moment: string = PULL_REQUEST
): Record<string, unknown> => ({
  [GATE]: { run: "lint", [moment]: { level: "required", executor } },
});

/**
 * The problems reported for one custom gate with the given executor.
 * @param executor - The moment's `executor` value
 * @param moment - The moment the executor is declared at
 * @returns Every problem validation reports
 */
const problemsFor = (executor: unknown, moment?: string): string[] =>
  validateGates(blockWith(executor, moment));

describe("the executor of a gate's pull-request moment", () => {
  it("is read as a platform and a path, and nothing else", () => {
    expect(EXECUTOR_FIELD).toBe("executor");
    expect(EXECUTOR_FIELDS).toEqual(["platform", "path"]);
    expect(LISA_EXECUTOR_PLATFORM).toBe("github");
  });

  it.each([
    ["a pipeline file at the repository root", EXECUTOR],
    [
      "a file in a folder",
      { platform: "azure-devops", path: "ci/pull-request.yml" },
    ],
    [
      "the platform Lisa ships the file for",
      { platform: LISA_EXECUTOR_PLATFORM, path: ".github/workflows/ci.yml" },
    ],
    ["a key of the project's own", { ...EXECUTOR, "x-note": "owned by ops" }],
  ])("is accepted for %s", (_name, executor) => {
    expect(problemsFor(executor)).toEqual([]);
  });

  it("leaves a gate that names none exactly as it was", () => {
    expect(
      validateGates({ [GATE]: { run: "lint", [PULL_REQUEST]: "required" } })
    ).toEqual([]);
  });

  it("changes nothing about what the moment resolves to", () => {
    const resolve = (gates: Record<string, unknown>): unknown =>
      resolveMoment({
        gates,
        moment: PULL_REQUEST,
        runner: "npm run",
        scripts: { lint: "eslint ." },
      });

    expect(resolve(blockWith(EXECUTOR))).toEqual(
      resolve({ [GATE]: { run: "lint", [PULL_REQUEST]: "required" } })
    );
  });
});

describe("an executor that is not an object naming both keys", () => {
  it.each([
    ["a string", PIPELINE_FILE],
    ["a list", [PIPELINE_FILE]],
    ["null", null],
    ["a number", 7],
  ])(REFUSED_WHEN, (_name, executor) => {
    const problems = problemsFor(executor);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${WHERE} is ${JSON.stringify(executor)}`);
    expect(problems[0]).toContain('"platform"');
    expect(problems[0]).toContain('"path"');
  });

  it("is refused for a key Lisa does not read there, with the nearest one", () => {
    const problems = problemsFor({ ...EXECUTOR, plaform: "gitlab" });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${WHERE}.plaform is not a key Lisa reads`);
    expect(problems[0]).toContain('Did you mean "platform"?');
  });
});

describe("the platform of an executor", () => {
  it.each([
    ["missing", undefined],
    ["blank", "  "],
    ["empty", ""],
    ["a number", 3],
    ["written with a capital", "GitLab"],
    ["written with a space", "azure devops"],
    ["written with a trailing hyphen", "gitlab-"],
  ])(REFUSED_WHEN, (_name, platform) => {
    const problems = problemsFor({ ...EXECUTOR, platform });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${WHERE}.platform`);
    expect(problems[0]).toContain("lower-case");
  });

  it("is told how to write the one platform Lisa knows", () => {
    expect(problemsFor({ ...EXECUTOR, platform: "GitHub" })[0]).toContain(
      `"${LISA_EXECUTOR_PLATFORM}"`
    );
  });
});

describe("the path of an executor", () => {
  it.each([
    ["missing", undefined, "is missing"],
    ["blank", " ", "expected the path of the file"],
    ["a list", ["ci.yml"], "expected the path of the file"],
    ["the repository itself", ".", "names the repository itself"],
    ["written with a leading ./", "./ci.yml", "written a longer way"],
    ["written with a trailing /", "ci/", "written a longer way"],
    ["outside the repository", "../ci.yml", "outside the repository"],
    ["absolute", "/etc/ci.yml", "top of the disk"],
    ["written with a backslash", "ci\\pr.yml", "backslash"],
  ])(REFUSED_WHEN, (_name, path, reason) => {
    const problems = problemsFor({ ...EXECUTOR, path });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${WHERE}.path`);
    expect(problems[0]).toContain(reason);
  });
});

describe("an executor at a moment other than pull-request", () => {
  it.each(["commit", "push", "pre-deploy:production", "continuous:staging"])(
    "is refused at %s",
    moment => {
      const problems = problemsFor(EXECUTOR, moment);

      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(
        `gates."${GATE}"."${moment}".${EXECUTOR_FIELD}`
      );
      expect(problems[0]).toContain(`"${PULL_REQUEST}"`);
    }
  );

  it("is refused once, without also judging its contents", () => {
    expect(problemsFor({ platform: "GitLab" }, "commit")).toHaveLength(1);
  });
});

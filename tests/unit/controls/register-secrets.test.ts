/**
 * `lisa controls register` refuses a declaration that holds a secret's
 * value.
 *
 * Everything in the control register is copied from the `gates` block of
 * `.lisa.config.json`, and the register is committed. A value shaped like a
 * credential anywhere in the declaration stops the register from being
 * written or compared; the line names the place and never the value.
 *
 * Every credential-shaped value in this suite is made up when the test runs.
 * None is written in this file (CodySwannGT/lisa#4999).
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { generateControlRegister } from "../../../src/controls/register.js";
import { CONTROL_REGISTER_RULES } from "../../../src/controls/register-rules.js";
import { declarationHoldsNoSecretValues } from "../../../src/controls/register-secrets-rule.js";
import { CONTROL_REGISTER_PATH } from "../../../src/controls/register-types.js";
import { fakeCredential } from "../../helpers/audit-probes.js";
import {
  declarationOf,
  evidenceAt,
  F_NONE_GATES,
  FIXTURE_GATES,
  DECLARED_FIXTURES,
  type GatesBlock,
} from "../../helpers/control-register.js";
import { fakeGithubToken, fakeHex } from "../../helpers/fake-credentials.js";
import { declared, register } from "./support/register-run.js";
import { removeFixtures } from "./support/report-check-run.js";

afterEach(removeFixtures);

const TOKEN = fakeGithubToken();
const RANDOM = fakeCredential();
const CONFIG = ".lisa.config.json";
const GITHUB = "a GitHub token";
const NAMED =
  "a long random-looking value beside a name such as token, secret or password";

/**
 * The one line the rule is expected to give.
 * @param place - Where in the declaration the value is
 * @param shape - What the value is shaped like
 * @returns The line
 */
function refusal(place: string, shape: string = GITHUB): string {
  return `${CONFIG} holds something shaped like a credential at ${place}: ${shape}. Take the value out and write the name it goes by instead. The value is not repeated here.`;
}

/**
 * A declaration with one part checking the whole repository.
 * @param part - What differs from a plain lint part
 * @param gate - What differs on the gate itself
 * @returns The gates block
 */
function lint(
  part: Readonly<Record<string, unknown>> = {},
  gate: Readonly<Record<string, unknown>> = {}
): GatesBlock {
  return {
    "code-style": {
      commit: "required",
      criteria: ["SI7"],
      ...gate,
      parts: [
        {
          scope: ".",
          command: ["ruff", "check", "."],
          evidence: evidenceAt("ruff.toml"),
          ...part,
        },
      ],
    },
  };
}

/**
 * What the rule says about a declaration.
 * @param gates - The gates block
 * @returns One line per problem
 */
function found(gates: GatesBlock): readonly string[] {
  return declarationHoldsNoSecretValues({ declaration: declarationOf(gates) });
}

const PART = "gates.code-style.parts[0]";

describe("a declaration that names things without showing them", () => {
  it.each(DECLARED_FIXTURES)("passes for %s", name => {
    expect(found(FIXTURE_GATES[name])).toEqual([]);
  });

  it("passes for a parameter that names the secret a check reads", () => {
    const gates = lint({
      parameters: {
        "token-variable": { value: "DEPLOY_TOKEN" },
        "lockfile-digest": { value: fakeHex(9, 64) },
        "pinned-commit": { value: fakeHex() },
      },
    });

    expect(found(gates)).toEqual([]);
  });

  it("is one of the rules a declaration is held to before a register is made", () => {
    expect(CONTROL_REGISTER_RULES).toContain(declarationHoldsNoSecretValues);
  });
});

describe("a declaration that holds something shaped like a credential", () => {
  it.each([
    [
      "a parameter's value",
      lint({ parameters: { limit: { value: TOKEN } } }),
      refusal(`${PART}.parameters.limit.value`),
    ],
    [
      "a random-looking value in a parameter named as a secret",
      lint({ parameters: { api_token: { value: RANDOM } } }),
      refusal(`${PART}.parameters.api_token.value`, NAMED),
    ],
    [
      "an argument of the command",
      lint({ command: ["ruff", "check", `--token=${TOKEN}`] }),
      refusal(`${PART}.command[2]`),
    ],
    [
      "the argument after a flag that names a secret",
      lint({ command: ["deploy", "--password", RANDOM] }),
      refusal(`${PART}.command[2]`, NAMED),
    ],
    [
      "the failure text of a proof",
      lint({ proof: { failure_shape: [`denied for ${TOKEN}`] } }),
      refusal(`${PART}.proof.failure_shape[0]`),
    ],
    [
      "what a proof says it does outside the repository",
      lint({ proof: { external_effects: [`posts with ${TOKEN}`] } }),
      refusal(`${PART}.proof.external_effects[0]`),
    ],
    [
      "the gate's owner",
      lint({}, { owner: TOKEN }),
      refusal("gates.code-style.owner"),
    ],
    [
      "the task runner",
      { ...lint(), runner: `env NPM_TOKEN=${RANDOM} npm run` },
      refusal("gates.runner", NAMED),
    ],
  ])("is refused for %s, naming the place", (_name, gates, line) => {
    expect(found(gates)).toEqual([line]);
  });

  it("is refused for a gate whose own name is shaped like one, without writing the name", () => {
    const lines = found({ [TOKEN]: { commit: "required" } });

    expect(lines).toEqual([
      `${CONFIG} holds a name that is itself shaped like a credential, among the names at gates: ${GITHUB}. Give it a name that is not a secret. The value is not repeated here.`,
    ]);
    expect(lines.join("\n")).not.toContain(TOKEN);
  });
});

describe("the command, given a parameter that holds a credential-shaped string", () => {
  const SEEDED: GatesBlock = {
    ...F_NONE_GATES,
    "coverage-adequacy": {
      "pull-request": "required",
      criteria: ["SI2"],
      parts: [
        {
          scope: ".",
          command: ["python", "-m", "pytest", "--cov"],
          parameters: { "upload-token": { value: TOKEN } },
          evidence: { questions: ["SI2@."] },
        },
      ],
    },
  };
  const PLACE =
    "gates.coverage-adequacy.parts[0].parameters.upload-token.value";

  it("exits non-zero, names the JSON path, prints no value and writes nothing", async () => {
    const repoPath = declared("F-none", SEEDED);

    const run = await register(repoPath);
    const said = [...run.stdout, ...run.stderr].join("\n");

    expect(run.code).toBe(1);
    expect(run.stdout).toEqual([]);
    expect(run.stderr).toEqual([
      refusal(PLACE),
      `register: FAIL. 1 problem with the gates declaration in ${CONFIG}, so no register could be generated. Fix the declaration, then run this again`,
    ]);
    expect(said).not.toContain(TOKEN);
    expect(said).not.toContain(TOKEN.slice(4, 16));
    expect(existsSync(path.join(repoPath, CONTROL_REGISTER_PATH))).toBe(false);
  });

  it("refuses the same way when asked only to check", async () => {
    const repoPath = declared("F-none", SEEDED);

    const run = await register(repoPath, true);

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toBe(refusal(PLACE));
    expect(run.stderr.join("\n")).not.toContain(TOKEN);
  });

  it("writes the register once the value is replaced by the name it goes by", async () => {
    const repoPath = declared("F-none", {
      ...SEEDED,
      "coverage-adequacy": {
        "pull-request": "required",
        criteria: ["SI2"],
        parts: [
          {
            scope: ".",
            command: ["python", "-m", "pytest", "--cov"],
            parameters: { "upload-token": { value: "COVERAGE_UPLOAD_TOKEN" } },
            evidence: { questions: ["SI2@."] },
          },
        ],
      },
    });

    const run = await register(repoPath);

    expect(run.stderr).toEqual([]);
    expect(run.code).toBe(0);
  });

  it("never hands back a problem that repeats a value the declaration holds", async () => {
    // The gate registry refuses a gate it does not know before any register
    // rule runs, and its message quotes the gate's name.
    const repoPath = declared("F-none", { [TOKEN]: { commit: "required" } });

    const generated = await generateControlRegister(repoPath);
    const problems = (generated.problems ?? []).join("\n");

    expect(problems).toContain('gates."[REDACTED:GITHUB_TOKEN]" is not a gate');
    expect(problems).not.toContain(TOKEN);
  });

  it("prints no value when the gate registry itself refuses the declaration", async () => {
    const repoPath = declared("F-none", { [TOKEN]: { commit: "required" } });

    const run = await register(repoPath);

    expect(run.code).toBe(1);
    expect(run.stderr.join("\n")).not.toContain(TOKEN);
  });
});

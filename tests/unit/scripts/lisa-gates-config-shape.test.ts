/**
 * A `.lisa.config.json` that is valid JSON and is not a configuration.
 *
 * The file holds one JSON object. A file holding a list, a number or `null`
 * parses without error, and read loosely it looks like a configuration that
 * declares nothing: every reader then reports "no gates" for a file somebody
 * damaged. So the reader refuses it, in a sentence an operator can act on.
 * The same goes for a `gates` value that is not an object.
 * @module tests/unit/scripts/lisa-gates-config-shape
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readGates } from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { EXIT } from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const SCRIPTS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../all/copy-overwrite/scripts"
);
const CONFIG = ".lisa.config.json";
const ADVICE =
  "It has to hold one JSON object: { ... }. Nothing was read from it.";

/** File contents that parse as JSON and are not an object, and their name. */
const NOT_AN_OBJECT = [
  ["[]", "a list"],
  ['[{"gates":{}}]', "a list"],
  ["null", "null"],
  ['"gates"', "text"],
  ["7", "a number"],
  ["true", "true or false"],
] as const;

/** `gates` values that are not an object, and their name. */
const GATES_NOT_AN_OBJECT = [
  ["[]", "a list"],
  ['["code-style"]', "a list"],
  ['"code-style"', "text"],
  ["7", "a number"],
  ["false", "true or false"],
] as const;

/** The two kinds of caller that start the runner, and the flags each adds. */
const RUNNER_CALLERS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["a caller with no built-in checks", ["--builtins=none"]],
  ["a stack hook", []],
];

let root: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "lisa-config-shape-")));
});
afterEach(() => rmSync(root, { force: true, recursive: true }));

/**
 * Write the configuration file with exactly the given text.
 * @param text - The file's content
 */
function writeConfig(text: string): void {
  writeFileSync(path.join(root, CONFIG), text);
}

/**
 * Start one of the two shipped gate scripts in the folder.
 * @param script - The script's file name
 * @param args - Arguments after the script
 * @returns The finished child
 */
function start(
  script: string,
  args: readonly string[]
): ReturnType<typeof boundedSpawnSync> {
  return boundedSpawnSync({
    args: [path.join(SCRIPTS, script), ...args],
    command: process.execPath,
    cwd: root,
    label: `${script} ${args.join(" ")} on a config that is not an object`,
  });
}

describe("reading a configuration file that is not a JSON object", () => {
  it.each(NOT_AN_OBJECT)("refuses %s, and says it holds %s", (text, name) => {
    writeConfig(text);

    expect(() => readGates(root)).toThrow(
      new Error(`${CONFIG} holds ${name}. ${ADVICE}`)
    );
  });

  it.each(GATES_NOT_AN_OBJECT)(
    "refuses a gates value of %s, and says it is %s",
    (text, name) => {
      writeConfig(`{"gates": ${text}}`);

      expect(() => readGates(root)).toThrow(
        new Error(
          `"gates" in ${CONFIG} is ${name}. It has to be one JSON object ` +
            `holding a gate per key: { ... }. No gate was read from it.`
        )
      );
    }
  );

  it("still reads an object that declares nothing as declaring nothing", () => {
    writeConfig("{}");
    expect(readGates(root).gates).toEqual({});

    writeConfig('{"gates": {}}');
    expect(readGates(root).gates).toEqual({});

    writeConfig('{"gates": null}');
    expect(readGates(root).gates).toEqual({});
  });
});

describe("the shipped scripts on a configuration file that is a list", () => {
  beforeEach(() => writeConfig("[]"));

  it("validate refuses it in one sentence", () => {
    const child = start("lisa-gates.mjs", ["validate"]);

    expect(child.status).toBe(1);
    expect(child.stderr.trim()).toBe(`${CONFIG} holds a list. ${ADVICE}`);
    expect(child.stdout).not.toContain("configuration is valid");
  });

  it.each(RUNNER_CALLERS)(
    "the runner stops %s rather than report nothing declared",
    (_who, flags) => {
      const child = start("lisa-run-gates.mjs", ["--moment=commit", ...flags]);

      expect(child.status).toBe(EXIT.RUNNER_FAILED);
      expect(child.stderr).toContain(`${CONFIG} holds a list.`);
      expect(child.stdout).not.toContain("No gates are declared");
    }
  );
});

describe("the shipped scripts on a configuration file that is null", () => {
  it("validate says what is wrong rather than how the reader broke", () => {
    writeConfig("null");

    const child = start("lisa-gates.mjs", ["validate"]);

    expect(child.status).toBe(1);
    expect(child.stderr.trim()).toBe(`${CONFIG} holds null. ${ADVICE}`);
    expect(child.stderr).not.toContain("Cannot read properties");
  });
});

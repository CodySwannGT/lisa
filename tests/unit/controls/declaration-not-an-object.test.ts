/**
 * The control commands on a `.lisa.config.json` that is not a JSON object.
 *
 * A file holding `[]` parses as JSON. Read as "declares no gates" it made
 * `lisa controls register` answer PASS with no entries and write an empty
 * register over whatever was there. Both commands that read the declaration
 * refuse it instead, and write nothing.
 */
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CONTROL_REGISTER_PATH } from "../../../src/controls/register-types.js";
import { buildFEmpty } from "../../helpers/control-audit-fixtures.js";
import { declarationCheck } from "./support/declaration-check-run.js";
import { register } from "./support/register-run.js";
import { keep, removeFixtures } from "./support/report-check-run.js";

const CONFIG = ".lisa.config.json";

/** File contents that are valid JSON and not a configuration. */
const NOT_A_CONFIGURATION = [
  ["[]", `${CONFIG} holds a list.`],
  ["null", `${CONFIG} holds null.`],
  ['{"gates": []}', `"gates" in ${CONFIG} is a list.`],
] as const;

afterEach(removeFixtures);

/**
 * A repository whose configuration file holds exactly the given text.
 * @param text - The file's content
 * @returns The repository root
 */
function repositoryWith(text: string): string {
  const { repoPath } = keep(buildFEmpty());
  writeFileSync(path.join(repoPath, CONFIG), text);
  return repoPath;
}

describe.each(NOT_A_CONFIGURATION)(
  "a configuration file holding %s",
  (text, said) => {
    it("is refused by `lisa controls register`, which writes no register", async () => {
      const repoPath = repositoryWith(text);

      const run = await register(repoPath);

      expect(run.code).toBe(1);
      expect(run.stdout).toEqual([]);
      expect(run.stderr[0]).toContain(said);
      expect(run.stderr.at(-1)).toMatch(/^register: FAIL\./u);
      expect(existsSync(path.join(repoPath, CONTROL_REGISTER_PATH))).toBe(
        false
      );
    });

    it("is refused by `lisa controls register --check`", async () => {
      const run = await register(repositoryWith(text), true);

      expect(run.code).toBe(1);
      expect(run.stderr[0]).toContain(said);
    });

    it("is refused by `lisa controls declaration-check`", async () => {
      const run = await declarationCheck(repositoryWith(text));

      expect(run.code).toBe(1);
      expect(run.stderr.join("\n")).toContain(said);
      expect(run.stdout.join("\n")).not.toContain("PASS");
    });
  }
);

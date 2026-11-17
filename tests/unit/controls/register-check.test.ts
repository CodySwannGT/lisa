/**
 * `lisa controls register --check` against real repositories.
 *
 * The register is generated, so the only correct content is what generating
 * it again would write. This is the check that fails when someone edits the
 * file by hand, or changes the declaration and does not regenerate: it names
 * the entry that differs, says how to put it right, and writes nothing
 * (CodySwannGT/lisa#4983).
 */
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CONTROL_REGISTER_PATH } from "../../../src/controls/register-types.js";
import {
  DECLARED_FIXTURES,
  F_MIXED_GATES,
  configFile,
} from "../../helpers/control-register.js";
import {
  declared,
  editRegister,
  readRegister,
  register,
  writeRegister,
} from "./support/register-run.js";
import { removeFixtures } from "./support/report-check-run.js";

/**
 * The last line of a failed check.
 * @param count - How many differences, in words
 * @returns The line
 */
function failed(count: string): string {
  return `register --check: FAIL. ${count} between ${CONTROL_REGISTER_PATH} and the gates declaration in .lisa.config.json. The register is generated, so do not edit it by hand. If a rule should change, change the gates block in .lisa.config.json. Then run "lisa controls register" to write the file again.`;
}

const ONE_DIFFERENCE = failed("1 difference");

/**
 * Build F-mixed with its register already generated.
 * @returns The repository root and the generated file content
 */
async function generatedMixed(): Promise<{
  readonly repoPath: string;
  readonly generated: string;
}> {
  const repoPath = declared("F-mixed");
  await register(repoPath);
  return { repoPath, generated: readRegister(repoPath) };
}

afterEach(removeFixtures);

describe("a register that matches its declaration", () => {
  it.each(DECLARED_FIXTURES)("passes for %s and writes nothing", async name => {
    const repoPath = declared(name);
    await register(repoPath);
    const generated = readRegister(repoPath);

    const run = await register(repoPath, true);

    expect(run.stderr).toEqual([]);
    expect(run.code).toBe(0);
    expect(run.stdout).toEqual([
      expect.stringMatching(
        /^register --check: PASS\. \.lisa\/controls\/register\.json matches the gates declaration \(\d+ entries from \d+ gates\)$/u
      ),
    ]);
    expect(readRegister(repoPath)).toBe(generated);
  });
});

describe("a register edited by hand", () => {
  it("fails, names the entry and the field, and says how to put it right", async () => {
    const { repoPath } = await generatedMixed();
    editRegister(repoPath, document => {
      Object.assign(document.entries[0] ?? {}, { tier: "advisory" });
    });

    const run = await register(repoPath, true);

    expect(run.code).toBe(1);
    expect(run.stdout).toEqual([]);
    expect(run.stderr).toEqual([
      `The entry "code-style@api" in ${CONTROL_REGISTER_PATH} does not match the gates declaration: tier differs.`,
      ONE_DIFFERENCE,
    ]);
  });

  it("leaves the edited file alone, and regenerating restores it byte for byte", async () => {
    const { repoPath, generated } = await generatedMixed();
    editRegister(repoPath, document => {
      Object.assign(document.entries[1] ?? {}, {
        measuring_mechanism: { kind: "command", argv: ["true"] },
        accountable_party: "Nobody",
      });
    });
    const edited = readRegister(repoPath);

    const check = await register(repoPath, true);
    const untouched = readRegister(repoPath);
    const rewrite = await register(repoPath);

    expect(check.stderr[0]).toBe(
      `The entry "code-style@web" in ${CONTROL_REGISTER_PATH} does not match the gates declaration: accountable_party, measuring_mechanism differ.`
    );
    expect(untouched).toBe(edited);
    expect(rewrite.stdout).toEqual([
      `register: PASS. 3 entries from 2 gates; wrote ${CONTROL_REGISTER_PATH}`,
    ]);
    expect(readRegister(repoPath)).toBe(generated);
    expect((await register(repoPath, true)).code).toBe(0);
  });

  it("names an entry that was removed and one that was added", async () => {
    const { repoPath } = await generatedMixed();
    editRegister(repoPath, document => {
      const [first] = document.entries.splice(0, 1);
      document.entries.push({ ...first, id: "code-style@docs", scope: "docs" });
    });

    const run = await register(repoPath, true);

    expect(run.stderr).toEqual([
      `The entry "code-style@api" is missing from ${CONTROL_REGISTER_PATH}: the gates declaration produces it.`,
      `The entry "code-style@docs" is in ${CONTROL_REGISTER_PATH}, but nothing in the gates declaration produces it.`,
      failed("2 differences"),
    ]);
  });

  it("fails on a key added outside the entries", async () => {
    const { repoPath } = await generatedMixed();
    editRegister(repoPath, document => {
      Object.assign(document, { approved_by: "someone" });
    });

    const run = await register(repoPath, true);

    expect(run.stderr[0]).toBe(
      `${CONTROL_REGISTER_PATH} does not match the gates declaration outside its entries: approved_by differs.`
    );
    expect(run.code).toBe(1);
  });

  it("fails on entries put in another order, though each one matches", async () => {
    const { repoPath } = await generatedMixed();
    editRegister(repoPath, document => {
      document.entries.reverse();
    });

    const run = await register(repoPath, true);

    expect(run.stderr[0]).toBe(
      `Every entry in ${CONTROL_REGISTER_PATH} matches the gates declaration, but the entries are not in the order they are generated in.`
    );
    expect(run.code).toBe(1);
  });

  it("fails on a reformatted file, though every entry matches", async () => {
    const { repoPath, generated } = await generatedMixed();
    writeRegister(repoPath, JSON.stringify(JSON.parse(generated)));

    const run = await register(repoPath, true);

    expect(run.stderr[0]).toBe(
      `Every entry in ${CONTROL_REGISTER_PATH} matches the gates declaration, but the file's spacing or the order of its keys is not what is generated.`
    );
    expect(run.code).toBe(1);
  });

  it("fails on a file that is no longer JSON", async () => {
    const { repoPath, generated } = await generatedMixed();
    writeRegister(repoPath, generated.slice(0, -3));

    const run = await register(repoPath, true);

    expect(run.stderr[0]).toMatch(
      /^\.lisa\/controls\/register\.json is not valid JSON, so it cannot be compared with the gates declaration\. \(.+\)$/u
    );
    expect(run.code).toBe(1);
  });
});

describe("a declaration changed without regenerating", () => {
  it("names the entry the change belongs to", async () => {
    const { repoPath } = await generatedMixed();
    writeFileSync(
      path.join(repoPath, ".lisa.config.json"),
      configFile({
        ...F_MIXED_GATES,
        "type-correctness": {
          push: "required",
          "pull-request": "required",
          parts: [{ scope: "web", command: ["npx", "tsc", "--noEmit"] }],
        },
      })
    );

    const run = await register(repoPath, true);

    expect(run.stderr).toEqual([
      `The entry "type-correctness@web" in ${CONTROL_REGISTER_PATH} does not match the gates declaration: accountable_party, enforcement_points, tier differ.`,
      ONE_DIFFERENCE,
    ]);
  });

  it("refuses to compare against a declaration that is not valid", async () => {
    const { repoPath } = await generatedMixed();
    writeFileSync(
      path.join(repoPath, ".lisa.config.json"),
      configFile({ "code-style": { commit: "sometimes" } })
    );

    const run = await register(repoPath, true);

    expect(run.code).toBe(1);
    expect(run.stderr.at(-1)).toBe(
      "register --check: FAIL. 1 problem with the gates declaration in .lisa.config.json, so no register could be generated. Fix the declaration, then run this again"
    );
  });
});

describe("a repository with no register", () => {
  it("fails and says to generate one, without writing it", async () => {
    const repoPath = declared("F-none");

    const run = await register(repoPath, true);

    expect(run.stderr).toEqual([
      `No control register was found at ${CONTROL_REGISTER_PATH}. Run "lisa controls register" to write it.`,
      ONE_DIFFERENCE,
    ]);
    expect(run.code).toBe(1);
    expect(() => readRegister(repoPath)).toThrow();
  });

  it("fails the same way after the register is deleted", async () => {
    const { repoPath } = await generatedMixed();
    rmSync(path.join(repoPath, CONTROL_REGISTER_PATH));

    expect((await register(repoPath, true)).code).toBe(1);
  });
});

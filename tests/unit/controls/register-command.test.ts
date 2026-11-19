/**
 * `lisa controls register` against real repositories.
 *
 * The command turns the gates declaration into the one file an operator or an
 * auditor reads to see what governs a repository. Every case runs on a
 * fixture repository where Lisa was never applied, and for F-none and F-mixed
 * one with no `package.json` at its root (CodySwannGT/lisa#4983).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CONTROL_REGISTER_PATH,
  type ControlRegister,
} from "../../../src/controls/register-types.js";
import {
  buildFEmpty,
  runControlAuditGit,
} from "../../helpers/control-audit-fixtures.js";
import {
  DECLARED_FIXTURES,
  registerSchemaErrors,
} from "../../helpers/control-register.js";
import { declared, readRegister, register } from "./support/register-run.js";
import { keep, removeFixtures } from "./support/report-check-run.js";
import { createSymlink } from "../../support/borrowed-node-modules.mjs";

afterEach(removeFixtures);

describe("generating the register", () => {
  it.each(DECLARED_FIXTURES)(
    "writes a register for %s that the published schema accepts",
    async name => {
      const repoPath = declared(name);

      const run = await register(repoPath);

      expect(run.stderr).toEqual([]);
      expect(run.code).toBe(0);
      expect(registerSchemaErrors(JSON.parse(readRegister(repoPath)))).toEqual(
        []
      );
    }
  );

  it.each(DECLARED_FIXTURES)(
    "writes the same bytes for %s on a second run, and says nothing changed",
    async name => {
      const repoPath = declared(name);
      await register(repoPath);
      const first = readRegister(repoPath);

      const second = await register(repoPath);

      expect(readRegister(repoPath)).toBe(first);
      expect(second.stdout).toEqual([
        expect.stringMatching(
          /^register: PASS\. \d+ entries from \d+ gates; \.lisa\/controls\/register\.json is already up to date$/u
        ),
      ]);
    }
  );

  it("gives the lint requirement one entry per part on F-mixed, with different folders and commands", async () => {
    const repoPath = declared("F-mixed");

    await register(repoPath);
    const lint = (
      JSON.parse(readRegister(repoPath)) as ControlRegister
    ).entries.filter(entry => entry.criteria.includes("SI7"));

    expect(
      lint.map(entry => [entry.id, entry.scope, entry.measuring_mechanism])
    ).toEqual([
      [
        "code-style@api",
        "api",
        { argv: ["ruff", "check", "."], kind: "command" },
      ],
      [
        "code-style@web",
        "web",
        { argv: ["npm", "run", "lint"], kind: "command" },
      ],
    ]);
  });

  it("says what it generated and where it wrote it, and writes nothing else", async () => {
    const repoPath = declared("F-mixed");

    const run = await register(repoPath);

    expect(run.stdout).toEqual([
      `register: PASS. 3 entries from 2 gates; wrote ${CONTROL_REGISTER_PATH}`,
    ]);
    expect(
      runControlAuditGit(repoPath, [
        "status",
        "--porcelain",
        "--untracked-files=all",
      ])
    ).toBe(`?? ${CONTROL_REGISTER_PATH}`);
  });

  it("works with no package.json and takes the working directory when no path is given", async () => {
    const repoPath = declared("F-none");

    const run = await register(undefined, false, repoPath);

    expect(existsSync(path.join(repoPath, "package.json"))).toBe(false);
    expect(run.code).toBe(0);
    expect(existsSync(path.join(repoPath, CONTROL_REGISTER_PATH))).toBe(true);
  });

  it("writes an empty register for a repository that declares no gates", async () => {
    const { repoPath } = keep(buildFEmpty());

    const run = await register(repoPath);

    expect(run.stdout).toEqual([
      `register: PASS. 0 entries from 0 gates; wrote ${CONTROL_REGISTER_PATH}`,
    ]);
    expect(readRegister(repoPath)).toBe(
      '{\n  "entries": [],\n  "schema_version": 1\n}\n'
    );
  });
});

describe("refusing to generate", () => {
  it("passes on what the gate registry refuses, and writes nothing", async () => {
    const repoPath = declared("F-mixed", {
      "code-style": {
        commit: "required",
        parts: [{ scope: "api/", command: "ruff check ." }],
      },
    });

    const run = await register(repoPath);

    expect(run.code).toBe(1);
    expect(run.stdout).toEqual([]);
    expect(run.stderr).toEqual([
      expect.stringContaining('gates."code-style".parts[0].scope is "api/"'),
      expect.stringContaining(
        'gates."code-style".parts[0].command is the single string'
      ),
      "register: FAIL. 2 problems with the gates declaration in .lisa.config.json, so no register could be generated. Fix the declaration, then run this again",
    ]);
    expect(existsSync(path.join(repoPath, CONTROL_REGISTER_PATH))).toBe(false);
  });

  it("refuses a requirement id that is not in the catalogue, and writes nothing", async () => {
    const repoPath = declared("F-none", {
      "code-style": { commit: "required", criteria: ["AC99.9"] },
    });

    const run = await register(repoPath);

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toContain(
      'says it serves "AC99.9", but there is no requirement with that id'
    );
    expect(run.stderr[1]).toMatch(/^register: FAIL\. 1 problem with /u);
    expect(existsSync(path.join(repoPath, CONTROL_REGISTER_PATH))).toBe(false);
  });

  it("refuses a declaration file that is not JSON", async () => {
    const { repoPath } = keep(buildFEmpty());
    writeFileSync(path.join(repoPath, ".lisa.config.json"), "{ gates:");

    const run = await register(repoPath);

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toContain(".lisa.config.json is not readable");
  });

  it("refuses a path that is not a folder", async () => {
    const run = await register(path.join(tmpdir(), "lisa-no-such-repository"));

    expect(run.code).toBe(1);
    expect(run.stderr).toEqual([
      expect.stringMatching(/lisa-no-such-repository is not a folder\.$/u),
      "register: FAIL. Give the path of the repository whose register to generate",
    ]);
  });

  it("does not write through a link in place of the controls folder", async () => {
    const repoPath = declared("F-none");
    const { repoPath: elsewhere } = keep(buildFEmpty());
    mkdirSync(path.join(repoPath, ".lisa"));
    createSymlink(elsewhere, path.join(repoPath, ".lisa", "controls"));

    const run = await register(repoPath);

    expect(run.code).toBe(1);
    expect(run.stderr).toEqual([
      ".lisa/controls is not an ordinary folder (it may be a link), so nothing in it was read or written. Replace it with an ordinary folder.",
      `register: FAIL. ${CONTROL_REGISTER_PATH} was not written`,
    ]);
    expect(existsSync(path.join(elsewhere, "register.json"))).toBe(false);
  });

  it("does not write through a link in place of the register", async () => {
    const repoPath = declared("F-none");
    const { repoPath: elsewhere } = keep(buildFEmpty());
    mkdirSync(path.join(repoPath, ".lisa", "controls"), { recursive: true });
    createSymlink(
      path.join(elsewhere, "target.json"),
      path.join(repoPath, CONTROL_REGISTER_PATH)
    );

    const run = await register(repoPath);

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toContain("is not an ordinary file");
    expect(existsSync(path.join(elsewhere, "target.json"))).toBe(false);
  });
});

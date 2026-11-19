/**
 * `lisa controls seed` and a `package.json` it cannot read.
 *
 * The command reads the repository's tasks from `package.json`, and declares
 * a shipped check only where its task exists. A manifest that was there and
 * could not be read used to be taken as "this repository has no tasks": the
 * command declared nothing and reported success. It now refuses, with a
 * sentence that names the file, and decides nothing (CodySwannGT/lisa#4978).
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runControlAuditGit } from "../../helpers/control-audit-fixtures.js";
import { removeFixtures } from "./support/report-check-run.js";
import { CONFIG, repository, seed, seeded } from "./support/seed-run.js";

afterEach(removeFixtures);

const MANIFEST = "package.json";
const PAVED = "F-paved";
const REFUSED =
  "seed: FAIL. package.json cannot be relied on, so nothing was decided or declared. Correct it, then run this again";

describe("lisa controls seed refuses a package.json that", () => {
  it.each([
    [
      "is not valid JSON",
      '{ "scripts": { "lint": "eslint ." ',
      "package.json cannot be read as JSON (",
    ],
    [
      "does not hold a JSON object",
      '["lint", "typecheck"]',
      "package.json does not hold a JSON object, so the tasks this repository has cannot be read from it.",
    ],
    [
      "has scripts that are not an object",
      '{ "name": "fixture-paved", "scripts": ["lint"] }',
      'package.json has a "scripts" entry that is not an object, so the tasks this repository has cannot be read from it.',
    ],
  ])(
    "%s, instead of reading it as a repository with no tasks",
    async (_what, text, said) => {
      const repoPath = repository(PAVED, { [MANIFEST]: text });

      const run = await seed(repoPath);

      expect(run.code).toBe(1);
      expect(run.stdout).toEqual([]);
      expect(run.stderr[0]).toContain(said);
      expect(run.stderr.at(-1)).toBe(REFUSED);
      expect(existsSync(path.join(repoPath, CONFIG))).toBe(false);
      expect(runControlAuditGit(repoPath, ["status", "--porcelain"])).toBe("");
    }
  );

  it("is broken, without repeating what the file holds", async () => {
    const repoPath = repository(PAVED, {
      [MANIFEST]: '{ "scripts": { "deploy": "curl -H secret-value-here ',
    });

    const run = await seed(repoPath);

    expect(run.code).toBe(1);
    expect(run.stderr.join("\n")).not.toContain("secret-value-here");
  });

  it("is broken, on the discovery road as well, where nothing would be declared from it", async () => {
    const repoPath = repository("F-none", { [MANIFEST]: "{ not json" });

    const run = await seed(repoPath);

    expect(run.code).toBe(1);
    expect(run.stderr.at(-1)).toBe(REFUSED);
  });
});

describe("lisa controls seed accepts", () => {
  it("a package.json with no scripts, and declares nothing", async () => {
    const repoPath = repository(PAVED, {
      [MANIFEST]:
        '{ "name": "fixture-paved", "devDependencies": { "typescript": "^5.9.3" } }\n',
    });

    const output = await seeded(repoPath);

    expect(output.road).toBe("paved");
    expect(output.seeded).toEqual([]);
  });

  it("a repository with no package.json at all", async () => {
    const output = await seeded(repository("F-none"));

    expect(output.road).toBe("discovery");
    expect(output.seeded).toEqual([]);
  });
});

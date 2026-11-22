/**
 * `lisa controls seed`: which road the configure step takes, and the
 * declaration on the paved one.
 *
 * Where the whole repository is one piece of software on a supported project
 * type, its checks are declared by code from the ones Lisa ships, so two runs
 * give the same declaration. Anywhere else the command writes nothing and the
 * checks are declared from what the audit found (CodySwannGT/lisa#4984).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SEED_SCHEMA_VERSION } from "../../../src/controls/commands/seed.js";
import {
  CONFIGURE_ROADS,
  decideConfigureRoad,
} from "../../../src/controls/configure-road.js";
import { runControlAuditGit } from "../../helpers/control-audit-fixtures.js";
import {
  completeAuditReport,
  writeAuditReport,
} from "../../helpers/control-audit-report.js";
import { removeFixtures } from "./support/report-check-run.js";
import { CONFIG, repository, seed, seeded } from "./support/seed-run.js";

const TYPES = "type-correctness";
const MERGE = "pull-request";
const STATUS = ["status", "--porcelain", "--untracked-files=all"];

/** A TypeScript package that has the tasks some of Lisa's checks run. */
const PACKAGE_WITH_TASKS = `${JSON.stringify(
  {
    name: "fixture-paved",
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: { lint: "eslint .", typecheck: "tsc --noEmit", build: "tsc" },
    devDependencies: { typescript: "^5.9.3" },
  },
  null,
  2
)}\n`;

/**
 * Read the declaration a repository holds.
 * @param repoPath - The repository root
 * @returns The file content
 */
function config(repoPath: string): string {
  return readFileSync(path.join(repoPath, CONFIG), "utf8");
}

afterEach(removeFixtures);

describe("the road", () => {
  it("is one of two", () => {
    expect(CONFIGURE_ROADS).toEqual(["paved", "discovery"]);
  });

  it.each([
    ["a supported type and no audit report", ["typescript"], null, "paved"],
    [
      "a supported type the audit found in one piece",
      ["typescript"],
      ["."],
      "paved",
    ],
    ["no supported type", [], ["."], "discovery"],
    ["no supported type and no audit report", [], null, "discovery"],
    [
      "a supported type at the root with a separate part",
      ["typescript"],
      [".", "api"],
      "discovery",
    ],
    ["two parts and nothing at the root", [], [".", "api", "web"], "discovery"],
  ] as const)("for %s is %s", (_what, projectTypes, parts, road) => {
    expect(decideConfigureRoad({ projectTypes, parts }).road).toBe(road);
  });

  it("is explained in words an operator can be told", () => {
    expect(
      decideConfigureRoad({ projectTypes: [], parts: [".", "api", "web"] })
        .reason
    ).toBe(
      "The audit found separate parts in this repository (folder api, folder web). The checks Lisa ships cover a repository that is one piece of software, so here each part's checks are declared from what the audit found."
    );
    expect(
      decideConfigureRoad({ projectTypes: ["typescript"], parts: null }).reason
    ).toBe(
      "This repository is one piece of software on a project type Lisa ships checks for (typescript), so its checks are declared from the ones Lisa ships. No audit report was found, so the repository was taken to be one piece of software."
    );
  });
});

describe("lisa controls seed on F-paved", () => {
  it("takes the paved road with no audit report, and declares nothing a bare repository has no task for", async () => {
    const repoPath = repository("F-paved");

    const output = await seeded(repoPath);

    expect(output).toEqual({
      schema_version: SEED_SCHEMA_VERSION,
      road: "paved",
      reason: expect.stringContaining("(typescript)") as unknown,
      project_types: ["typescript"],
      audit_report: "missing",
      parts: null,
      declaration: CONFIG,
      wrote: false,
      seeded: [],
      declared_gates: 0,
    });
    expect(runControlAuditGit(repoPath, STATUS)).toBe("");
  });

  it("declares the shipped checks the repository has a task for, and only those", async () => {
    const repoPath = repository("F-paved", {
      "package.json": PACKAGE_WITH_TASKS,
    });

    const output = await seeded(repoPath);

    expect(output.wrote).toBe(true);
    expect(output.seeded).toEqual([
      { gate: TYPES, moment: "push", run: null },
      { gate: "code-style", moment: MERGE, run: null },
      { gate: TYPES, moment: MERGE, run: null },
      { gate: "build-integrity", moment: MERGE, run: null },
    ]);
    expect(output.declared_gates).toBe(3);
    expect(JSON.parse(config(repoPath))).toEqual({
      gates: {
        runner: "npm run",
        [TYPES]: { push: "required", [MERGE]: "required" },
        "code-style": { [MERGE]: "required" },
        "build-integrity": { [MERGE]: "required" },
      },
    });
    expect(runControlAuditGit(repoPath, STATUS)).toBe(`?? ${CONFIG}`);
  });

  it("changes nothing on a second run", async () => {
    const repoPath = repository("F-paved", {
      "package.json": PACKAGE_WITH_TASKS,
    });
    await seeded(repoPath);
    const first = config(repoPath);

    const second = await seeded(repoPath);

    expect(second).toMatchObject({
      wrote: false,
      seeded: [],
      declared_gates: 3,
    });
    expect(config(repoPath)).toBe(first);
  });

  it("keeps every key and every check that was already declared", async () => {
    const before = {
      tracker: "github",
      gates: {
        runner: "bun run",
        "code-style": { [MERGE]: "optional" },
        "x-docs": { push: { level: "optional", run: "docs:lint" } },
      },
    };
    const repoPath = repository("F-paved", {
      "package.json": PACKAGE_WITH_TASKS,
      [CONFIG]: `${JSON.stringify(before, null, 2)}\n`,
    });

    await seeded(repoPath);
    const after = JSON.parse(config(repoPath)) as typeof before;

    expect(after.tracker).toBe("github");
    expect(after.gates).toMatchObject(before.gates);
    expect(Object.keys(after.gates)).toEqual([
      "runner",
      "code-style",
      "x-docs",
      TYPES,
      "build-integrity",
    ]);
  });

  it("stays on the paved road when the audit found one piece of software", async () => {
    const repoPath = repository("F-paved");
    writeAuditReport(repoPath, completeAuditReport(["."]));

    expect(await seeded(repoPath)).toMatchObject({
      road: "paved",
      audit_report: "found",
      parts: ["."],
    });
  });
});

describe("lisa controls seed off the paved road", () => {
  it.each([
    ["F-none", ["."]],
    ["F-mixed", [".", "api", "web"]],
    ["F-empty", ["."]],
  ] as const)(
    "writes nothing on %s, with or without an audit report",
    async (name, parts) => {
      const repoPath = repository(name);

      const without = await seeded(repoPath);
      writeAuditReport(repoPath, completeAuditReport(parts));
      const withReport = await seeded(repoPath);

      expect(without).toMatchObject({
        road: "discovery",
        audit_report: "missing",
        parts: null,
        wrote: false,
        seeded: [],
        declared_gates: 0,
      });
      expect(withReport).toMatchObject({
        road: "discovery",
        audit_report: "found",
        parts,
        wrote: false,
      });
      expect(existsSync(path.join(repoPath, CONFIG))).toBe(false);
    }
  );

  it("takes discovery for a supported type whose audit found a separate part", async () => {
    const repoPath = repository("F-paved", {
      "package.json": PACKAGE_WITH_TASKS,
      "api/pyproject.toml": '[project]\nname = "api"\n',
    });
    writeAuditReport(repoPath, completeAuditReport([".", "api"]));

    const output = await seeded(repoPath);

    expect(output.road).toBe("discovery");
    expect(output.project_types).toEqual(["typescript"]);
    expect(existsSync(path.join(repoPath, CONFIG))).toBe(false);
  });
});

describe("lisa controls seed refuses", () => {
  it("an audit report that cannot be relied on, deciding nothing", async () => {
    const repoPath = repository("F-paved", {
      "package.json": PACKAGE_WITH_TASKS,
    });
    writeAuditReport(repoPath, { schema_version: 1, scopes: ["."] });

    const run = await seed(repoPath);

    expect(run.code).toBe(1);
    expect(run.stdout).toEqual([]);
    expect(run.stderr.at(-1)).toBe(
      "seed: FAIL. .lisa/audit/report.json cannot be relied on, so nothing was decided or declared. Run the audit again, then run this again"
    );
    expect(existsSync(path.join(repoPath, CONFIG))).toBe(false);
  });

  it.each([
    ["is not valid JSON", "{ gates: ", ".lisa.config.json is not readable"],
    [
      "declares a gate that is not valid",
      '{ "gates": { "code-style": { "commit": "sometimes" } } }',
      'gates."code-style"',
    ],
  ])(
    "a declaration that %s, leaving it as it was",
    async (_what, text, said) => {
      const repoPath = repository("F-paved", {
        "package.json": PACKAGE_WITH_TASKS,
        [CONFIG]: text,
      });

      const run = await seed(repoPath);

      expect(run.code).toBe(1);
      expect(run.stdout).toEqual([]);
      expect(run.stderr[0]).toContain(said);
      expect(run.stderr.at(-1)).toMatch(
        /^seed: FAIL\. The gates declaration in /u
      );
      expect(config(repoPath)).toBe(text);
    }
  );

  it("a path that is not a folder", async () => {
    const run = await seed("/nonexistent/seed");

    expect(run.code).toBe(1);
    expect(run.stderr).toEqual([
      "/nonexistent/seed is not a folder.",
      "seed: FAIL. Give the path of the repository to configure",
    ]);
  });
});

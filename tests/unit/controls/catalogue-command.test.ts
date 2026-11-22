/**
 * `lisa controls catalogue`: the requirements an audit must answer, printed as
 * one JSON document.
 *
 * The audit runs in repositories Lisa was never applied to, so there is no
 * `spec/` folder for the agent to read the requirements from. This command is
 * how they reach it: the catalogue comes from the package the command runs
 * from, and what is printed is exactly the set `report-check` will hold the
 * report to (CodySwannGT/lisa#4979).
 */
import { describe, expect, it } from "vitest";

import {
  inScopeCriteria,
  loadCriterionCatalogue,
} from "../../../src/controls/catalogue.js";
import { runCatalogue } from "../../../src/controls/commands/catalogue.js";

/** What one run of the command printed and returned. */
interface Run {
  readonly code: number;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
}

/**
 * Run the command in-process and capture what it prints.
 * @param load - Stand-in for reading the catalogue; the shipped one when left out
 * @returns Exit code and printed lines
 */
function run(load?: () => ReturnType<typeof loadCriterionCatalogue>): Run {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = runCatalogue({
    ...(load === undefined ? {} : { loadCatalogue: load }),
    stdout: line => {
      stdout.push(line);
    },
    stderr: line => {
      stderr.push(line);
    },
  });
  return { code, stdout, stderr };
}

/**
 * Parse what a passing run printed.
 * @param printed - The run
 * @returns The one JSON document on stdout
 */
function documentOf(printed: Run): Record<string, unknown> {
  expect(printed.stdout).toHaveLength(1);
  return JSON.parse(String(printed.stdout[0])) as Record<string, unknown>;
}

describe("lisa controls catalogue", () => {
  const shipped = loadCriterionCatalogue();

  it("prints one JSON document and exits 0", () => {
    const printed = run();

    expect(printed.code).toBe(0);
    expect(printed.stderr).toEqual([]);
    expect(Object.keys(documentOf(printed))).toEqual([
      "specification",
      "specification_version",
      "level",
      "criteria",
    ]);
  });

  it("names the specification and level the requirements come from", () => {
    const document = documentOf(run());

    expect(document.specification).toBe(shipped.specification);
    expect(document.specification_version).toBe(shipped.specification_version);
    expect(document.level).toBe(1);
  });

  it("lists every in-scope requirement as shipped, in catalogue order", () => {
    const document = documentOf(run());

    expect(document.criteria).toEqual(inScopeCriteria(shipped));
    expect(document.criteria).toHaveLength(77);
  });

  it("gives every requirement the plain question an operator is asked", () => {
    const criteria = documentOf(run()).criteria as readonly Record<
      string,
      unknown
    >[];

    expect(
      criteria.filter(
        criterion =>
          typeof criterion.question !== "string" ||
          criterion.question.trim() === ""
      )
    ).toEqual([]);
  });

  it("leaves out the requirements the Level 1 verdict does not cover", () => {
    const listed = (
      documentOf(run()).criteria as readonly Record<string, unknown>[]
    ).map(criterion => criterion.id);
    const excluded = shipped.criteria
      .filter(criterion => !criterion.in_scope)
      .map(criterion => criterion.id);

    expect(excluded).not.toEqual([]);
    expect(listed.filter(id => excluded.includes(String(id)))).toEqual([]);
  });

  it("prints a document that reads the same after a round trip", () => {
    const printed = String(run().stdout[0]);

    expect(JSON.stringify(JSON.parse(printed), null, 2)).toBe(printed);
  });

  it("exits 1 with one plain line when the catalogue cannot be read", () => {
    const printed = run(() => {
      throw new Error("The criterion catalogue is missing from this copy.");
    });

    expect(printed.code).toBe(1);
    expect(printed.stdout).toEqual([]);
    expect(printed.stderr).toEqual([
      "catalogue: FAIL. The criterion catalogue is missing from this copy.",
    ]);
  });
});

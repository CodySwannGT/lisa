/**
 * The gate runner leaves out a part the change does not touch
 * (CodySwannGT/lisa#4988).
 *
 * In a repository with two parts, a change to one should not run the other's
 * check — and must not be reported as having passed it. So the part is left
 * out, printed as NOT APPLICABLE with its folder, and kept out of the count
 * of what was proved. The opposite mistake is the dangerous one: a part left
 * out that the change did touch is a folder nothing checked. Every case where
 * the runner cannot be sure therefore runs the part.
 * @module tests/unit/scripts/lisa-run-gates-parts-untouched
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { STATE } from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import {
  API,
  API_ARGV,
  LINT,
  partGates,
  type PartsRepository,
  partsRepository,
  WEB,
  WEB_ARGV,
} from "./lisa-run-gates-parts-fixtures.js";
import {
  lineFor,
  NOT_KNOWN,
  rowFor,
  runWithChange,
  touching,
} from "./lisa-run-gates-untouched-fixtures.js";
import { createSymlink } from "../../support/borrowed-node-modules.mjs";

const WHOLE = ".";
const API_MAIN = "api/main.py";
const UNUSUAL = "café menu";
const TWO_PARTS = partGates([
  { scope: API, command: API_ARGV },
  { scope: WEB, command: WEB_ARGV },
]);
const NOT_APPLICABLE = "NOT APPLICABLE";

let repository: PartsRepository;
beforeEach(() => {
  repository = partsRepository([API, WEB, UNUSUAL]);
});
afterEach(() => repository.cleanup());

describe("a change confined to one part", () => {
  it("starts no command of the part it does not touch", () => {
    const run = runWithChange({
      change: touching([API_MAIN]),
      gates: TWO_PARTS,
      root: repository.root,
    });

    expect(run.started).toEqual([API]);
    expect(rowFor(run, API).state).toBe(STATE.PASSED);
  });

  it("prints the other part as NOT APPLICABLE, with its folder", () => {
    const run = runWithChange({
      change: touching([API_MAIN]),
      gates: TWO_PARTS,
      root: repository.root,
    });

    const line = lineFor(run, `${LINT} in ${WEB}`);
    expect(line).toContain(`${NOT_APPLICABLE} required`);
    expect(line).toContain(`inside "${WEB}"`);
    expect(line).toContain(JSON.stringify(WEB_ARGV));
    expect(line).not.toContain("PASSED");
  });

  it("never counts the part it left out as proved", () => {
    const run = runWithChange({
      change: touching([API_MAIN]),
      gates: TWO_PARTS,
      root: repository.root,
    });

    const web = rowFor(run, WEB);
    expect(web.state).toBe(STATE.SKIPPED);
    expect(web.untouched).toBe(true);
    expect(web.code).toBeNull();
    expect(run.result.passed.map(entry => entry.scope)).toEqual([API]);
    expect(run.result.skipped.map(entry => entry.scope)).toEqual([WEB]);
    expect(run.result.blocked).toBe(false);
    expect(run.transcript).toContain(
      "1 proved, 0 failed (optional), 0 not proved, 0 killed, " +
        "1 not applicable here, of 2 gate(s) declared."
    );
    expect(run.transcript).toContain(
      "1 part(s) this change does not touch were not run"
    );
  });

  it("lets a required gate through when the change touches none of its parts", () => {
    const run = runWithChange({
      change: touching(["README.md"]),
      gates: TWO_PARTS,
      root: repository.root,
    });

    expect(run.started).toEqual([]);
    expect(run.result.blocked).toBe(false);
    expect(run.result.passed).toEqual([]);
    expect(run.transcript).toContain("0 proved");
    expect(run.transcript).toContain("2 not applicable here");
  });

  it("runs a part whose folder name holds a space and a non-ASCII letter", () => {
    const run = runWithChange({
      change: touching([`${UNUSUAL}/today's specials.md`]),
      gates: partGates([
        { scope: UNUSUAL, command: API_ARGV },
        { scope: WEB, command: WEB_ARGV },
      ]),
      root: repository.root,
    });

    expect(run.started).toEqual([UNUSUAL]);
    expect(lineFor(run, `${LINT} in ${WEB}`)).toContain(NOT_APPLICABLE);
  });

  it("does not run `api` for a change inside `api-v2`", () => {
    const run = runWithChange({
      change: touching(["api-v2/main.py"]),
      gates: TWO_PARTS,
      root: repository.root,
    });

    expect(run.started).toEqual([]);
  });
});

describe("a part for the whole repository", () => {
  it("always runs, whatever the change touches", () => {
    const run = runWithChange({
      change: touching([API_MAIN]),
      gates: partGates([
        { scope: WHOLE, command: API_ARGV },
        { scope: WEB, command: WEB_ARGV },
      ]),
      root: repository.root,
    });

    expect(run.started).toEqual([WHOLE]);
  });

  it("is run without asking what the change touches", () => {
    const run = runWithChange({
      change: touching([]),
      gates: partGates([{ scope: WHOLE, command: API_ARGV }]),
      root: repository.root,
    });

    expect(run.started).toEqual([WHOLE]);
    expect(run.asked).toBe(0);
    expect(run.transcript).not.toContain("This commit changes");
  });
});

describe("a change the runner cannot be sure about", () => {
  it("runs every part when the change is not known", () => {
    const run = runWithChange({
      change: NOT_KNOWN,
      gates: TWO_PARTS,
      root: repository.root,
    });

    expect(run.started).toEqual([API, WEB]);
    expect(run.transcript).not.toContain(NOT_APPLICABLE);
    expect(run.transcript).toContain("Every part runs at commit");
  });

  it("runs every part when it is not told what the change is", () => {
    const run = runWithChange({ gates: TWO_PARTS, root: repository.root });

    expect(run.started).toEqual([API, WEB]);
    expect(run.transcript).not.toContain(NOT_APPLICABLE);
  });

  it.each([
    ["a list holding something that is not a path", [API_MAIN, 7]],
    ["text in place of a list", API_MAIN],
    ["nothing", undefined],
  ])("runs every part when it is handed %s", (_name, paths) => {
    const run = runWithChange({
      change: { note: null, paths },
      gates: TWO_PARTS,
      root: repository.root,
    });

    expect(run.started).toEqual([API, WEB]);
  });

  it("runs every part, and says why, when working out the change fails", () => {
    const run = runWithChange({
      change: () => {
        throw new Error("the index could not be opened");
      },
      gates: TWO_PARTS,
      root: repository.root,
    });

    expect(run.started).toEqual([API, WEB]);
    expect(run.asked).toBe(1);
    expect(run.transcript).toContain(
      "Every part runs at commit: what the change touches could not be " +
        "worked out (the index could not be opened)."
    );
  });

  it("runs a part whose folder is a link when the change is where it leads", () => {
    mkdirSync(path.join(repository.root, "services", "billing"), {
      recursive: true,
    });
    createSymlink(
      path.join("services", "billing"),
      path.join(repository.root, "billing")
    );

    const run = runWithChange({
      change: touching(["services/billing/invoice.py"]),
      gates: partGates([{ scope: "billing", command: API_ARGV }]),
      root: repository.root,
    });

    expect(run.started).toEqual(["billing"]);
  });

  it("still says so when an untouched part could not have started", () => {
    const run = runWithChange({
      change: touching([API_MAIN]),
      gates: partGates([
        { scope: API, command: API_ARGV },
        { scope: "gone", command: WEB_ARGV },
      ]),
      root: repository.root,
    });

    expect(rowFor(run, "gone").state).toBe(STATE.UNPROVABLE);
    expect(run.result.blocked).toBe(true);
  });
});

describe("what the runner says about the change", () => {
  it("asks once, and says what it learned before the first part", () => {
    const run = runWithChange({
      change: touching([API_MAIN]),
      gates: TWO_PARTS,
      root: repository.root,
    });

    expect(run.asked).toBe(1);
    const said = run.lines.findIndex(line =>
      line.includes("This commit changes 1 path(s).")
    );
    const first = run.lines.findIndex(line => line.includes(`${LINT} in `));
    expect(said).toBeGreaterThanOrEqual(0);
    expect(said).toBeLessThan(first);
  });
});

/**
 * Validation of the gate-level control keys `criteria`, `owner` and `tier`.
 *
 * Split from `lisa-gates-parts.test.ts`, which says what each key is for. Every
 * refusal here is read by an operator, so each assertion checks that the
 * message names the gate and the key at fault.
 * @module tests/unit/controls/lisa-gates-parts-criteria
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CRITERION_ID_PATTERN,
  TIERS,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import {
  GATE,
  OWNER,
  problemsForGateKey,
  REPO_ROOT,
} from "./support/lisa-gates-parts-helpers.js";

describe("a gate's criteria", () => {
  const CRITERIA = `gates."${GATE}".criteria`;

  it.each([
    ["a string", "AC5.4", /expected a list/u],
    ["an object", { AC5: 4 }, /expected a list/u],
    ["empty", [], /is empty/u],
  ])("are refused when they are %s", (_name, criteria, expected) => {
    const problems = problemsForGateKey("criteria", criteria);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(CRITERIA);
    expect(problems[0]).toMatch(expected);
  });

  it.each(["ac5.4", "AC5", "AC0.1", "SI02", "SI2 ", "R15", 5.4, null])(
    "refuse %j, which is not a requirement id",
    id => {
      const problems = problemsForGateKey("criteria", ["AC5.4", id]);

      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(`${CRITERIA}[1] is ${JSON.stringify(id)}`);
      expect(problems[0]).toMatch(/not a requirement id/u);
    }
  );

  it("refuse an id listed twice", () => {
    const problems = problemsForGateKey("criteria", ["SI2", "AC5.4", "SI2"]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${CRITERIA}[2] repeats "SI2"`);
    expect(problems[0]).toContain(`${CRITERIA}[0]`);
  });

  it("accept every id in the criterion catalogue", () => {
    // The registry ships to repositories that do not carry the catalogue, so
    // it checks how an id is written and nothing else. This is what keeps that
    // check from drifting away from the ids the catalogue actually holds.
    const catalogue = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, "spec", "tasc-criteria.json"),
        "utf8"
      )
    ) as { criteria: { id: string }[] };
    const ids = catalogue.criteria.map(criterion => criterion.id);

    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter(id => !CRITERION_ID_PATTERN.test(id))).toEqual([]);
    expect(problemsForGateKey("criteria", ids)).toEqual([]);
  });
});

describe("a gate's owner", () => {
  it.each(["", "   ", 7, [OWNER], null])("is refused as %j", owner => {
    const problems = problemsForGateKey("owner", owner);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(
      `gates."${GATE}".owner is ${JSON.stringify(owner)}`
    );
    expect(problems[0]).toMatch(/person or team that answers for this gate/u);
  });

  it("is accepted as a name", () => {
    expect(problemsForGateKey("owner", OWNER)).toEqual([]);
  });
});

describe("a gate's tier", () => {
  it.each(["mandatory", "Authoritative", "", true, null])(
    "is refused as %j",
    tier => {
      const problems = problemsForGateKey("tier", tier);

      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(
        `gates."${GATE}".tier is ${JSON.stringify(tier)}`
      );
      expect(problems[0]).toContain("authoritative");
      expect(problems[0]).toContain("advisory");
    }
  );

  it.each(TIERS)("is accepted as %j", tier => {
    expect(problemsForGateKey("tier", tier)).toEqual([]);
  });
});

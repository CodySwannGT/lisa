/**
 * The scoping audit's closed vocabularies are quoted, not re-decided (#3420).
 *
 * `scoping-label-audit.mjs` hardcodes the `type:` and `priority:` member lists
 * because it ships standalone into host projects and cannot import a shared
 * constant. That literal is only trustworthy while it equals what
 * `lisa-github-write-issue` declares, so this file pins the two together.
 *
 * The `type:` list is a measured correction: issue #3420's summary table listed
 * six members and omitted `Task`, while the skill's CREATE row lists seven
 * including it — and this repository carries 91 issues labelled `type:Task`.
 * Encoding the shorter list would have opened the audit by reporting 91
 * correctly-labelled issues as vocabulary violations.
 *
 * @module tests/unit/strategies/scoping-label-vocabulary-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CLOSED_PRIORITY_VOCABULARY,
  CLOSED_TYPE_VOCABULARY,
} from "../../../plugins/src/base/scripts/scoping-label-audit.mjs";

const SKILL_ROOT = "plugins/src/base/skills";
const VALIDATE_MAPPING_SKILL = "lisa-validate-tracker-mapping";
const WRITE_ISSUE_SKILL = "lisa-github-write-issue";

const readSkill = (name: string): string =>
  readFileSync(path.resolve(SKILL_ROOT, name, "SKILL.md"), "utf8");

const typesFromRow = (row: string): readonly string[] =>
  [...row.matchAll(/`(?:type:)?([A-Z][A-Za-z-]*)`/g)].map(match => match[1]);

const rowStartingWith = (skill: string, prefix: string): string => {
  const row = skill.split("\n").find(line => line.startsWith(prefix));

  expect(row).toBeDefined();
  return row as string;
};

describe("closed vocabularies match what lisa-github-write-issue declares", () => {
  const skill = readSkill(WRITE_ISSUE_SKILL);

  it("encodes the CREATE-time issue-type list verbatim, in order", () => {
    expect(
      typesFromRow(rowStartingWith(skill, "| Issue type | CREATE |"))
    ).toEqual([...CLOSED_TYPE_VOCABULARY]);
  });

  it("keeps the Phase 5 label table naming the same types as the CREATE row", () => {
    expect(
      new Set(
        typesFromRow(rowStartingWith(skill, "| Issue type | `type:<value>` |"))
      )
    ).toEqual(new Set(CLOSED_TYPE_VOCABULARY));
  });

  it("encodes the declared priority vocabulary, critical included", () => {
    expect(skill).toContain("priority:<low|medium|high|critical>");
    expect(CLOSED_PRIORITY_VOCABULARY).toEqual([
      "low",
      "medium",
      "high",
      "critical",
    ]);
  });

  it("still documents the create-on-demand behaviour this audit observes", () => {
    expect(skill).toContain("gh label create");
  });
});

describe("`lisa-validate-tracker-mapping` wires the scoping audit in", () => {
  const skill = readSkill(VALIDATE_MAPPING_SKILL);

  it("names the four scoping families the lifecycle audit cannot see", () => {
    for (const family of ["type:", "priority:", "points:", "component:"]) {
      expect(skill).toContain(family);
    }
  });

  it("runs the audit through the shared script rather than re-deriving it", () => {
    expect(skill).toContain("scoping-label-audit.mjs");
  });

  it("states that scoping findings never change the verdict or exit status", () => {
    const scopingSection = skill.slice(skill.indexOf("## Step 4b"));

    expect(scopingSection).toContain("advisory");
    expect(scopingSection).toMatch(/exit status/i);
  });

  it("keeps scoping findings out of the repair path", () => {
    const repairSection = skill.slice(skill.indexOf("## Step 6"));

    expect(repairSection).toMatch(/never (auto-)?repair/i);
    expect(repairSection).toContain("scoping");
  });

  it("records that Lisa asserts no authority over an open vocabulary", () => {
    expect(skill).toMatch(/open (vocabular|by design)/i);
  });
});

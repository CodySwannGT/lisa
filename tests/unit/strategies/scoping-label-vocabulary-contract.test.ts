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
 * Only the vocabulary parity is pinned here. The prose that wires the audit
 * into `lisa-validate-tracker-mapping` is guidance and is reviewed, not pinned
 * (#4867).
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
});

/**
 * Re-requesting a review is not the automatic fallback when dismissal is
 * unavailable (CodySwannGT/lisa#3587).
 *
 * ## The defect
 *
 * The same file both FORBADE and PRESCRIBED the same act. Its review-evidence
 * section says "Never re-request a review to 'refresh' it. Re-requesting
 * overwrites the existing status rather than adding to it, so under a throttle
 * it destroys a real review, one-way." A hundred-odd lines later the
 * CHANGES_REQUESTED handling said to dismiss "where repo policy permits, else
 * re-request review" — so an agent that could not dismiss was sent to do the
 * thing the same file calls one-way destruction.
 *
 * The fallback was also unimplemented: the only command in that block is the
 * dismissal, so the re-request branch was prose with nothing to run.
 *
 * ## Why the fallback is narrowed rather than deleted
 *
 * Deleting it would over-correct. It is the only remedy a lane without
 * dismissal permission has, and that permission is not universal — removing it
 * leaves those lanes with no path at all. So the human case and the
 * not-the-only-review case stay, and only the costly case escalates.
 *
 * ## What is asserted, and what is not
 *
 * That a bot's re-review REPLACES its predecessor in the effective set is
 * inferred from the observed consequence, not measured — testing it means
 * re-requesting on a live pull request. These cases therefore pin the
 * GUIDANCE, including its own statement that the mechanism is unverified. A
 * suite that claimed to have proven the vendor behaviour would be asserting
 * something nobody here has observed.
 * @module tests/unit/strategies/drive-pr-review-re-request-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

describe.each(ROOTS)("%s drive-pr review re-request", root => {
  const skill = readFileSync(
    path.resolve(root, "skills/lisa-drive-pr-to-merge/SKILL.md"),
    "utf8"
  );

  it("no longer sends an agent straight from failed dismissal to re-request", () => {
    // The contradiction itself. This exact phrase was the fallback.
    expect(skill).not.toContain("where repo policy permits, else re-request");
  });

  it("keeps the prohibition it used to contradict", () => {
    // The narrowing must not be achieved by deleting the rule that made the
    // fallback wrong in the first place.
    expect(skill).toContain('Never re-request a review to "refresh" it');
    expect(skill).toMatch(/destroys a real\s+review, one-way/);
  });

  it("says re-requesting is not the automatic fallback", () => {
    expect(skill).toMatch(/re-requesting is NOT the automatic fallback/i);
  });

  it("supplies the read that decides it, rather than asking for a judgement", () => {
    // A rule that says "check whether it is the only substantive review" with
    // no way to check is the same shape as the unimplemented fallback it
    // replaces.
    expect(skill).toContain('pulls/<pr>/reviews"');
    expect(skill).toContain("hasBody");
  });

  it("keeps the fallback for the two cases that cost nothing", () => {
    expect(skill).toMatch(/A human reviewer.*re-request freely/is);
    expect(skill).toMatch(/NOT the only substantive one.*re-request/is);
  });

  it("escalates rather than re-requesting the only substantive review", () => {
    expect(skill).toMatch(/IS the only substantive one.*do\s+NOT re-request/is);
    expect(skill).toMatch(/[Ee]scalate for a dismissal decision/);
  });

  it("says why deleting the fallback would over-correct", () => {
    // The lane without dismissal permission is the reason the fallback exists,
    // and a later editor who does not know that will delete it.
    expect(skill).toMatch(/only remedy a lane\s+without dismissal permission/);
  });

  it("names the mechanism as unverified rather than asserting it", () => {
    expect(skill).toMatch(/[Uu]nverified, and stated as such/);
    expect(skill).toMatch(/inferred from the observed\s+consequence/);
  });

  it("says what is lost and what is not", () => {
    // Gone versus not-counted decides how alarming this is, and conflating
    // them is what made the report read as data loss.
    expect(skill).toMatch(/still retrievable from the reviews API/);
    expect(skill).toMatch(/what is lost is\s+its standing/);
  });
});

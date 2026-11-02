/**
 * Regression for CodySwannGT/lisa#4564 finding 4.
 *
 * `validateVerifyUsage` reads every comment on the work item, from any author.
 * A single malformed or integrity-failing `## Lisa Usage` section used to fail
 * the whole completion authorization as `invalid-proof`, even when the genuine
 * Verify entry was present and intact elsewhere.
 * @module tests/unit/scripts/completion-proof-verify-usage
 */
import { describe, expect, it } from "vitest";

import { validateVerifyUsage } from "../../../all/copy-overwrite/scripts/lib/completion-proof-content.mjs";
import {
  proofUsage,
  PROOF_REF,
} from "../../support/work-item-proof-fixture.js";

const CONTEXT = { provider: "github", scope: "acme/code" };
const EXPECTED = ["verify-42"];

/**
 * Runs the validator and reports the refusal message, if any.
 * @param documents - Work-item body and comment bodies.
 * @returns The refusal message, or null when the usage is accepted.
 */
function refusal(documents: string[]): string | null {
  try {
    validateVerifyUsage(documents, PROOF_REF, EXPECTED, CONTEXT);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

describe("validateVerifyUsage tolerates stray usage sections (#4564)", () => {
  const genuine = proofUsage(PROOF_REF);

  it("accepts the genuine Verify usage section", () => {
    expect(refusal(["Spec body", genuine])).toBeNull();
  });

  it.each([
    ["a bad entry token", "## Lisa Usage\n\n- not-an-entry\n"],
    ["no rollup", genuine.replace(/rollup/gi, "r0llup")],
    [
      "a rollup that disagrees with its entries",
      genuine.replace(
        "direct_entry_ids=verify-42",
        "direct_entry_ids=verify-99"
      ),
    ],
  ])("ignores another comment's usage section with %s", (_label, stray) => {
    expect(refusal(["Spec body", genuine, stray])).toBeNull();
    expect(refusal(["Spec body", stray, genuine])).toBeNull();
  });

  it("ignores a comment that repeats the Lisa Usage heading", () => {
    const duplicated = `${genuine}\n${genuine}`;
    expect(refusal(["Spec body", duplicated, genuine])).toBeNull();
    expect(refusal(["Spec body", genuine, duplicated])).toBeNull();
  });

  it("keeps a duplicated Lisa Usage heading in the work-item body fatal", () => {
    expect(refusal([`${genuine}\n${genuine}`, genuine])).not.toBeNull();
  });

  it("does not let a later entry for another work item shadow the genuine one", () => {
    const other = proofUsage("acme/code#999");
    expect(refusal(["Spec body", genuine, other])).toBeNull();
  });

  it("still refuses when only malformed sections exist", () => {
    expect(refusal(["Spec body", "## Lisa Usage\n\n- not-an-entry\n"])).toMatch(
      /verify-42 is absent.*1 malformed or integrity-failing usage section/
    );
  });

  it("still refuses a Verify entry that belongs to another work item", () => {
    expect(refusal(["Spec body", proofUsage("acme/code#999")])).toMatch(
      /verify-42 is absent or belongs to another work item/
    );
  });
});

describe("validateVerifyUsage keeps the work-item body fail-closed (#4570)", () => {
  // documents[0] is the work-item body. #4564 made a malformed or tampered
  // usage section in a COMMENT skippable; the same skip on the body let an
  // intact comment authorize an item whose own proof was malformed or
  // tampered, which was refused before #4564.
  const genuine = proofUsage(PROOF_REF);

  it("refuses a body whose usage section does not parse, even with an intact comment", () => {
    // An entry token with a field missing matches neither entry grammar, so
    // the parser throws rather than returning a section that fails integrity.
    const unparseable = genuine.replace("flow=lisa-verify ", "");
    expect(unparseable).not.toBe(genuine);
    expect(refusal([unparseable, genuine])).toMatch(
      /work-item body's canonical Verify usage section is malformed/
    );
  });

  it("still skips the same unparseable section in a comment (#4564)", () => {
    const unparseable = genuine.replace("flow=lisa-verify ", "");
    expect(refusal(["Spec body", unparseable, genuine])).toBeNull();
  });

  it("refuses a body whose usage section fails its integrity check, even with an intact comment", () => {
    const tampered = genuine.replace(
      "direct_entry_ids=verify-42",
      "direct_entry_ids=verify-99"
    );
    expect(tampered).not.toBe(genuine);
    expect(refusal([tampered, genuine])).toMatch(
      /work-item body's canonical usage ledger failed its stored-surface integrity check/
    );
  });

  it("still accepts an intact usage section in the body", () => {
    expect(refusal([genuine])).toBeNull();
  });
});

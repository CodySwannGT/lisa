/**
 * The usage writer and the completion-proof reader must agree on one
 * `artifact_ref` grammar (CodySwannGT/lisa#4699).
 *
 * The reader (`isVerifyEntryFor`) recognises a Linear Verify entry only when
 * its `artifact_ref` is the workspace-qualified `linear:<workspace>/<KEY-N>`.
 * The writer used to encode any ref unchecked, so a short `linear:<KEY-N>` was
 * written successfully and later refused as "absent or belongs to another work
 * item". The writer now refuses the short form at write time; other providers'
 * refs are unaffected.
 */
import { describe, expect, it } from "vitest";

import { validateVerifyUsage } from "../../../all/copy-overwrite/scripts/lib/completion-proof-content.mjs";
import {
  assertCanonicalArtifactRef,
  createLisaUsageRollup,
  parseLisaUsageSection,
  renderLisaUsageEntryToken,
  renderLisaUsageSection,
  upsertLisaUsageSection,
  type LisaUsageEntry,
} from "../../../src/utils/usage-accounting.js";

const SHORT = "linear:ENG-11";
const QUALIFIED = "linear:acme/ENG-11";
const REQUIRED_FORM = "linear:<workspace>/<KEY-N>";
const VERIFY_ID = "verify-11";
const GITHUB_REF = "github:acme/code#42";
const LINEAR_CONTEXT = { provider: "linear", scope: "acme/ENG" };

/**
 * Create a deterministic Verify usage entry for one artifact ref.
 *
 * @param artifactRef Ref of the artifact carrying the entry.
 * @returns A complete usage entry payload.
 */
function makeEntry(artifactRef: string): LisaUsageEntry {
  return {
    artifactRef,
    cachedInputTokens: null,
    cost: null,
    currency: null,
    entryId: VERIFY_ID,
    flow: "lisa-verify",
    inputTokens: null,
    model: "synthetic-fixture",
    outputTokens: null,
    parentArtifactRef: null,
    pricingSource: null,
    pricingStatus: "unavailable",
    provider: "fixture",
    reasoningTokens: null,
    runId: "run-11",
    source: "unavailable",
    totalTokens: null,
  };
}

/**
 * Report the refusal message a call raises, if any.
 *
 * @param action Call under test.
 * @returns The thrown message, or null when the call succeeded.
 */
function refusalOf(action: () => unknown): string | null {
  try {
    action();
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

describe("assertCanonicalArtifactRef (#4699)", () => {
  it("refuses the short linear:<KEY-N> form with an operator-readable message", () => {
    const message = refusalOf(() => assertCanonicalArtifactRef(SHORT));
    expect(message).toContain(SHORT);
    expect(message).toContain(REQUIRED_FORM);
    expect(message).toContain("linear.workspace");
    expect(message).toContain(".lisa.config.json");
  });

  it.each([
    ["an empty workspace", "linear:/ENG-11"],
    ["no key", "linear:acme/"],
    ["a key without a number", "linear:acme/ENG"],
    ["a key that is not KEY-N", "linear:acme/ENG-11-x"],
    ["an extra path segment", "linear:acme/ENG-11/extra"],
    ["a key starting with a digit", "linear:acme/1ENG-11"],
    ["nothing after the prefix", "linear:"],
  ])("refuses a linear ref with %s", (_label, ref) => {
    expect(refusalOf(() => assertCanonicalArtifactRef(ref))).toContain(
      REQUIRED_FORM
    );
  });

  it.each([
    QUALIFIED,
    "linear:acme-labs/eng_core-7",
    GITHUB_REF,
    "github:issue:869",
    "https://github.com/acme/code/issues/42",
    "ENG-11",
    "notion:page-abc",
    "markdown:docs/plan.md",
  ])("accepts %s", ref => {
    expect(() => assertCanonicalArtifactRef(ref)).not.toThrow();
  });
});

describe("usage writer refuses a short Linear artifact_ref (#4699)", () => {
  it("renderLisaUsageEntryToken refuses the short form", () => {
    expect(
      refusalOf(() => renderLisaUsageEntryToken(makeEntry(SHORT)))
    ).toContain(REQUIRED_FORM);
  });

  it("renderLisaUsageEntryToken renders the qualified form unchanged", () => {
    expect(renderLisaUsageEntryToken(makeEntry(QUALIFIED))).toContain(
      `artifact_ref=${encodeURIComponent(QUALIFIED)} `
    );
  });

  it("renderLisaUsageSection refuses the short form", () => {
    const entry = makeEntry(SHORT);
    expect(
      refusalOf(() =>
        renderLisaUsageSection({
          entries: [entry],
          rollup: createLisaUsageRollup([entry]),
        })
      )
    ).toContain(REQUIRED_FORM);
  });

  it("upsertLisaUsageSection refuses a new short-form entry", () => {
    expect(
      refusalOf(() =>
        upsertLisaUsageSection("# Spec\n", { entries: [makeEntry(SHORT)] })
      )
    ).toContain(REQUIRED_FORM);
  });

  it("leaves github refs unaffected", () => {
    const document = upsertLisaUsageSection("# Spec\n", {
      entries: [makeEntry(GITHUB_REF)],
    });
    expect(parseLisaUsageSection(document).entries[0]?.artifactRef).toBe(
      GITHUB_REF
    );
  });

  it("still rewrites a document that already carries a legacy short-form entry", () => {
    const legacy = upsertLisaUsageSection("# Spec\n", {
      entries: [makeEntry(QUALIFIED)],
    }).replace(
      `artifact_ref=${encodeURIComponent(QUALIFIED)}`,
      `artifact_ref=${encodeURIComponent(SHORT)}`
    );
    expect(parseLisaUsageSection(legacy).entries[0]?.artifactRef).toBe(SHORT);

    const rewritten = upsertLisaUsageSection(legacy, {
      entries: [{ ...makeEntry(QUALIFIED), entryId: "implement-11" }],
    });
    expect(
      parseLisaUsageSection(rewritten).entries.map(entry => entry.artifactRef)
    ).toEqual([SHORT, QUALIFIED]);
  });
});

describe("writer and completion-proof reader agree on the Linear grammar (#4699)", () => {
  it("a Verify entry written with the qualified ref passes validateVerifyUsage", () => {
    const document = upsertLisaUsageSection("Spec body\n", {
      entries: [makeEntry(QUALIFIED)],
    });
    expect(() =>
      validateVerifyUsage([document], "ENG-11", [VERIFY_ID], LINEAR_CONTEXT)
    ).not.toThrow();
  });

  it("the reader refuses the short form the writer now refuses", () => {
    const shortDocument = upsertLisaUsageSection("Spec body\n", {
      entries: [makeEntry(QUALIFIED)],
    }).replace(
      `artifact_ref=${encodeURIComponent(QUALIFIED)}`,
      `artifact_ref=${encodeURIComponent(SHORT)}`
    );
    expect(() =>
      validateVerifyUsage(
        [shortDocument],
        "ENG-11",
        [VERIFY_ID],
        LINEAR_CONTEXT
      )
    ).toThrow(/absent or belongs to another work item/);
  });
});

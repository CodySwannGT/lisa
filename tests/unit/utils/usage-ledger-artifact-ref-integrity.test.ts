/**
 * The usage-ledger read-back integrity check must refuse an `artifact_ref` the
 * completion-proof reader would never recognise (CodySwannGT/lisa#4846).
 *
 * #4699 made the TypeScript writer refuse a short `linear:<KEY-N>` ref, but an
 * agent that writes the `lisa:usage-entry` token by hand never passes through
 * that writer. Read-back (`verifyLisaUsageSectionIntegrity`) is the one check
 * every managed write runs, so it reports the same grammar violation, from the
 * same shared implementation the writer uses.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { validateVerifyUsage } from "../../../all/copy-overwrite/scripts/lib/completion-proof-content.mjs";
import * as sharedGrammar from "../../../all/copy-overwrite/scripts/lib/usage-artifact-ref.mjs";
import {
  isLisaUsageLedgerIntact,
  verifyLisaUsageSectionIntegrity as verifyFromScripts,
} from "../../../all/copy-overwrite/scripts/lib/usage-ledger-integrity.mjs";
import {
  assertCanonicalArtifactRef,
  createLisaUsageRollup,
  upsertLisaUsageSection,
  verifyLisaUsageSectionIntegrity,
  type LisaUsageEntry,
} from "../../../src/utils/usage-accounting.js";

const QUALIFIED = "linear:acme/ENG-11";
const SHORT = "linear:ENG-11";
const VERIFY_ID = "verify-11";
const GITHUB_REF = "github:acme/code#42";
const LEGACY_ID = "legacy-5";
const LEGACY_SHORT = "linear:ENG-5";
const REQUIRED_FORM = "linear:<workspace>/<KEY-N>";
const ISSUE_CODE = "non-canonical-artifact-ref";
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/**
 * Create a deterministic usage entry carrying a qualified Linear ref.
 *
 * @param entryId Stable id of the entry.
 * @returns A complete usage entry payload.
 */
function makeEntry(entryId: string): LisaUsageEntry {
  return {
    artifactRef: QUALIFIED,
    cachedInputTokens: null,
    cost: null,
    currency: null,
    entryId,
    flow: "lisa-verify",
    inputTokens: null,
    model: "synthetic-fixture",
    outputTokens: null,
    parentArtifactRef: null,
    pricingSource: null,
    pricingStatus: "unavailable",
    provider: "fixture",
    reasoningTokens: null,
    runId: `run-${entryId}`,
    source: "unavailable",
    totalTokens: null,
  };
}

/**
 * Build a stored section whose entry tokens carry the given artifact refs, as
 * an agent writing the tokens by hand would. The writer refuses a short ref,
 * so each token is written with a qualified ref and its encoded `artifact_ref`
 * field is then rewritten in place.
 *
 * @param refsById Raw `artifact_ref` value to store, keyed by entry id.
 * @returns The stored artifact body.
 */
function handWrittenSection(refsById: Record<string, string>): string {
  const entryIds = Object.keys(refsById);
  const entries = entryIds.map(makeEntry);
  const written = upsertLisaUsageSection("# Spec\n", {
    entries,
    rollup: createLisaUsageRollup(entries),
  });
  return entryIds.reduce(
    (document, entryId) =>
      document.replace(
        new RegExp(
          `(entry_id=${entryId} [^>]*?artifact_ref=)${encodeURIComponent(QUALIFIED)}`
        ),
        `$1${encodeURIComponent(refsById[entryId] ?? QUALIFIED)}`
      ),
    written
  );
}

/**
 * The artifact_ref issues read-back reports for a stored section.
 *
 * @param document Stored artifact body.
 * @returns Issues carrying the artifact_ref grammar code.
 */
function artifactRefIssues(document: string) {
  return verifyLisaUsageSectionIntegrity(document).issues.filter(
    issue => issue.code === ISSUE_CODE
  );
}

describe("read-back refuses a non-canonical artifact_ref (#4846)", () => {
  it("reports a short linear:<KEY-N> ref, naming the required form and the entry", () => {
    const document = handWrittenSection({ [VERIFY_ID]: SHORT });
    expect(document).toContain("artifact_ref=linear%3AENG-11 ");

    const result = verifyLisaUsageSectionIntegrity(document, {
      entryIds: [VERIFY_ID],
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe(ISSUE_CODE);
    expect(result.issues[0]?.entryIds).toStrictEqual([VERIFY_ID]);
    expect(result.issues[0]?.message).toContain(REQUIRED_FORM);
    expect(result.issues[0]?.message).toContain(VERIFY_ID);
  });

  it("accepts a qualified linear:<workspace>/<KEY-N> ref", () => {
    const document = handWrittenSection({ [VERIFY_ID]: QUALIFIED });
    expect(document).toContain("artifact_ref=linear%3Aacme%2FENG-11 ");

    expect(artifactRefIssues(document)).toStrictEqual([]);
    expect(verifyLisaUsageSectionIntegrity(document).ok).toBe(true);
  });

  it("reports a lowercase Linear key the reader would not match", () => {
    const document = handWrittenSection({ [VERIFY_ID]: "linear:acme/eng-11" });

    expect(artifactRefIssues(document).map(issue => issue.entryIds)).toEqual([
      [VERIFY_ID],
    ]);
  });

  it("does not flag non-Linear refs", () => {
    const document = handWrittenSection({
      "github-1": GITHUB_REF,
      "jira-1": "ENG-11",
    });
    expect(document).toContain(
      `artifact_ref=${encodeURIComponent(GITHUB_REF)} `
    );
    expect(document).toContain("artifact_ref=ENG-11 ");

    expect(artifactRefIssues(document)).toStrictEqual([]);
    expect(verifyLisaUsageSectionIntegrity(document).ok).toBe(true);
  });

  it("reports every offending entry once, with sorted ids", () => {
    const document = handWrittenSection({
      "zeta-1": "linear:ENG-2",
      "good-1": QUALIFIED,
      "alpha-1": "linear:ENG-1",
    });

    const issues = artifactRefIssues(document);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.entryIds).toStrictEqual(["alpha-1", "zeta-1"]);
    expect(issues[0]?.message).toContain(
      "alpha-1 (linear:ENG-1), zeta-1 (linear:ENG-2)"
    );
  });

  it("checks only the entries the caller just wrote when ids are given", () => {
    const legacy = handWrittenSection({ [LEGACY_ID]: LEGACY_SHORT });
    const body = upsertLisaUsageSection(legacy, {
      entries: [makeEntry(VERIFY_ID)],
    });
    expect(body).toContain("artifact_ref=linear%3AENG-5 ");
    expect(body).toContain(`entry_id=${VERIFY_ID} `);

    expect(
      verifyLisaUsageSectionIntegrity(body, { entryIds: [VERIFY_ID] })
    ).toStrictEqual({ ok: true, issues: [] });
    expect(artifactRefIssues(body).map(issue => issue.entryIds)).toEqual([
      [LEGACY_ID],
    ]);
  });

  it("still reports a just-written entry whose ref is short", () => {
    const document = handWrittenSection({
      [LEGACY_ID]: LEGACY_SHORT,
      [VERIFY_ID]: SHORT,
    });

    const issues = verifyLisaUsageSectionIntegrity(document, {
      entryIds: [VERIFY_ID],
    }).issues;
    expect(issues.map(issue => [issue.code, issue.entryIds])).toEqual([
      [ISSUE_CODE, [VERIFY_ID]],
    ]);
    expect(issues[0]?.message).not.toContain(LEGACY_ID);
  });
});

describe("writer and read-back share one artifact_ref grammar (#4846)", () => {
  it("the writer's assertion is the shared module's function", () => {
    expect(assertCanonicalArtifactRef).toBe(
      sharedGrammar.assertCanonicalArtifactRef
    );
  });

  it("the shared describer agrees with the writer on each form", () => {
    expect(sharedGrammar.canonicalArtifactRefViolation(QUALIFIED)).toBeNull();
    expect(sharedGrammar.canonicalArtifactRefViolation(GITHUB_REF)).toBeNull();
    expect(sharedGrammar.canonicalArtifactRefViolation(SHORT)).toContain(
      REQUIRED_FORM
    );
  });

  it("both the TS writer and the read-back module import the shared module", () => {
    const writer = readFileSync(
      path.join(REPO_ROOT, "src/utils/usage-accounting.ts"),
      "utf8"
    );
    const readBack = readFileSync(
      path.join(
        REPO_ROOT,
        "all/copy-overwrite/scripts/lib/usage-ledger-integrity.mjs"
      ),
      "utf8"
    );

    expect(writer).toContain(
      'from "../../all/copy-overwrite/scripts/lib/usage-artifact-ref.mjs"'
    );
    expect(readBack).toContain('from "./usage-artifact-ref.mjs"');
    expect(verifyFromScripts).toBe(verifyLisaUsageSectionIntegrity);
  });
});

describe("completion proof is unchanged by the read-back grammar check (#4846)", () => {
  const context = { provider: "linear", scope: "acme/ENG" };

  it("a legacy short-ref row on another entry still lets a qualified Verify entry authorize", () => {
    const document = handWrittenSection({
      [LEGACY_ID]: LEGACY_SHORT,
      [VERIFY_ID]: QUALIFIED,
    });
    expect(artifactRefIssues(document)).toHaveLength(1);
    expect(isLisaUsageLedgerIntact(document)).toBe(true);

    expect(() =>
      validateVerifyUsage([document], "ENG-11", [VERIFY_ID], context)
    ).not.toThrow();
  });

  it("a short-ref Verify entry is still refused as absent, not as a broken ledger", () => {
    const document = handWrittenSection({ [VERIFY_ID]: SHORT });

    expect(() =>
      validateVerifyUsage([document], "ENG-11", [VERIFY_ID], context)
    ).toThrow(/absent or belongs to another work item/);
  });

  it("structural corruption still makes the ledger non-intact", () => {
    const document = handWrittenSection({ [VERIFY_ID]: QUALIFIED }).replace(
      /<!-- lisa:usage-rollup [^\n]*-->/,
      ""
    );

    expect(isLisaUsageLedgerIntact(document)).toBe(false);
  });
});

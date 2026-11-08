/**
 * Linear stores Markdown with square brackets escaped, so a Validation Journey
 * marker written as `[EVIDENCE: cli-output: name]` is read back as
 * `\[EVIDENCE: cli-output: name\]`. The completion-proof parser must read both
 * forms identically and still refuse a genuinely malformed declaration
 * (CodySwannGT/lisa#4670; same root cause as #4341).
 *
 * It also pins `validateVerifyUsage` (CodySwannGT/lisa#4564 finding 4): one
 * malformed or integrity-failing `## Lisa Usage` section in a comment must not
 * void an intact Verify entry elsewhere, while a broken section in the
 * work-item body stays fatal.
 */
import { describe, expect, it } from "vitest";

import {
  validateManifest,
  validateVerifyUsage,
} from "../../../all/copy-overwrite/scripts/lib/completion-proof-content.mjs";
import { localMarkers } from "../../../all/copy-overwrite/scripts/lib/completion-proof-shape.mjs";
import {
  proofUsage,
  PROOF_REF,
} from "../../support/work-item-proof-fixture.js";

const MALFORMED =
  "A local evidence declaration is malformed; repair its type and name.";

/** A Validation Journey with five markers of both kinds observed in #4670. */
const WRITTEN = [
  "## Validation Journey",
  "",
  "1. Run the export command. [EVIDENCE: cli-output: export-command-output]",
  "2. Run the import command. [EVIDENCE: cli-output: import-command-output]",
  "3. Reject a bad input. [EVIDENCE: cli-output: rejected-bad-input]",
  "4. Run the unit suite. [EVIDENCE: test-run-log: unit-suite]",
  "5. Run the integration suite. [EVIDENCE: test-run-log: integration-suite]",
  "",
].join("\n");

/** The same description as Linear's GraphQL `issue { description }` returns it. */
const STORED_BY_LINEAR = WRITTEN.replace(
  /\[EVIDENCE: ([^\]]*)\]/g,
  String.raw`\[EVIDENCE: $1\]`
);

const CLI_OUTPUT = "cli-output";
const TEST_RUN_LOG = "test-run-log";

const EXPECTED = [
  { kind: CLI_OUTPUT, name: "export-command-output" },
  { kind: CLI_OUTPUT, name: "import-command-output" },
  { kind: CLI_OUTPUT, name: "rejected-bad-input" },
  { kind: TEST_RUN_LOG, name: "unit-suite" },
  { kind: TEST_RUN_LOG, name: "integration-suite" },
];

describe("completion proof reads Linear-escaped evidence markers (#4670)", () => {
  it("the stored fixture really is the escaped form from the reproduction", () => {
    expect(STORED_BY_LINEAR).toContain(
      String.raw`\[EVIDENCE: cli-output: export-command-output\]`
    );
    expect(STORED_BY_LINEAR).toContain(
      String.raw`\[EVIDENCE: test-run-log: unit-suite\]`
    );
    expect(STORED_BY_LINEAR).not.toMatch(/(?<!\\)\[EVIDENCE:/);
  });

  it("parses the unescaped description to five markers", () => {
    expect(localMarkers(WRITTEN)).toEqual(EXPECTED);
  });

  it("parses the Linear-stored escaped description to the same five markers", () => {
    expect(localMarkers(STORED_BY_LINEAR)).toEqual(EXPECTED);
  });

  it.each([
    [String.raw`\[EVIDENCE: cli-output: npm-ci\]`, CLI_OUTPUT, "npm-ci"],
    [
      String.raw`\[EVIDENCE: test-run-log: ordinary-gates\]`,
      TEST_RUN_LOG,
      "ordinary-gates",
    ],
    [String.raw`\[EVIDENCE: cli-output: npm-ci]`, CLI_OUTPUT, "npm-ci"],
    [String.raw`[EVIDENCE: cli-output: npm-ci\]`, CLI_OUTPUT, "npm-ci"],
    [String.raw`\[SCREENSHOT: home-page\]`, "screenshot", "home-page"],
  ])("reads %s as a local marker", (marker, kind, name) => {
    expect(localMarkers(`Step one. ${marker}\n`)).toEqual([{ kind, name }]);
  });

  it("binds the escaped manifest exactly as the unescaped one", () => {
    const manifest = EXPECTED.map((row, index) => ({
      ...row,
      evidence_id: `E${index}`,
    }));
    const evidence = new Map(
      manifest.map(row => [row.evidence_id, { kind: row.kind }])
    );
    expect(() =>
      validateManifest({ manifest }, STORED_BY_LINEAR, evidence)
    ).not.toThrow();
    expect(() =>
      validateManifest(
        { manifest: manifest.slice(1) },
        STORED_BY_LINEAR,
        evidence
      )
    ).toThrow(/incomplete/);
  });

  it.each([
    String.raw`\[EVIDENCE-REF: JUD-12 | cli-output: export-command-output\]`,
    String.raw`\[EVIDENCE-REF: JUD-12: cli-output: export-command-output\]`,
  ])("keeps escaped cross-item reference %s non-claiming", reference => {
    expect(localMarkers(`See ${reference}\n${STORED_BY_LINEAR}`)).toEqual(
      EXPECTED
    );
    expect(localMarkers(`Only ${reference}\n`)).toEqual([]);
  });

  it.each([
    ["untyped", String.raw`\[EVIDENCE: load-failure-handled\]`],
    ["uppercase name", String.raw`\[EVIDENCE: cli-output: Bad-Name\]`],
    ["empty name", String.raw`\[EVIDENCE: cli-output: \]`],
    ["unterminated", String.raw`\[EVIDENCE: cli-output: npm-ci`],
    ["underscore name", String.raw`\[EVIDENCE: cli-output: bad\_name\]`],
  ])("still refuses a malformed escaped marker (%s)", (_label, marker) => {
    expect(() => localMarkers(`Step. ${marker}\n`)).toThrow(MALFORMED);
    expect(() =>
      localMarkers(`Step. ${marker.replaceAll("\\", "")}\n`)
    ).toThrow(MALFORMED);
  });

  it("still refuses an unsupported type in escaped form", () => {
    expect(() => localMarkers(String.raw`\[EVIDENCE: video: demo\]`)).toThrow(
      "A local evidence declaration has an unsupported type."
    );
  });

  it("still refuses duplicate names across escaped and unescaped forms", () => {
    expect(() =>
      localMarkers(
        `${String.raw`\[EVIDENCE: cli-output: same\]`}\n[EVIDENCE: test-run-log: same]\n`
      )
    ).toThrow("Local evidence declarations must have unique names.");
  });

  it("ignores escaped examples in fences and indented code", () => {
    const body = [
      "```",
      String.raw`\[EVIDENCE: cli-output: example\]`,
      "```",
      `    ${String.raw`\[EVIDENCE: cli-output: indented\]`}`,
      "",
    ].join("\n");
    expect(localMarkers(body)).toEqual([]);
  });

  it("keeps inline code bytes, so an escaped example there is never decoded into a claim", () => {
    const body = `Example \`${String.raw`\[EVIDENCE: cli-output: inline\]`}\` text.\n`;
    expect(() => localMarkers(body)).toThrow(MALFORMED);
  });

  it("decodes only one escape layer so a literal backslash cannot invent a marker", () => {
    expect(localMarkers(String.raw`\\[EVIDENCE: cli-output: kept\]`)).toEqual([
      { kind: CLI_OUTPUT, name: "kept" },
    ]);
    expect(() =>
      localMarkers(String.raw`[EVIDENCE: cli-output: kept\\]`)
    ).toThrow(MALFORMED);
  });
});

/**
 * Regression for CodySwannGT/lisa#4564 finding 4.
 *
 * `validateVerifyUsage` reads every comment on the work item, from any author.
 * A single malformed or integrity-failing `## Lisa Usage` section used to fail
 * the whole completion authorization as `invalid-proof`, even when the genuine
 * Verify entry was present and intact elsewhere.
 */
const CONTEXT = { provider: "github", scope: "acme/code" };
const EXPECTED_COMPLETION_PROOF_VERIFY_USAGE = ["verify-42"];

/**
 * Runs the validator and reports the refusal message, if any.
 * @param documents - Work-item body and comment bodies.
 * @returns The refusal message, or null when the usage is accepted.
 */
function refusal(documents: string[]): string | null {
  try {
    validateVerifyUsage(
      documents,
      PROOF_REF,
      EXPECTED_COMPLETION_PROOF_VERIFY_USAGE,
      CONTEXT
    );
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

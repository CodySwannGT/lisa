/**
 * Linear stores Markdown with square brackets escaped, so a Validation Journey
 * marker written as `[EVIDENCE: cli-output: name]` is read back as
 * `\[EVIDENCE: cli-output: name\]`. The completion-proof parser must read both
 * forms identically and still refuse a genuinely malformed declaration
 * (CodySwannGT/lisa#4670; same root cause as #4341).
 */
import { describe, expect, it } from "vitest";

import { validateManifest } from "../../../all/copy-overwrite/scripts/lib/completion-proof-content.mjs";
import { localMarkers } from "../../../all/copy-overwrite/scripts/lib/completion-proof-shape.mjs";

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

/**
 * Two completion-proof blind spots observed on a host project
 * (CodySwannGT/lisa#4700):
 *
 * 1. `localMarkers` dropped every line indented four spaces or a tab as
 *    indented code, so a `[EVIDENCE: kind: name]` marker on a list item's
 *    continuation line was invisible and the manifest had to be `[]`. A line
 *    only becomes indented code when it is indented four columns past the
 *    content of the list item that contains it, and never while it continues
 *    a paragraph.
 * 2. The conformance check looked up `## Acceptance Criteria` byte-for-byte,
 *    so `## Acceptance criteria` resolved to no section, no scenarios, and a
 *    trivial pass.
 */
import { describe, expect, it } from "vitest";

import { validateConformance } from "../../../all/copy-overwrite/scripts/lib/completion-proof-conformance.mjs";
import {
  declaredScope,
  localMarkers,
  primarySpecProjection,
  sha256,
} from "../../../all/copy-overwrite/scripts/lib/completion-proof-shape.mjs";

const SCREENSHOT = "screenshot";
const CLI_OUTPUT = "cli-output";
const LOGIN = [{ kind: SCREENSHOT, name: "login" }];
const STEP = "- Step one";
const PARENT = "- Parent step";
const CHILD = "  - Child step";
const ORDERED = "1. Step one";
const JOURNEY = "## Validation Journey";
const LOGIN_MARKER = "[EVIDENCE: screenshot: login]";
const EXAMPLE_MARKER = "[EVIDENCE: unknown-type: example]";
const H3_CRITERIA = "### Acceptance Criteria";
const UNREADABLE = "so its scenarios cannot be checked";
const OMITTED =
  "The attached conformance report omits a primary acceptance scenario.";

describe("completion proof claims markers on list continuation lines (#4700)", () => {
  it.each([
    {
      name: "a 2-space continuation of a bullet item",
      body: [STEP, `  ${LOGIN_MARKER}`],
    },
    {
      name: "a 4-space continuation of a bullet item",
      body: [STEP, `    ${LOGIN_MARKER}`],
    },
    {
      name: "a tab-indented continuation of a bullet item",
      body: [STEP, "\t[EVIDENCE: screenshot: login]"],
    },
    {
      name: "a 4-space continuation of an ordered item",
      body: [ORDERED, `    ${LOGIN_MARKER}`],
    },
    {
      name: "a continuation of a two-digit ordered item",
      body: ["10) Step ten", `    ${LOGIN_MARKER}`],
    },
    {
      name: "a continuation of a nested item",
      body: [PARENT, CHILD, `      ${LOGIN_MARKER}`],
    },
    {
      name: "a nested item indented four spaces",
      body: [PARENT, "    - Child step [EVIDENCE: screenshot: login]"],
    },
    {
      name: "a list item's second paragraph after a blank line",
      body: [STEP, "", `    ${LOGIN_MARKER}`],
    },
    {
      name: "a lazy paragraph continuation indented past any code threshold",
      body: ["Capture the login page", `        ${LOGIN_MARKER}`],
    },
  ])("claims $name", ({ body }) => {
    const text = [JOURNEY, "", ...body, ""].join("\n");
    expect(localMarkers(text)).toEqual(LOGIN);
    expect(primarySpecProjection(text)).toBe(text);
  });

  it("claims every marker in a realistic indented journey", () => {
    const text = [
      JOURNEY,
      "",
      "1. Open the login page.",
      `    ${LOGIN_MARKER}`,
      "2. Run the export.",
      "\t[EVIDENCE: cli-output: export-output]",
      "   - Confirm the file exists.",
      "       [EVIDENCE: cli-output: file-listing]",
      "",
    ].join("\n");
    expect(localMarkers(text)).toEqual([
      { kind: SCREENSHOT, name: "login" },
      { kind: CLI_OUTPUT, name: "export-output" },
      { kind: CLI_OUTPUT, name: "file-listing" },
    ]);
  });

  it.each([
    {
      name: "standalone indented code after a heading",
      body: [`    ${EXAMPLE_MARKER}`],
    },
    {
      name: "standalone tab-indented code after a blank line",
      body: ["Intro.", "", "\t[EVIDENCE: unknown-type: example]"],
    },
    {
      name: "indented code inside a bullet item",
      body: [STEP, "", `      ${EXAMPLE_MARKER}`],
    },
    {
      name: "indented code inside an ordered item",
      body: [ORDERED, "", `       ${EXAMPLE_MARKER}`],
    },
    {
      name: "indented code inside a nested item",
      body: [PARENT, CHILD, "", `        ${EXAMPLE_MARKER}`],
    },
    {
      name: "a fenced example inside a list item",
      body: [STEP, "", "    ```markdown", `    ${EXAMPLE_MARKER}`, "    ```"],
    },
    {
      name: "indented code after a list has ended",
      body: [STEP, "", "Closing paragraph.", "", `    ${EXAMPLE_MARKER}`],
    },
  ])("does not claim $name", ({ body }) => {
    const text = [
      JOURNEY,
      ...body,
      "",
      "1. Capture real output. [EVIDENCE: cli-output: actual]",
      "",
    ].join("\n");
    expect(localMarkers(text)).toEqual([{ kind: CLI_OUTPUT, name: "actual" }]);
  });

  it("refuses a malformed marker on a list continuation line", () => {
    const text = [STEP, "    [EVIDENCE: screenshot]", ""].join("\n");
    expect(() => localMarkers(text)).toThrow(
      "A local evidence declaration is malformed; repair its type and name."
    );
  });
});

describe("a list item's fence and thematic breaks do not hide or invent markers (#4700 review)", () => {
  it.each([
    {
      name: "a 4-space fence whose item ends at an unindented line",
      body: [STEP, "    ```", LOGIN_MARKER, "    ```"],
    },
    {
      name: "a tab-indented fence whose item ends at an unindented line",
      body: [STEP, "\t```", LOGIN_MARKER],
    },
    {
      name: "a fence after a blank line whose item ends at an unindented line",
      body: [STEP, "", "     ```", LOGIN_MARKER],
    },
    {
      name: "indented code after a starred thematic break",
      body: ["* * *", "", "     ```", LOGIN_MARKER],
    },
  ])("claims a marker after $name", ({ body }) => {
    const text = [JOURNEY, "", ...body, ""].join("\n");
    expect(localMarkers(text)).toEqual(LOGIN);
  });

  it("keeps hiding a marker inside a new top-level fence that ends a list item", () => {
    // GFM: the unindented ``` ends the item, closes its fence, and opens a new one.
    const text = [STEP, "  ```", "  x", "```", LOGIN_MARKER, ""].join("\n");
    expect(localMarkers(text)).toEqual([]);
  });

  it.each([
    { name: "---", body: ["---"] },
    { name: "***", body: ["***"] },
    { name: "___", body: ["___"] },
    { name: "* * *", body: ["* * *"] },
    { name: "- - -", body: ["- - -"] },
    { name: "a setext === heading", body: ["Heading", "==="] },
    { name: "a setext --- heading", body: ["Heading", "---"] },
  ])("treats a line indented after $name as code", ({ body }) => {
    const text = [...body, `    ${EXAMPLE_MARKER}`, ""].join("\n");
    expect(localMarkers(text)).toEqual([]);
  });
});

/** Run the real conformance reader against a full work-item body. */
function conforms(body: string, scenarioNames: string[]): void {
  const requirements = [
    { requirement_id: "R1", operator: "all", claim_ids: ["C1"] },
  ];
  const report = Buffer.from(
    JSON.stringify({
      verdict: "CONFORMS",
      spec_sha256: "a".repeat(64),
      work_item: "example/project#1",
      requirements: [{ ...requirements[0], status: "pass" }],
      scenario_names: scenarioNames,
    })
  );
  validateConformance(
    {
      spec_sha256: "a".repeat(64),
      requirements,
      obligations: {
        conformance: {
          report: { asset_id: 1, sha256: sha256(report), bytes: report.length },
        },
      },
    },
    { ref: "example/project#1" },
    { body },
    { asset: () => ({ bytes: report }) }
  );
}

/** A work item whose acceptance criteria sit under the given heading line. */
const withCriteria = (heading: string): string =>
  [
    "## Summary",
    "Ship the login flow.",
    "",
    heading,
    "Scenario: user signs in",
    "  Given a registered user",
    "  When they sign in",
    "  Then they see the dashboard",
    "",
    "## Out of Scope",
    "Scenario: not an acceptance scenario",
    "",
  ].join("\n");

describe("conformance finds the acceptance criteria heading in any case (#4700)", () => {
  it.each([
    "## Acceptance Criteria",
    "## Acceptance criteria",
    "## acceptance criteria",
    "## ACCEPTANCE CRITERIA",
    "##   Acceptance   Criteria",
    "## Acceptance\tCriteria",
    "## Acceptance Criteria ##",
    "## Acceptance criteria ###",
    "   ## Acceptance criteria   ",
  ])("reads scenarios under %j", heading => {
    const body = withCriteria(heading);
    expect(() => conforms(body, [])).toThrow(OMITTED);
    expect(() => conforms(body, ["user signs in"])).not.toThrow();
  });

  it("refuses two acceptance criteria sections that differ only in case", () => {
    const body = [
      withCriteria("## Acceptance Criteria"),
      "## acceptance criteria",
      "Scenario: a second list",
      "",
    ].join("\n");
    expect(() => conforms(body, ["user signs in", "a second list"])).toThrow(
      "Duplicate Acceptance Criteria sections make completion requirements ambiguous."
    );
  });

  it.each([
    "## Acceptance Criteria Notes",
    "## Acceptance Criteria:",
    H3_CRITERIA,
    "## Acceptance criteria (Gherkin)",
    "**Acceptance Criteria**",
  ])("refuses loudly instead of reading no scenarios under %j", heading => {
    expect(() => conforms(withCriteria(heading), [])).toThrow(UNREADABLE);
  });

  it("names the heading it could not read and how to fix it", () => {
    expect(() => conforms(withCriteria(H3_CRITERIA), [])).toThrow(
      'The acceptance criteria heading "### Acceptance Criteria" is not a level-two heading named "Acceptance Criteria", so its scenarios cannot be checked. Rename it to "## Acceptance Criteria".'
    );
  });

  it("ignores an acceptance criteria heading quoted inside a fence", () => {
    const body = ["## Summary", "```markdown", H3_CRITERIA, "```", ""].join(
      "\n"
    );
    expect(() => conforms(body, [])).not.toThrow();
  });

  it("still passes an item with no acceptance criteria heading at all", () => {
    expect(() => conforms("## Summary\nNo criteria.\n", [])).not.toThrow();
  });

  it("still refuses loudly, not silently, a recased target environment heading", () => {
    const body = "## target backend environment\nproduction\n";
    expect(() => declaredScope(body, "production")).toThrow(
      "The primary item does not declare target environment production"
    );
  });
});

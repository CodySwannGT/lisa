/**
 * Tests the shared reusable-workflow caller parser against every line shape
 * Lisa itself writes (CodySwannGT/lisa#4641).
 *
 * The parser feeds two checks — `scripts/detect-stale-workflow-inputs.mjs` and
 * `lisa health`'s `ci.workflows` finding. Both treat "no callers parsed" as
 * "nothing stale", so a caller line the parser cannot read is not a parse
 * error: it is a check that passes having inspected nothing. Lisa's own pin
 * step writes `uses: …@<sha> # v<version>`, and the parser used to skip that
 * shape entirely. These tests pin the reader to the writer: every line the
 * pinner emits must come back as a caller job, and a Lisa `uses:` line the
 * parser still cannot read must be surfaced rather than dropped.
 * @module tests/unit/scripts/reusable-workflow-contract
 */
import { describe, expect, it } from "vitest";

import {
  extractCallerJobs,
  findUnparsedLisaCallerLines,
} from "../../../scripts/lib/reusable-workflow-contract.mjs";
import { pinReusableWorkflowRefs } from "../../../src/core/reusable-workflow-pin.js";

/** A full-length commit SHA, as the pinner writes it. */
const SHA = "35d0951f9250572d16872c36b242d679cbc22d72";

/** The reusable workflow every fixture here calls. */
const QUALITY = "quality.yml";

/** The `with:` keys every fixture caller passes. */
const WITH_KEYS = ["node_version", "retired_input"];

/**
 * Build a one-job caller workflow around a single `uses:` line.
 * @param usesLine - The full `uses:` line, indentation included
 * @returns The workflow text
 */
function callerWith(usesLine: string): string {
  return [
    "jobs:",
    "  quality:",
    usesLine,
    "    with:",
    "      node_version: '22'",
    "      retired_input: true",
    "",
  ].join("\n");
}

/**
 * The single caller job a fixture is expected to yield.
 * @param ref - The ref the caller names
 * @returns The expected parsed job
 */
function qualityJob(ref: string): Record<string, unknown> {
  return {
    owner: "CodySwannGT",
    repo: "lisa",
    reusableFile: QUALITY,
    ref,
    withKeys: WITH_KEYS,
  };
}

describe("extractCallerJobs line shapes", () => {
  it("parses a pinned caller carrying Lisa's trailing version comment", () => {
    const content = callerWith(
      `    uses: CodySwannGT/lisa/.github/workflows/quality.yml@${SHA} # v4.87.7`
    );
    expect(extractCallerJobs(content)).toEqual([qualityJob(SHA)]);
  });

  it("parses a double-quoted pinned caller", () => {
    const content = callerWith(
      `    uses: "CodySwannGT/lisa/.github/workflows/quality.yml@${SHA}" # v4.87.7`
    );
    expect(extractCallerJobs(content)).toEqual([qualityJob(SHA)]);
  });

  it("parses a single-quoted caller without a comment", () => {
    const content = callerWith(
      "    uses: 'CodySwannGT/lisa/.github/workflows/quality.yml@main'"
    );
    expect(extractCallerJobs(content)).toEqual([qualityJob("main")]);
  });

  it("parses a comment-free caller", () => {
    const content = callerWith(
      "    uses: CodySwannGT/lisa/.github/workflows/quality.yml@main"
    );
    expect(extractCallerJobs(content)).toEqual([qualityJob("main")]);
  });

  it("ignores a commented-out caller", () => {
    const content = callerWith(
      `    # uses: CodySwannGT/lisa/.github/workflows/quality.yml@${SHA} # v4.87.7`
    );
    expect(extractCallerJobs(content)).toEqual([]);
  });

  it("parses every line the pinner writes, quoted or not", () => {
    const pin = { sha: SHA, version: "4.87.7" };
    const sources = [
      "    uses: CodySwannGT/lisa/.github/workflows/quality.yml@main",
      '    uses: "CodySwannGT/lisa/.github/workflows/quality.yml@main"',
      "    uses: 'CodySwannGT/lisa/.github/workflows/quality.yml@v4.0.0' # old",
    ];
    const parsed = sources.map(line =>
      extractCallerJobs(pinReusableWorkflowRefs(callerWith(line), pin))
    );
    expect(parsed).toEqual([
      [qualityJob(SHA)],
      [qualityJob(SHA)],
      [qualityJob(SHA)],
    ]);
  });
});

describe("findUnparsedLisaCallerLines", () => {
  it("reports a Lisa uses line whose reference cannot be read", () => {
    const content = callerWith(
      "    uses: CodySwannGT/lisa/.github/workflows/quality.yml # no ref"
    );
    expect(extractCallerJobs(content)).toEqual([]);
    expect(findUnparsedLisaCallerLines(content)).toEqual([
      {
        line: 3,
        text: "uses: CodySwannGT/lisa/.github/workflows/quality.yml # no ref",
      },
    ]);
  });

  it("matches the Lisa owner and repository case-insensitively", () => {
    const content = callerWith(
      "    uses: codyswanngt/LISA/.github/workflows/quality.yml@ bad"
    );
    expect(findUnparsedLisaCallerLines(content)).toEqual([
      {
        line: 3,
        text: "uses: codyswanngt/LISA/.github/workflows/quality.yml@ bad",
      },
    ]);
  });

  it("reports a ref glued to a # with no space, which GitHub reads as part of the ref", () => {
    const content = callerWith(
      "    uses: CodySwannGT/lisa/.github/workflows/quality.yml@main#note"
    );
    expect(extractCallerJobs(content)).toEqual([]);
    expect(findUnparsedLisaCallerLines(content)).toEqual([
      {
        line: 3,
        text: "uses: CodySwannGT/lisa/.github/workflows/quality.yml@main#note",
      },
    ]);
  });

  it("reports a quoted ref followed by a # with no space", () => {
    const content = callerWith(
      '    uses: "CodySwannGT/lisa/.github/workflows/quality.yml@abc"#x'
    );
    expect(extractCallerJobs(content)).toEqual([]);
    expect(findUnparsedLisaCallerLines(content)).toEqual([
      {
        line: 3,
        text: 'uses: "CodySwannGT/lisa/.github/workflows/quality.yml@abc"#x',
      },
    ]);
  });

  it("reports a uses value split onto the next line", () => {
    const content = [
      "jobs:",
      "  quality:",
      "    uses:",
      `      CodySwannGT/lisa/.github/workflows/quality.yml@${SHA}`,
      "",
    ].join("\n");
    expect(extractCallerJobs(content)).toEqual([]);
    expect(findUnparsedLisaCallerLines(content)).toEqual([
      {
        line: 4,
        text: `CodySwannGT/lisa/.github/workflows/quality.yml@${SHA}`,
      },
    ]);
  });

  it("reports a caller written as a flow mapping", () => {
    const content = [
      "jobs:",
      `  quality: { uses: CodySwannGT/lisa/.github/workflows/x.yml@${SHA} }`,
      "",
    ].join("\n");
    expect(extractCallerJobs(content)).toEqual([]);
    expect(findUnparsedLisaCallerLines(content)).toEqual([
      {
        line: 2,
        text: `quality: { uses: CodySwannGT/lisa/.github/workflows/x.yml@${SHA} }`,
      },
    ]);
  });

  it("reports nothing for a parsed pinned caller", () => {
    const content = callerWith(
      `    uses: CodySwannGT/lisa/.github/workflows/quality.yml@${SHA} # v4.87.7`
    );
    expect(findUnparsedLisaCallerLines(content)).toEqual([]);
  });

  it("reports nothing for a commented-out Lisa caller", () => {
    const content = callerWith(
      "    # uses: CodySwannGT/lisa/.github/workflows/quality.yml # no ref"
    );
    expect(findUnparsedLisaCallerLines(content)).toEqual([]);
  });

  it("reports nothing for a workflow with no Lisa caller", () => {
    const content = [
      "jobs:",
      "  build:",
      "    steps:",
      "      - uses: actions/checkout@v6",
      "",
    ].join("\n");
    expect(findUnparsedLisaCallerLines(content)).toEqual([]);
  });
});

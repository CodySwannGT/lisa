/**
 * Unit tests for scripts/detect-stale-workflow-inputs.mjs (issue #1423).
 *
 * Reproduces the reported bug class: an early-generation ("vintage") caller
 * workflow passes a `with:` input (`package_manager`) that the reusable
 * workflow it calls no longer declares. GitHub hard-fails such a run at
 * startup; this detector is the deterministic mechanism `lisa-update-projects`
 * (and CI) can use to catch that drift instead of leaving it silently broken.
 *
 * Two test surfaces:
 *   1. End-to-end: spawn the real script against the committed fixtures under
 *      `parity/fixtures/stale-workflow-inputs/` and assert stdout JSON + exit
 *      code.
 *   2. Pure functions imported directly, asserted against HARDCODED expected
 *      values per the Test Isolation house rule (never compute an expectation
 *      by calling the function under test).
 *
 * Shared fixtures/constants/helpers live in ./detect-stale-workflow-inputs-helpers.
 *
 * @module tests/unit/scripts/detect-stale-workflow-inputs
 */
import { describe, expect, it } from "vitest";
import {
  buildReport,
  diffStaleKeys,
  extractCallerJobs,
  extractDeclaredInputs,
  parseArgs,
  parseReusableReference,
  UsageError,
} from "../../../scripts/detect-stale-workflow-inputs.mjs";
import {
  ABSENT_PROJECT,
  CLAUDE_CI_AUTO_FIX_YML,
  CLAUDE_UNKNOWN_YML,
  CLAUDE_YML,
  CONTRACTS_FLAG,
  CONTRACTS_ROOT,
  findResult,
  PROJECT_CURRENT,
  PROJECT_FLAG,
  PROJECT_MIXED,
  PROJECT_NO_CALLER,
  PROJECT_VINTAGE,
  REUSABLE_CLAUDE_YML,
  runDetector,
} from "./detect-stale-workflow-inputs-helpers";

describe("detect-stale-workflow-inputs end-to-end", () => {
  it("flags the vintage caller's package_manager as stale (exit 1)", () => {
    const { code, report } = runDetector([
      PROJECT_FLAG,
      PROJECT_VINTAGE,
      CONTRACTS_FLAG,
      CONTRACTS_ROOT,
      "--json",
    ]);

    expect(code).toBe(1);
    expect(report.summary).toEqual({
      scanned: 1,
      ok: 0,
      stale: 1,
      unknownContract: 0,
    });
    const result = findResult(report, CLAUDE_YML);
    expect(result?.reusableFile).toBe(REUSABLE_CLAUDE_YML);
    expect(result?.staleInputs).toEqual(["package_manager"]);
    expect(result?.status).toBe("stale");
  });

  it("reports a current-template caller as clean (exit 0)", () => {
    const { code, report } = runDetector([
      PROJECT_FLAG,
      PROJECT_CURRENT,
      CONTRACTS_FLAG,
      CONTRACTS_ROOT,
      "--json",
    ]);

    expect(code).toBe(0);
    expect(report.summary).toEqual({
      scanned: 1,
      ok: 1,
      stale: 0,
      unknownContract: 0,
    });
    const result = findResult(report, CLAUDE_YML);
    expect(result?.staleInputs).toEqual([]);
    expect(result?.status).toBe("ok");
  });

  it("aggregates stale, ok, and unknown-contract across files in one project", () => {
    const { code, report } = runDetector([
      PROJECT_FLAG,
      PROJECT_MIXED,
      CONTRACTS_FLAG,
      CONTRACTS_ROOT,
      "--json",
    ]);

    expect(code).toBe(1);
    expect(report.summary).toEqual({
      scanned: 3,
      ok: 1,
      stale: 1,
      unknownContract: 1,
    });
    expect(findResult(report, CLAUDE_CI_AUTO_FIX_YML)?.status).toBe("stale");
    expect(findResult(report, CLAUDE_YML)?.status).toBe("ok");
    expect(findResult(report, CLAUDE_UNKNOWN_YML)?.status).toBe(
      "unknown-contract"
    );
  });

  it("reports zero results for a project with no reusable-workflow caller", () => {
    const { code, report } = runDetector([
      PROJECT_FLAG,
      PROJECT_NO_CALLER,
      CONTRACTS_FLAG,
      CONTRACTS_ROOT,
      "--json",
    ]);

    expect(code).toBe(0);
    expect(report.results).toEqual([]);
    expect(report.summary).toEqual({
      scanned: 0,
      ok: 0,
      stale: 0,
      unknownContract: 0,
    });
  });

  it("exits 2 with a usage error for a missing --project directory", () => {
    const { code } = runDetector([PROJECT_FLAG, ABSENT_PROJECT]);
    expect(code).toBe(2);
  });

  it("exits 2 for an unknown flag", () => {
    const { code } = runDetector(["--bogus"]);
    expect(code).toBe(2);
  });

  it("scans multiple --project roots in one invocation", () => {
    const { code, report } = runDetector([
      PROJECT_FLAG,
      PROJECT_VINTAGE,
      PROJECT_FLAG,
      PROJECT_CURRENT,
      CONTRACTS_FLAG,
      CONTRACTS_ROOT,
      "--json",
    ]);

    expect(code).toBe(1);
    expect(report.summary).toEqual({
      scanned: 2,
      ok: 1,
      stale: 1,
      unknownContract: 0,
    });
  });
});

describe("parseReusableReference", () => {
  it("parses an owner/repo reusable-workflow uses value", () => {
    expect(
      parseReusableReference(
        "CodySwannGT/lisa/.github/workflows/reusable-claude.yml@main"
      )
    ).toEqual({
      file: REUSABLE_CLAUDE_YML,
      owner: "CodySwannGT",
      repo: "lisa",
      ref: "main",
    });
  });

  it("returns null for a plain action reference", () => {
    expect(parseReusableReference("actions/checkout@v6")).toBeNull();
  });
});

describe("extractCallerJobs", () => {
  it("extracts the with: keys of a reusable-workflow job", () => {
    const content = [
      "jobs:",
      "  claude:",
      "    uses: CodySwannGT/lisa/.github/workflows/reusable-claude.yml@main",
      "    with:",
      "      event_name: x",
      "      package_manager: bun",
      "    secrets: inherit",
      "",
    ].join("\n");
    expect(extractCallerJobs(content)).toEqual([
      {
        owner: "CodySwannGT",
        repo: "lisa",
        reusableFile: REUSABLE_CLAUDE_YML,
        ref: "main",
        withKeys: ["event_name", "package_manager"],
      },
    ]);
  });

  it("returns an empty withKeys array when there is no with: block", () => {
    const content = [
      "jobs:",
      "  claude:",
      "    uses: CodySwannGT/lisa/.github/workflows/reusable-claude.yml@main",
      "    secrets: inherit",
      "",
    ].join("\n");
    expect(extractCallerJobs(content)).toEqual([
      {
        owner: "CodySwannGT",
        repo: "lisa",
        reusableFile: REUSABLE_CLAUDE_YML,
        ref: "main",
        withKeys: [],
      },
    ]);
  });

  it("ignores jobs with inline steps instead of a reusable uses:", () => {
    const content = [
      "jobs:",
      "  build:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v6",
      "",
    ].join("\n");
    expect(extractCallerJobs(content)).toEqual([]);
  });
});

describe("extractDeclaredInputs", () => {
  it("extracts the workflow_call.inputs top-level keys", () => {
    const content = [
      "on:",
      "  workflow_call:",
      "    inputs:",
      "      event_name:",
      "        required: true",
      "        type: string",
      "      author_association:",
      "        required: false",
      "    secrets:",
      "      TOKEN:",
      "        required: false",
      "",
    ].join("\n");
    expect(extractDeclaredInputs(content)).toEqual([
      "author_association",
      "event_name",
    ]);
  });

  it("returns null when there is no workflow_call.inputs block", () => {
    const content = ["on:", "  push:", "    branches: [main]", ""].join("\n");
    expect(extractDeclaredInputs(content)).toBeNull();
  });

  it("returns an empty array for a reusable workflow with no inputs", () => {
    const content = [
      "on:",
      "  workflow_call:",
      "    secrets:",
      "      TOKEN:",
      "        required: true",
      "",
    ].join("\n");
    expect(extractDeclaredInputs(content)).toEqual([]);
  });
});

describe("diffStaleKeys", () => {
  it("returns keys used but not declared, sorted", () => {
    expect(diffStaleKeys(["b", "package_manager", "a"], ["a", "b"])).toEqual([
      "package_manager",
    ]);
  });

  it("returns an empty array when nothing is stale", () => {
    expect(diffStaleKeys(["a", "b"], ["a", "b", "c"])).toEqual([]);
  });
});

describe("buildReport", () => {
  it("computes ok/stale/unknownContract summary counts from hardcoded rows", () => {
    const results = [
      { status: "ok" },
      { status: "stale" },
      { status: "stale" },
      { status: "unknown-contract" },
    ];
    expect(
      buildReport(results, { projects: ["/p"], contractsRoot: "/c" })
    ).toEqual({
      contractsRoot: "/c",
      projects: ["/p"],
      results,
      schemaVersion: 1,
      summary: { ok: 1, scanned: 4, stale: 2, unknownContract: 1 },
    });
  });
});

describe("parseArgs", () => {
  it("throws UsageError for an unknown flag", () => {
    expect(() => parseArgs(["--nope"])).toThrow(UsageError);
  });

  it("throws UsageError when --project is missing its value", () => {
    expect(() => parseArgs(["--project"])).toThrow(UsageError);
  });

  it("throws UsageError when --contracts-root is missing its value", () => {
    expect(() => parseArgs(["--contracts-root"])).toThrow(UsageError);
  });

  it("defaults projects to [cwd] when none are given", () => {
    const opts = parseArgs([]);
    expect(opts.projects).toEqual([process.cwd()]);
    expect(opts.json).toBe(false);
  });

  it("collects repeated --project flags in order", () => {
    const opts = parseArgs(["--project", "/a", "--project", "/b"]);
    expect(opts.projects).toEqual(["/a", "/b"]);
  });
});

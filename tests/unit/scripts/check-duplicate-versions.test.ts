/**
 * Unit tests for scripts/check-duplicate-versions.mjs (issue #1888).
 *
 * The behaviour under test is that the canonical dependency manifest is
 * AUTHORITATIVE: a version literal copied into a governed workflow, script,
 * template, or fixture is a second edit site that a routine bump can miss, and
 * the detector must name it with a file, a line, and a remediation.
 *
 * Equally important is the bounded-false-positive acceptance criterion — a
 * false "duplicate" erodes the check — so a large share of these tests assert
 * what the detector must NOT flag: lockfiles, prose, comments, loose ranges,
 * unmanaged packages, and documented exceptions.
 *
 * Three test surfaces:
 *   1. End-to-end: spawn the real script against the committed fixtures under
 *      `tests/fixtures/duplicate-versions/` and assert stdout JSON + exit code.
 *   2. Pure functions imported directly, asserted against HARDCODED expected
 *      values per the Test Isolation house rule (never compute an expectation
 *      by calling the function under test).
 *   3. The Validation Journey: change a fixture manifest pin in a temp copy and
 *      confirm the duplicated literal is still reported — WITHOUT editing the
 *      detector.
 *
 * Shared fixtures/constants/helpers live in ./check-duplicate-versions-helpers.
 *
 * @module tests/unit/scripts/check-duplicate-versions
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { EXCEPTION_MARKER } from "../../../scripts/check-duplicate-versions.mjs";
import {
  AST_GREP,
  AST_GREP_VERSION,
  BUN_VERSION,
  CLEAN_FIXTURE,
  EXCEPTION_FIXTURE,
  findingsFor,
  MANIFEST_FIELD_AST_GREP,
  MANIFEST_FIELD_BUN,
  JSON_FLAG,
  REPO_ROOT,
  ROOT_FLAG,
  runDetector,
  runDetectorAtRepoRoot,
  runRaw,
  SCAN_ALL,
  SCAN_FLAG,
  STRICT_FLAG,
  VIOLATION_FIXTURE,
  WORKFLOW_FILE,
} from "./check-duplicate-versions-helpers";

const temporaryRoots: string[] = [];

afterAll(() => {
  for (const directory of temporaryRoots) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe("check-duplicate-versions end-to-end", () => {
  it("flags the duplicated workflow install pin with file, line, and remediation", () => {
    const { code, report } = runDetector(VIOLATION_FIXTURE, [STRICT_FLAG]);

    expect(code).toBe(1);
    expect(report.summary).toEqual({
      files: 1,
      duplicate: 2,
      drifted: 0,
      allowed: 0,
    });

    const [finding] = findingsFor(report, AST_GREP);
    expect(finding?.file).toBe(WORKFLOW_FILE);
    expect(finding?.line).toBe(17);
    expect(finding?.version).toBe(AST_GREP_VERSION);
    expect(finding?.manifestVersion).toBe(AST_GREP_VERSION);
    expect(finding?.manifestField).toBe(MANIFEST_FIELD_AST_GREP);
    expect(finding?.source).toBe("install-pin");
    expect(finding?.status).toBe("duplicate");
    expect(finding?.remediation).toContain("manifest + lockfile only");
  });

  it("flags the duplicated toolchain pin against the manifest engines field", () => {
    const { report } = runDetector(VIOLATION_FIXTURE);

    const [finding] = findingsFor(report, "bun");
    expect(finding?.file).toBe(WORKFLOW_FILE);
    expect(finding?.line).toBe(15);
    expect(finding?.version).toBe(BUN_VERSION);
    expect(finding?.manifestField).toBe(MANIFEST_FIELD_BUN);
    expect(finding?.source).toBe("toolchain-pin");
  });

  it("passes the clean, manifest-derived fixture with no findings", () => {
    const { code, report } = runDetector(CLEAN_FIXTURE, [STRICT_FLAG]);

    expect(code).toBe(0);
    expect(report.findings).toEqual([]);
    expect(report.summary.duplicate).toBe(0);
    expect(report.summary.drifted).toBe(0);
  });

  it("passes the documented-exception fixture, recording each reason", () => {
    const { code, report } = runDetector(EXCEPTION_FIXTURE, [STRICT_FLAG]);

    expect(code).toBe(0);
    expect(report.summary.duplicate).toBe(0);
    expect(report.summary.allowed).toBe(2);
    expect(report.findings.map(f => f.status)).toEqual(["allowed", "allowed"]);
    expect(findingsFor(report, AST_GREP)[0]?.exception).toBe(
      "migrating to manifest-derived install (#1888)"
    );
  });

  it("ignores lockfiles, prose, comments, loose ranges, and unmanaged packages", () => {
    const { report } = runDetector(VIOLATION_FIXTURE);

    // bun.lock and NOTES.md both contain `@ast-grep/cli@0.40.4`; the only
    // finding for that package is the one active workflow pin.
    expect(findingsFor(report, AST_GREP)).toHaveLength(1);
    expect(report.findings.every(f => f.file === WORKFLOW_FILE)).toBe(true);
    // `some-unmanaged-tool@9.9.9` is not manifest-pinned; `22.x` is not a
    // literal; the commented-out install line is prose.
    expect(findingsFor(report, "some-unmanaged-tool")).toEqual([]);
    expect(findingsFor(report, "node")).toEqual([]);
  });

  it("defaults to advisory mode, reporting findings but exiting zero", () => {
    const { code, report } = runDetector(VIOLATION_FIXTURE);

    expect(code).toBe(0);
    expect(report.mode).toBe("advisory");
    expect(report.summary.duplicate).toBe(2);
  });

  it("emits an intact JSON report even when strict mode fails", () => {
    const { code, stdout } = runRaw([
      ROOT_FLAG,
      VIOLATION_FIXTURE,
      SCAN_FLAG,
      SCAN_ALL,
      JSON_FLAG,
      STRICT_FLAG,
    ]);

    expect(code).toBe(1);
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  it("prints the remediation rule in its help output", () => {
    const { code, stdout } = runRaw(["--help"]);

    expect(code).toBe(0);
    expect(stdout).toContain("Remediation rule");
    expect(stdout).toContain(EXCEPTION_MARKER);
  });

  it("exits 2 on an unknown argument", () => {
    expect(runRaw(["--nope"]).code).toBe(2);
  });
});

describe("check-duplicate-versions Validation Journey", () => {
  it("reports the duplicated literal after a manifest pin change, with no detector edit", () => {
    const temporary = fs.mkdtempSync(
      path.join(os.tmpdir(), "duplicate-versions-journey-")
    );
    temporaryRoots.push(temporary);
    fs.cpSync(VIOLATION_FIXTURE, temporary, { recursive: true });

    const manifestPath = path.join(temporary, "package.json");
    fs.writeFileSync(
      manifestPath,
      fs.readFileSync(manifestPath, "utf8").replace("^0.40.4", "^0.41.0")
    );

    const { code, report } = runDetector(temporary, [STRICT_FLAG]);

    // The workflow still carries 0.40.4 — the bump touched only the manifest,
    // which is precisely the drift this check exists to name.
    expect(code).toBe(1);
    const [finding] = findingsFor(report, AST_GREP);
    expect(finding?.version).toBe(AST_GREP_VERSION);
    expect(finding?.manifestVersion).toBe("0.41.0");
    expect(finding?.status).toBe("drifted");
    expect(finding?.file).toBe(WORKFLOW_FILE);
  });
});

describe("verification-path wiring", () => {
  it("exposes the check as a package script", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
    ) as { scripts: Record<string, string> };

    expect(manifest.scripts["check:duplicate-versions"]).toBe(
      "node scripts/check-duplicate-versions.mjs"
    );
  });

  it("runs in CI in advisory mode, without --strict", () => {
    const workflow = fs.readFileSync(
      path.join(REPO_ROOT, ".github/workflows/duplicate-versions.yml"),
      "utf8"
    );

    const invocations = workflow
      .split("\n")
      .filter(
        line =>
          line.includes("check-duplicate-versions.mjs") &&
          !line.trimStart().startsWith("#")
      );

    expect(invocations).toHaveLength(1);
    // Advisory rollout: Lisa still carries pre-existing duplicates, so the job
    // must report without reddening CI. Flipping this to --strict is the
    // deliberate, separate act of turning the check into a gate.
    expect(invocations[0]).not.toContain("--strict");
    expect(workflow).toContain("ADVISORY");
  });

  it("keeps Lisa's own advisory run green while duplicates remain", () => {
    const { code, report } = runDetectorAtRepoRoot();

    expect(code).toBe(0);
    expect(report.mode).toBe("advisory");
  });
});

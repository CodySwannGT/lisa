/**
 * Unit coverage for the context-routing readiness producer (B6, PRD #1739,
 * #1896).
 *
 * Dimension 1 asks whether an agent can recover the real job from what is
 * written down — and blocker B6 asks the sharper half of that question: does the
 * written word claim only what something actually enforces? Documentation
 * cross-checking is false-positive-prone, so this producer is deliberately
 * high-precision: it stands B6 only when a doc names a specific enforcing
 * mechanism that demonstrably does not exist, and only ever as `WARN`, never
 * `FAIL`.
 *
 * The load-bearing negative cases are therefore the ones that must NOT stand a
 * blocker: a claim with no named mechanism, a claim inside a code fence, a
 * hedged sentence, and a repository whose docs match reality.
 * @module tests/unit/cli/doctor-readiness-context
 */
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONTEXT_ROUTING_DIMENSION_ID,
  assessContextRoutingDimension,
} from "../../../src/cli/doctor-readiness-context.js";
import { assessReadiness } from "../../../src/cli/doctor-readiness-blockers.js";
import {
  asFindings,
  FAIL,
  makeScratchRepo,
  PASS,
  SKIP,
  WARN,
  writeRepoFile,
  writeRepoJson,
} from "../../helpers/readiness-workflow-fixtures.js";

/** The dimension this producer owns. */
const DIMENSION_ID = "context-routing";

/** The ship blocker this producer can stand up. */
const BLOCKER_ID = "B6";

/** The wiki index that carries a repository's durable knowledge. */
const WIKI_INDEX = "wiki/index.md";

/** A neutral canonical instruction file that makes no enforcement claim. */
const AGENTS_MD = [
  "# Agent Instructions",
  "",
  "This project builds a small command line tool.",
  "",
].join("\n");

let tempDir: string | undefined;

/**
 * Resolve a scratch repository for one test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await makeScratchRepo("context");
  return tempDir;
}

/**
 * Write the four positive context-routing artifacts: a canonical `AGENTS.md`, a
 * `CLAUDE.md` pointer to it, a parseable `.lisa.config.json`, and a wiki index.
 * @param root - Repository root
 */
async function writeRoutingArtifacts(root: string): Promise<void> {
  await writeRepoFile(root, "AGENTS.md", AGENTS_MD);
  await writeRepoFile(root, "CLAUDE.md", "@AGENTS.md\n");
  await writeRepoJson(root, ".lisa.config.json", { tracker: "github" });
  await writeRepoFile(root, WIKI_INDEX, "# Wiki Index\n");
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("assessContextRoutingDimension — B6 (documentation overstates enforcement)", () => {
  it("WARNs with an evidenced B6 finding when a named enforcing hook does not exist", async () => {
    const cwd = await getTempDir();
    await writeRoutingArtifacts(cwd);
    await writeRepoFile(
      cwd,
      "README.md",
      "# Scratch\n\nThe `.husky/pre-commit` hook always runs the full test suite.\n"
    );

    const record = await assessContextRoutingDimension(cwd);

    expect(record.id).toBe(DIMENSION_ID);
    // WARN, never FAIL: a doc cross-check is not certain enough to fail on.
    expect(record.status).toBe(WARN);
    expect(record.status).not.toBe(FAIL);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding).toBeDefined();
    expect(typeof finding?.evidence).toBe("string");
    expect(finding?.evidence).not.toBe("");
    expect(finding?.evidence).toContain(".husky/pre-commit");
    expect(finding?.evidence).toContain("README.md");
    expect(finding?.invariant_violated).not.toBe("");
    expect(typeof finding?.why_proof_missed).toBe("string");
    expect(typeof finding?.root_correction).toBe("string");
    expect(Array.isArray(finding?.machinery_to_remove)).toBe(true);
  });

  it("flips the readiness verdict to NOT_READY with B6 standing on dimension 1", async () => {
    const cwd = await getTempDir();
    await writeRoutingArtifacts(cwd);
    await writeRepoFile(
      cwd,
      "README.md",
      "# Scratch\n\nThe `.husky/pre-commit` hook always runs the full test suite.\n"
    );

    const record = await assessContextRoutingDimension(cwd);
    const assessment = assessReadiness([record]);

    expect(assessment.verdict).toBe("NOT_READY");
    expect(assessment.blockers[0].id).toBe(BLOCKER_ID);
    expect(assessment.blockers[0].dimension_id).toBe(DIMENSION_ID);
    expect(assessment.blockers[0].label).toBe(
      "Documentation overstates enforced guarantees"
    );
    expect(assessment.narrowed_claim).toContain("NOT ready");
  });

  it("reads enforcement claims out of .claude/rules/*.md too", async () => {
    const cwd = await getTempDir();
    await writeRoutingArtifacts(cwd);
    await writeRepoFile(
      cwd,
      ".claude/rules/PROJECT_RULES.md",
      "# Rules\n\nEvery push is blocked by `.github/workflows/gatekeeper.yml`.\n"
    );

    const record = await assessContextRoutingDimension(cwd);

    expect(record.status).toBe(WARN);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain(".github/workflows/gatekeeper.yml");
    expect(finding?.evidence).toContain("PROJECT_RULES.md");
  });
});

describe("assessContextRoutingDimension — precision guards", () => {
  it("PASSes with NO blocker key when every named mechanism exists", async () => {
    const cwd = await getTempDir();
    await writeRoutingArtifacts(cwd);
    await writeRepoFile(cwd, ".husky/pre-commit", "#!/bin/sh\nnpm test\n");
    await writeRepoFile(
      cwd,
      "README.md",
      "# Scratch\n\nEvery commit is blocked by `.husky/pre-commit` when the tests fail.\n"
    );

    const record = await assessContextRoutingDimension(cwd);

    expect(record.status).toBe(PASS);
    // Load-bearing: the engine stands a blocker on any finding naming an id with
    // evidence, so a clean finding must not name one at all.
    for (const finding of asFindings(record.findings)) {
      expect(Object.hasOwn(finding, "blocker")).toBe(false);
    }
    expect(assessReadiness([record]).blockers).toEqual([]);
    expect(assessReadiness([record]).verdict).toBe("READY");
    expect(JSON.stringify(record.findings)).toContain("AGENTS.md");
    expect(JSON.stringify(record.findings)).toContain(WIKI_INDEX);
  });

  it("never stands B6 on a claim that names no mechanism at all", async () => {
    const cwd = await getTempDir();
    await writeRoutingArtifacts(cwd);
    await writeRepoFile(
      cwd,
      "README.md",
      "# Scratch\n\nFormatting is enforced on every commit.\n"
    );

    const record = await assessContextRoutingDimension(cwd);

    // An unmappable claim is reported as unmappable, never guessed into a
    // violation and never dropped into silence.
    for (const finding of asFindings(record.findings)) {
      expect(Object.hasOwn(finding, "blocker")).toBe(false);
    }
    expect(assessReadiness([record]).blockers).toEqual([]);
    expect(JSON.stringify(record.findings)).toContain(
      "Formatting is enforced on every commit."
    );
  });

  it("never stands B6 on a claim inside a fenced code block", async () => {
    const cwd = await getTempDir();
    await writeRoutingArtifacts(cwd);
    await writeRepoFile(
      cwd,
      "README.md",
      [
        "# Scratch",
        "",
        "```md",
        "Every commit is blocked by `.husky/absent-hook`.",
        "```",
        "",
      ].join("\n")
    );

    const record = await assessContextRoutingDimension(cwd);

    expect(assessReadiness([record]).blockers).toEqual([]);
    for (const finding of asFindings(record.findings)) {
      expect(Object.hasOwn(finding, "blocker")).toBe(false);
    }
  });

  it("never stands B6 on a hedged or hypothetical sentence", async () => {
    const cwd = await getTempDir();
    await writeRoutingArtifacts(cwd);
    await writeRepoFile(
      cwd,
      "README.md",
      "# Scratch\n\nFor example, a push could be blocked by `.husky/absent-hook`.\n"
    );

    const record = await assessContextRoutingDimension(cwd);

    expect(assessReadiness([record]).blockers).toEqual([]);
    for (const finding of asFindings(record.findings)) {
      expect(Object.hasOwn(finding, "blocker")).toBe(false);
    }
  });

  it("never stands B6 on a URL or a glob that only looks like a path", async () => {
    const cwd = await getTempDir();
    await writeRoutingArtifacts(cwd);
    await writeRepoFile(
      cwd,
      "README.md",
      [
        "# Scratch",
        "",
        "The required check is documented at `https://example.com/ci/gate.yml`.",
        "Linting is enforced across `src/**/*.ts` on every push.",
        "",
      ].join("\n")
    );

    const record = await assessContextRoutingDimension(cwd);

    expect(assessReadiness([record]).blockers).toEqual([]);
    for (const finding of asFindings(record.findings)) {
      expect(Object.hasOwn(finding, "blocker")).toBe(false);
    }
  });
});

describe("assessContextRoutingDimension — unassessable repositories", () => {
  it("SKIPs with a stated reason when there is nothing written down to read", async () => {
    const cwd = await getTempDir();

    const record = await assessContextRoutingDimension(cwd);

    expect(record.status).toBe(SKIP);
    const findings = asFindings(record.findings);
    expect(findings[0].skip).toBe(true);
    expect(typeof findings[0].reason).toBe("string");
    expect(findings[0].reason).not.toBe("");
    expect(Object.hasOwn(findings[0], "blocker")).toBe(false);
    expect(assessReadiness([record]).blockers).toEqual([]);
  });

  it("SKIPs with a stated reason naming the routing artifacts that are missing", async () => {
    const cwd = await getTempDir();
    await writeRepoFile(cwd, "AGENTS.md", AGENTS_MD);

    const record = await assessContextRoutingDimension(cwd);

    expect(record.status).toBe(SKIP);
    const findings = asFindings(record.findings);
    expect(findings[0].reason).toContain(WIKI_INDEX);
    expect(findings[0].reason).toContain(".lisa.config.json");
    expect(Object.hasOwn(findings[0], "blocker")).toBe(false);
  });

  it("still WARNs on an overstatement even when the routing artifacts are incomplete", async () => {
    const cwd = await getTempDir();
    await writeRepoFile(
      cwd,
      "README.md",
      "# Scratch\n\nEvery push is blocked by `.github/workflows/absent.yml`.\n"
    );

    const record = await assessContextRoutingDimension(cwd);

    expect(record.status).toBe(WARN);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain(".github/workflows/absent.yml");
  });
});

describe("context-routing dimension identity", () => {
  it("owns the context-routing dimension id from the readiness rubric", () => {
    expect(CONTEXT_ROUTING_DIMENSION_ID).toBe("context-routing");
  });
});

/**
 * False-positive regression coverage for the context-routing readiness producer
 * (B6, PRD #1739, #1896).
 *
 * A standing B6 blocker flips the whole repository to `NOT_READY` — the blocker
 * engine reads a finding's id and evidence and never reads its `WARN` status —
 * so precision is the only thing standing between this producer and telling a
 * healthy project that its documentation lies. This suite pins the token shapes
 * that must NEVER be read as a missing mechanism: scoped package names,
 * `org/repo` slugs, git refs, generated artifacts, globs, URLs, fenced samples,
 * and hedged sentences.
 * @module tests/unit/cli/doctor-readiness-context-precision
 */
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { assessContextRoutingDimension } from "../../../src/cli/doctor-readiness-context.js";
import { assessReadiness } from "../../../src/cli/doctor-readiness-blockers.js";
import {
  asFindings,
  makeScratchRepo,
  PASS,
  WARN,
  writeRepoFile,
  writeRepoJson,
} from "../../helpers/readiness-workflow-fixtures.js";

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

  it("never stands B6 on a package name, an org/repo slug, or a git ref", async () => {
    const cwd = await getTempDir();
    await writeRoutingArtifacts(cwd);
    await writeRepoFile(
      cwd,
      "README.md",
      [
        "# Scratch",
        "",
        "Linting is enforced by `@codyswann/lisa` in every consumer project.",
        "The required check is defined in `CodySwannGT/lisa`.",
        "Merges to `origin/main` are blocked by branch protection.",
        "",
      ].join("\n")
    );

    const record = await assessContextRoutingDimension(cwd);

    // A scoped package, an `org/repo` slug, and a git ref are not repository
    // paths — reading them as missing mechanisms invents an overstatement.
    expect(assessReadiness([record]).blockers).toEqual([]);
    for (const finding of asFindings(record.findings)) {
      expect(Object.hasOwn(finding, "blocker")).toBe(false);
    }
  });

  it("never stands B6 on a gitignored build artifact", async () => {
    const cwd = await getTempDir();
    await writeRoutingArtifacts(cwd);
    await writeRepoFile(cwd, ".gitignore", "node_modules\ndist\ncoverage\n");
    await writeRepoFile(
      cwd,
      "README.md",
      "# Scratch\n\nThe published CLI at `dist/cli.js` is required for the check to run.\n"
    );

    const record = await assessContextRoutingDimension(cwd);

    // A generated path is absent from a clean checkout by design; calling that
    // a documentation overstatement would fault every repository that builds.
    expect(assessReadiness([record]).blockers).toEqual([]);
    for (const finding of asFindings(record.findings)) {
      expect(Object.hasOwn(finding, "blocker")).toBe(false);
    }
  });

  it("never stands B6 on an extensionless path under a directory that does not exist", async () => {
    const cwd = await getTempDir();
    await writeRoutingArtifacts(cwd);
    await writeRepoFile(
      cwd,
      "README.md",
      "# Scratch\n\nEvery release is blocked by `acme/release-gate` until approval.\n"
    );

    const record = await assessContextRoutingDimension(cwd);

    expect(assessReadiness([record]).blockers).toEqual([]);
    for (const finding of asFindings(record.findings)) {
      expect(Object.hasOwn(finding, "blocker")).toBe(false);
    }
  });

  it("still stands B6 on an extensionless path under a directory that does exist", async () => {
    const cwd = await getTempDir();
    await writeRoutingArtifacts(cwd);
    await writeRepoFile(cwd, "scripts/build.sh", "#!/bin/sh\necho build\n");
    await writeRepoFile(
      cwd,
      "README.md",
      "# Scratch\n\nEvery push is blocked by `scripts/release-gate` until it passes.\n"
    );

    const record = await assessContextRoutingDimension(cwd);

    expect(record.status).toBe(WARN);
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain("scripts/release-gate");
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

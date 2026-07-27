/**
 * Go module coverage for the dependencies/supply-chain readiness producer
 * (B5, PRD #1739, #1896).
 * @module tests/unit/cli/doctor-readiness-supply-chain-go
 */
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { assessReadiness } from "../../../src/cli/doctor-readiness-blockers.js";
import { assessDependenciesSupplyChainDimension } from "../../../src/cli/doctor-readiness-supply-chain.js";
import {
  asFindings,
  makeScratchRepo,
  SKIP,
  writeRepoFile,
} from "../../helpers/readiness-workflow-fixtures.js";

/** The ship blocker this producer can stand up. */
const BLOCKER_ID = "B5";

/** The Go module manifest B5 reads when no package.json exists. */
const GO_MOD = "go.mod";

/** The Go module checksum file B5 requires for repeatable downloads. */
const GO_SUM = "go.sum";

/** The update-bot config path used as a Go dependency-audit gate. */
const DEPENDABOT_PATH = ".github/dependabot.yml";

/** Minimal Go module with one pinned requirement. */
const CONSTRAINED_GO_MOD = [
  "module example.com/scratch",
  "",
  "go 1.23",
  "",
  "require github.com/stretchr/testify v1.10.0",
  "",
].join("\n");

/** Minimal go.sum body used by fixture repositories. */
const MINIMAL_GO_SUM =
  "github.com/stretchr/testify v1.10.0 h1:examplechecksum\n";

/** A dependabot config that watches Go modules. */
const GO_DEPENDABOT_YML = [
  "version: 2",
  "updates:",
  "  - package-ecosystem: gomod",
  '    directory: "/"',
  "    schedule:",
  "      interval: weekly",
  "",
].join("\n");

let tempDir: string | undefined;

/**
 * Resolve a scratch repository for one test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await makeScratchRepo("supply-chain-go");
  return tempDir;
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("assessDependenciesSupplyChainDimension — Go module repositories", () => {
  it("FAILs with B5 instead of SKIP when go.mod lacks Go confidence evidence", async () => {
    const cwd = await getTempDir();
    await writeRepoFile(
      cwd,
      GO_MOD,
      [
        "module example.com/scratch",
        "",
        "go 1.23",
        "",
        "require (",
        "  github.com/stretchr/testify latest",
        "  golang.org/x/crypto v0.31.0 // indirect",
        ")",
        "",
      ].join("\n")
    );

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe("FAIL");
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain(GO_SUM);
    expect(finding?.evidence).toContain("Go dependency-audit gate");
    expect(finding?.evidence).toContain("github.com/stretchr/testify");
    expect(assessReadiness([record]).blockers[0].id).toBe(BLOCKER_ID);
  });

  it("PASSes a locked and audited Go module with pinned requirements", async () => {
    const cwd = await getTempDir();
    await writeRepoFile(cwd, GO_MOD, CONSTRAINED_GO_MOD);
    await writeRepoFile(cwd, GO_SUM, MINIMAL_GO_SUM);
    await writeRepoFile(cwd, DEPENDABOT_PATH, GO_DEPENDABOT_YML);

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe("PASS");
    expect(assessReadiness([record]).blockers).toEqual([]);
    const findings = asFindings(record.findings);
    expect(findings[0].evidence).toContain(GO_MOD);
    expect(findings[0].evidence).toContain(GO_SUM);
    for (const finding of findings) {
      expect(Object.hasOwn(finding, "blocker")).toBe(false);
    }
  });

  it("SKIPs with an explicit reason when go.mod declares no requirements", async () => {
    const cwd = await getTempDir();
    await writeRepoFile(cwd, GO_MOD, "module example.com/scratch\n\ngo 1.23\n");

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe(SKIP);
    const findings = asFindings(record.findings);
    expect(findings[0].reason).toContain("declares no module requirements");
    expect(assessReadiness([record]).blockers).toEqual([]);
  });

  it("does not accept commented Go audit mentions as audit gates", async () => {
    const cwd = await getTempDir();
    await writeRepoFile(cwd, GO_MOD, CONSTRAINED_GO_MOD);
    await writeRepoFile(cwd, GO_SUM, MINIMAL_GO_SUM);
    await writeRepoFile(
      cwd,
      ".github/workflows/quality.yml",
      "jobs:\n  audit:\n    steps:\n      # - run: govulncheck ./...\n"
    );

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe("FAIL");
    const finding = asFindings(record.findings).find(
      candidate => candidate.blocker === BLOCKER_ID
    );
    expect(finding?.evidence).toContain("Go dependency-audit gate");
  });

  it("accepts govulncheck commands as Go audit gates", async () => {
    const cwd = await getTempDir();
    await writeRepoFile(cwd, GO_MOD, CONSTRAINED_GO_MOD);
    await writeRepoFile(cwd, GO_SUM, MINIMAL_GO_SUM);
    await writeRepoFile(
      cwd,
      ".github/workflows/quality.yml",
      "jobs:\n  audit:\n    steps:\n      - run: govulncheck ./...\n"
    );

    const record = await assessDependenciesSupplyChainDimension(cwd);

    expect(record.status).toBe("PASS");
    expect(assessReadiness([record]).blockers).toEqual([]);
  });
});

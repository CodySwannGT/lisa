import * as fs from "fs-extra";
import yaml from "js-yaml";
import { execFileSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Derive the repo root from this test file's location so the test is
// portable across worktrees and CI working directories.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RELEASE_YML = path.join(REPO_ROOT, ".github", "workflows", "release.yml");

/** Minimal shape of the parsed release workflow needed by these tests. */
interface ReleaseWorkflow {
  jobs: Record<
    string,
    { steps?: ReadonlyArray<{ name?: string; run?: string }> }
  >;
}

const loadWorkflow = async (): Promise<ReleaseWorkflow> => {
  const contents = await fs.readFile(RELEASE_YML, "utf8");
  return yaml.load(contents) as ReleaseWorkflow;
};

describe("release changelog entry generation", () => {
  let releaseWorkflow: ReleaseWorkflow;

  beforeAll(async () => {
    releaseWorkflow = await loadWorkflow();
  });

  // Host projects call release.yml with release_strategy: 'standard-version'.
  // standard-version rewrites CHANGELOG.md but never wrote CHANGELOG_ENTRY.md,
  // so every host release shipped with an empty "## 📝 Changelog" section.
  it("writes CHANGELOG_ENTRY.md in the standard-version branch", () => {
    const steps = releaseWorkflow.jobs.version.steps ?? [];
    const changelog = steps.find(s => s.name === "Generate Changelog");
    const run = changelog?.run ?? "";

    const standardVersionBranch = run.slice(
      run.indexOf("npx standard-version"),
      run.indexOf("else")
    );
    expect(standardVersionBranch).toContain("> CHANGELOG_ENTRY.md");
  });

  it("falls back to a CHANGELOG.md link when the entry is missing or empty", () => {
    const steps = releaseWorkflow.jobs.github_release.steps ?? [];
    const notes = steps.find(s => s.name === "Generate Release Notes");
    const run = notes?.run ?? "";

    // -s (non-empty), not -f (exists): an empty extraction must also fall back.
    expect(run).toContain('if [ -s "version-artifacts-');
    expect(run).toContain("See [CHANGELOG.md]");
  });
});

describe("changelog entry extraction (awk)", () => {
  let awkProgram: string;
  let fixturePath: string;

  const CHANGELOG = [
    "# Changelog",
    "",
    "### [2.204.4](https://github.com/o/r/compare/v2.204.3...v2.204.4) (2026-07-13)",
    "",
    "### Bug Fixes",
    "",
    "* **eslint:** enforce jsdoc rules ([881147d](https://github.com/o/r/commit/881147d))",
    "",
    "## [2.204.0](https://github.com/o/r/compare/v2.203.0...v2.204.0) (2026-07-12)",
    "",
    "### Features",
    "",
    "* **nestjs:** add optional deploy env ([a468e4e](https://github.com/o/r/commit/a468e4e))",
    "",
  ].join("\n");

  beforeAll(async () => {
    // Run the exact awk program embedded in the Generate Changelog step, so
    // the test cannot drift from what the workflow actually executes.
    const releaseWorkflow = await loadWorkflow();
    const steps = releaseWorkflow.jobs.version.steps ?? [];
    const run = steps.find(s => s.name === "Generate Changelog")?.run ?? "";
    const match = /awk -v ver="[^"]*" '([\s\S]*?)' CHANGELOG\.md/.exec(run);
    if (!match?.[1]) {
      throw new Error("awk extraction program not found in Generate Changelog");
    }
    awkProgram = match[1];

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "changelog-entry-"));
    fixturePath = path.join(dir, "CHANGELOG.md");
    await fs.writeFile(fixturePath, CHANGELOG);
  });

  // Fixed path so the command can't be hijacked via PATH; present on both
  // macOS and the ubuntu CI runners.
  const AWK = "/usr/bin/awk";

  const extractEntry = (version: string): string =>
    execFileSync(AWK, ["-v", `ver=${version}`, awkProgram, fixturePath], {
      encoding: "utf8",
    });

  // Patch entries use "### [x.y.z]" — the same heading level as the
  // "### Bug Fixes" section inside them, so extraction must key on the
  // version token, not the heading depth.
  it("extracts a patch entry including its ###-level sections", () => {
    const entry = extractEntry("2.204.4");
    expect(entry).toContain("### [2.204.4]");
    expect(entry).toContain("enforce jsdoc rules");
    expect(entry).not.toContain("2.204.0");
  });

  it("extracts a minor entry and stops at the end of the file", () => {
    const entry = extractEntry("2.204.0");
    expect(entry).toContain("## [2.204.0]");
    expect(entry).toContain("add optional deploy env");
    expect(entry).not.toContain("2.204.4");
  });

  it("returns empty when the version heading is absent", () => {
    expect(extractEntry("9.9.9").trim()).toBe("");
  });
});

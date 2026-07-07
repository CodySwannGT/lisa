import * as fs from "fs-extra";
import yaml from "js-yaml";
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

describe("release notes shell expansion", () => {
  let releaseWorkflow: ReleaseWorkflow;

  beforeAll(async () => {
    const contents = await fs.readFile(RELEASE_YML, "utf8");
    releaseWorkflow = yaml.load(contents) as ReleaseWorkflow;
  });

  // Quoted heredoc delimiters ('EOF') suppress command substitution, which
  // shipped the literal text $(date ...) into published release notes.
  it("expands $(date) in release notes via an unquoted heredoc", () => {
    const steps = releaseWorkflow.jobs.github_release.steps ?? [];
    const notes = steps.find(s => s.name === "Generate Release Notes");

    expect(notes?.run).toContain("cat > RELEASE_NOTES.md << EOF");
    expect(notes?.run).toContain('$(date -u +"%Y-%m-%d %H:%M:%S UTC")');
  });

  it("expands the duration arithmetic in the final release summary", () => {
    const steps = releaseWorkflow.jobs.release_summary.steps ?? [];
    const summary = steps.find(s => s.name === "Generate Final Summary");

    expect(summary?.run).toContain("cat >> $GITHUB_STEP_SUMMARY << EOF");
  });
});

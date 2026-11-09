import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";
import { GIT_BIN } from "../../support/git-executable.js";

/**
 * The Jira evidence script uploads to the configured evidence release.
 *
 * `post-evidence.sh` hardcoded `RELEASE_TAG="pr-assets"`, a release GitHub caps
 * at 1000 assets; once it filled, every evidence upload failed with a raw HTTP
 * 422 (CodySwannGT/lisa#4692). The script now asks the one resolver,
 * `scripts/lisa-work-item.mjs evidence-release --ensure`, so it follows a
 * project's rotation and fails in plain words when that release is full. A
 * host that predates the subcommand (no script) keeps the legacy release.
 * @module tests/unit/scripts/jira-evidence-release
 */

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const SAFE_COMMAND_PATH = `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin`;
const ROTATED = "pr-assets-2026-11";
const SCRIPT_COPIES = [
  "plugins/src/base/skills/lisa-jira-evidence/scripts/post-evidence.sh",
  "plugins/src/expo/skills/jira-evidence/scripts/post-evidence.sh",
  "plugins/src/rails/skills/jira-evidence/scripts/post-evidence.sh",
] as const;

describe("post-evidence.sh uploads to the configured evidence release", () => {
  let tempDir: string;
  let projectDir: string;
  let ghLog: string;
  let cliLog: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    projectDir = path.join(tempDir, "project");
    ghLog = path.join(tempDir, "gh-args.txt");
    cliLog = path.join(tempDir, "cli-args.txt");
    await fs.ensureDir(path.join(projectDir, "evidence"));
    boundedSpawnSync({
      args: ["init", "--quiet", projectDir],
      command: GIT_BIN,
      env: { HOME: tempDir, PATH: SAFE_COMMAND_PATH },
      label: "git repository setup",
    });
    await fs.outputFile(
      path.join(projectDir, ".lisa", "jira-cli", ".config.yml"),
      "installation: cloud\nserver: https://jira.invalid\nlogin: a@example.com\n"
    );
    await fs.outputFile(path.join(projectDir, "evidence", "01-log.txt"), "y");
    // post-evidence.sh checks comment.md exists before uploading anything,
    // because it verifies the description's links against the uploads
    // (CodySwannGT/lisa#4639).
    await fs.outputFile(
      path.join(projectDir, "evidence", "comment.md"),
      "## Evidence\n"
    );
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it.each(SCRIPT_COPIES)(
    "%s uploads to the tag the CLI resolves",
    async copy => {
      await writeCli(`console.log(${JSON.stringify(ROTATED)});`);

      const result = await run(copy);

      expect(await fs.readFile(cliLog, "utf8")).toBe(
        "evidence-release --ensure\n"
      );
      expect(await fs.readFile(ghLog, "utf8")).toContain(
        `release upload ${ROTATED} `
      );
      expect(result.stdout).toContain(`GitHub release '${ROTATED}'`);
    }
  );

  it("keeps the legacy release on a host without the resolver", async () => {
    await run(SCRIPT_COPIES[0]);

    expect(await fs.readFile(ghLog, "utf8")).toContain(
      "release upload pr-assets "
    );
  });

  it("stops before uploading when the resolver refuses", async () => {
    await writeCli(
      'console.error("The evidence release `pr-assets` holds 990 of GitHub\'s 1000-file limit"); process.exit(1);'
    );

    const result = await run(SCRIPT_COPIES[0]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("1000-file limit");
    expect(result.stderr).toContain("evidence release");
    expect(
      (await fs.pathExists(ghLog)) ? await fs.readFile(ghLog, "utf8") : ""
    ).not.toContain("release upload");
  });

  it.each(SCRIPT_COPIES)(
    "%s uploads to LISA_EVIDENCE_RELEASE on a host without the resolver",
    async copy => {
      await run(copy, { LISA_EVIDENCE_RELEASE: ROTATED });

      expect(await fs.readFile(ghLog, "utf8")).toContain(
        `release upload ${ROTATED} `
      );
    }
  );

  it("hands LISA_EVIDENCE_RELEASE to the resolver so it is still validated and capacity-checked", async () => {
    await writeCli(
      `appendFileSync(${JSON.stringify(cliLog)}, "env=" + process.env.LISA_EVIDENCE_RELEASE + "\\n"); console.log(process.env.LISA_EVIDENCE_RELEASE);`
    );

    await run(SCRIPT_COPIES[0], { LISA_EVIDENCE_RELEASE: "pr-assets-2026-10" });

    expect(await fs.readFile(cliLog, "utf8")).toContain(
      "env=pr-assets-2026-10"
    );
    expect(await fs.readFile(ghLog, "utf8")).toContain(
      "release upload pr-assets-2026-10 "
    );
  });

  it("keeps every source copy byte-identical", async () => {
    const [first, ...rest] = await Promise.all(
      SCRIPT_COPIES.map(copy => fs.readFile(path.join(repoRoot, copy), "utf8"))
    );
    for (const text of rest) expect(text).toBe(first);
  });

  /**
   * Install a stand-in `scripts/lisa-work-item.mjs` that records its argv.
   * @param body - JavaScript run after the argv is recorded.
   */
  async function writeCli(body: string): Promise<void> {
    await fs.outputFile(
      path.join(projectDir, "scripts", "lisa-work-item.mjs"),
      `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(cliLog)}, process.argv.slice(2).join(" ") + "\\n");\n${body}\n`
    );
  }

  /**
   * Run one copy of post-evidence.sh with an offline `gh` that logs its argv.
   * @param copy - Repository-relative script path.
   * @param extra - Additional environment for the script.
   * @returns The completed spawn result.
   */
  async function run(copy: string, extra: Record<string, string> = {}) {
    const stubDir = path.join(tempDir, "stub-bin");
    await fs.outputFile(
      path.join(stubDir, "gh"),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(ghLog)}\nprintf 'owner/repo'\nexit 0\n`
    );
    await fs.chmod(path.join(stubDir, "gh"), 0o755);
    const result = boundedSpawnSync({
      args: [
        path.join(repoRoot, copy),
        "ABC-1",
        path.join(projectDir, "evidence"),
        "42",
      ],
      command: "/bin/bash",
      cwd: projectDir,
      env: {
        HOME: tempDir,
        JIRA_API_TOKEN: "tok",
        PATH: `${stubDir}:${SAFE_COMMAND_PATH}`,
        ...extra,
      },
      label: "post-evidence.sh under test",
    });
    return {
      status: result.status,
      stderr: result.stderr ?? "",
      stdout: result.stdout ?? "",
    };
  }
});

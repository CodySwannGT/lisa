/**
 * `lisa-work-item.mjs evidence-release`, driven in-process through `runCli`.
 *
 * The spawned-CLI suite (`work-item-proof-evidence-release.test.ts`) proves the
 * behaviour end to end, but a child process is invisible to in-process
 * coverage, so the mutation gate scored the subcommand as untested. These cases
 * run the same dispatch, print path, `--ensure` path, missing-repository
 * refusal and `LISA_EVIDENCE_RELEASE` pin inside the test process. Only `gh`
 * is a child, and it is a local stand-in that records what it was asked
 * (CodySwannGT/lisa#4692).
 * @module tests/unit/scripts/work-item-evidence-release-cli
 */
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runCli } from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";

const COMMAND = "evidence-release";
const ENSURE = "--ensure";
const PINNED = "legacy-evidence";
const REPOSITORY = "acme/code";

let root: string;
let ghLog: string;
let logged: string[];
let errors: string[];

/**
 * Write the config the CLI reads through `LISA_TRACKING_CONFIG_FILE`.
 * @param config - The whole `.lisa.config.json` value.
 */
function writeConfig(config: unknown): void {
  writeFileSync(path.join(root, "config.json"), JSON.stringify(config));
}

/**
 * Run the CLI in-process and collect what it printed.
 * @param args - Arguments after the script name.
 * @returns Printed stdout and stderr lines, and the exit code it set.
 */
function cli(args: string[]) {
  logged = [];
  errors = [];
  vi.spyOn(process, "argv", "get").mockReturnValue([
    process.execPath,
    "lisa-work-item.mjs",
    ...args,
  ]);
  runCli();
  const exitCode = process.exitCode;
  process.exitCode = undefined;
  return {
    stdout: logged.join("\n"),
    stderr: errors.join("\n"),
    exitCode,
  };
}

/** Every `gh` invocation the stand-in recorded, one argument string each. */
const ghCalls = (): string =>
  (() => {
    try {
      return readFileSync(ghLog, "utf8");
    } catch {
      return "";
    }
  })();

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "lisa-evidence-release-cli-"));
  ghLog = path.join(root, "gh.log");
  const gh = path.join(root, "gh");
  // Answers a release lookup for any tag with release 19, an empty asset
  // list, and refuses `repo view` so a missing repository stays missing.
  writeFileSync(
    gh,
    `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(ghLog)}, args.join(" ") + "\\n");
const endpoint = args.find(value => value.startsWith("repos/")) ?? "";
if (args[0] === "api" && /\\/releases\\/tags\\//.test(endpoint)) {
  console.log(JSON.stringify({ id: 19 }));
} else if (args[0] === "api" && endpoint.endsWith("/releases/19/assets?per_page=100")) {
  console.log(JSON.stringify([[]]));
} else {
  process.stderr.write("unsupported\\n");
  process.exit(1);
}
`
  );
  chmodSync(gh, 0o755);
  vi.stubEnv("PATH", `${root}:${process.env.PATH ?? ""}`);
  vi.stubEnv("LISA_TRACKING_CONFIG_FILE", path.join(root, "config.json"));
  vi.stubEnv("LISA_EVIDENCE_RELEASE", undefined);
  vi.stubEnv("GITHUB_REPOSITORY", REPOSITORY);
  vi.spyOn(console, "log").mockImplementation((...values: unknown[]) => {
    logged.push(values.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...values: unknown[]) => {
    errors.push(values.join(" "));
  });
  writeConfig({ verification: { completion: {} } });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  rmSync(root, { recursive: true, force: true });
});

describe("evidence-release in-process", () => {
  it("prints the legacy default without asking GitHub", () => {
    const result = cli([COMMAND]);
    expect(result.stdout).toBe("pr-assets");
    expect(result.exitCode).toBeUndefined();
    expect(ghCalls()).toBe("");
  });

  it("prints the default when the config has no verification section", () => {
    writeConfig({});
    expect(cli([COMMAND]).stdout).toBe("pr-assets");
  });

  it("prints the configured rotating release, not the default", () => {
    writeConfig({
      verification: { completion: { evidenceRelease: "evidence-{YYYY-MM}" } },
    });
    expect(cli([COMMAND]).stdout).toMatch(/^evidence-\d{4}-(?:0[1-9]|1[0-2])$/);
  });

  it("honours a padded LISA_EVIDENCE_RELEASE pin", () => {
    writeConfig({
      verification: { completion: { acceptedEvidenceReleases: [PINNED] } },
    });
    vi.stubEnv("LISA_EVIDENCE_RELEASE", `  ${PINNED}  `);
    const result = cli([COMMAND]);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(PINNED);
  });

  it("--ensure reads the release and its assets before printing it", () => {
    const result = cli([COMMAND, ENSURE]);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("pr-assets");
    expect(ghCalls()).toContain(
      `api repos/${REPOSITORY}/releases/tags/pr-assets`
    );
    expect(ghCalls()).toContain(`releases/19/assets?per_page=100`);
  });

  it("--ensure checks the pinned release, not the configured one", () => {
    writeConfig({
      verification: {
        completion: {
          evidenceRelease: "pr-assets-{YYYY-MM}",
          acceptedEvidenceReleases: [PINNED],
        },
      },
    });
    vi.stubEnv("LISA_EVIDENCE_RELEASE", PINNED);
    const result = cli([COMMAND, ENSURE]);
    expect(result.stdout).toBe(PINNED);
    expect(ghCalls()).toContain(`releases/tags/${PINNED}`);
    expect(ghCalls()).not.toContain("releases/tags/pr-assets");
  });

  it("--ensure refuses a malformed acceptedEvidenceReleases before any gh call (#4838)", () => {
    writeConfig({
      verification: {
        completion: { acceptedEvidenceReleases: "pr-assets-old" },
      },
    });
    const result = cli([COMMAND, ENSURE]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("acceptedEvidenceReleases");
    expect(ghCalls()).toBe("");
  });

  it("--ensure refuses plainly when the repository cannot be found", () => {
    vi.stubEnv("GITHUB_REPOSITORY", "");
    const result = cli([COMMAND, ENSURE]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "evidence-release --ensure needs the GitHub repository; run it inside a checkout with a GitHub remote, or set GITHUB_REPOSITORY."
    );
    expect(ghCalls()).not.toContain("releases/tags");
  });

  it("names the subcommand in the usage refusal", () => {
    const result = cli(["no-such-command"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("|evidence-release [--ensure]|");
  });
});

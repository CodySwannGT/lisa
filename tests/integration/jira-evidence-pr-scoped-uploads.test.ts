/**
 * Two pull requests' Jira evidence must both survive in the shared release.
 *
 * `post-evidence.sh` uploads into the one `pr-assets` release every pull
 * request shares. It used to upload each file under its bare name with
 * `--clobber`, so PR 102's `01-search-step-desktop.png` deleted PR 101's, and
 * PR 101's description silently showed PR 102's screenshot
 * (CodySwannGT/lisa#4639). These cases run the three source scripts, unmodified,
 * against a `gh` stub that keeps a real release directory, and assert the
 * names, the contents, and the refusals the fix promises.
 * @module tests/integration/jira-evidence-pr-scoped-uploads
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import {
  recordedUploads,
  releaseAsset,
  releaseAssets,
  writeRecordingGh,
} from "./support/recording-gh-stub.js";
import {
  BASH,
  REPO_ROOT,
  SYSTEM_PATH,
  writeStub,
} from "./support/shell-guard-refusal-fixture.js";

const SOURCES = [
  "plugins/src/base/skills/lisa-jira-evidence/scripts/post-evidence.sh",
  "plugins/src/expo/skills/jira-evidence/scripts/post-evidence.sh",
  "plugins/src/rails/skills/jira-evidence/scripts/post-evidence.sh",
];
const SHOT = "01-search-step-desktop.png";
const HEALTH = "01-health-check.json";
const RELEASE = "https://github.com/org/repo/releases/download/pr-assets";
const DESCRIPTION_UPDATED = "PR description updated";
const roots: string[] = [];

/** Controls for one {@link runFor} invocation. */
interface RunOptions {
  readonly tag?: string;
  readonly drop?: string;
  readonly files?: readonly string[];
  readonly commentMd?: string;
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/**
 * A project with a Jira config, service stubs, and one shared release.
 * @returns Paths for the project, stub PATH entry, and release state.
 */
function prepareRepository() {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-jira-scoped-"));
  const bin = path.join(root, "bin");
  const state = path.join(root, "gh-state");
  roots.push(root);
  mkdirSync(path.join(root, ".lisa", "jira-cli"), { recursive: true });
  writeFileSync(
    path.join(root, ".lisa", "jira-cli", ".config.yml"),
    "server: https://jira.invalid\nlogin: operator@jira.invalid\n"
  );
  writeRecordingGh(bin, state);
  writeStub(bin, "curl", 'printf "{}\\nHTTP_CODE:201"\nexit 0\n');
  writeStub(bin, "jira", "exit 0\n");
  return { root, bin, state };
}

/**
 * Run one source script for one pull request with its own evidence directory.
 * @param repo - The repository from {@link prepareRepository}.
 * @param script - Source script path relative to the checkout.
 * @param pr - Pull request number argument, passed verbatim.
 * @param options - Run controls.
 * @param options.tag - Text written into each evidence file, to tell runs apart.
 * @param options.drop - Asset name the stubbed release silently loses.
 * @param options.files - Evidence file names to stage instead of the default pair.
 * @param options.commentMd - Description markdown instead of the default text.
 * @returns The completed process.
 */
function runFor(
  repo: ReturnType<typeof prepareRepository>,
  script: string,
  pr: string,
  options: RunOptions = {}
) {
  const evidence = path.join(repo.root, `evidence-${pr}-${options.tag ?? ""}`);
  const files = options.files ?? [SHOT, HEALTH];
  mkdirSync(evidence, { recursive: true });
  for (const name of [...files, "comment.md", "comment.txt"])
    writeFileSync(path.join(evidence, name), `${options.tag ?? pr}\n`);
  if (options.commentMd !== undefined)
    writeFileSync(path.join(evidence, "comment.md"), options.commentMd);
  return boundedSpawnSync({
    label: `post-evidence.sh for PR ${pr}`,
    command: BASH,
    args: [path.join(REPO_ROOT, script), "TEST-1", evidence, pr],
    cwd: repo.root,
    env: {
      HOME: repo.root,
      CLAUDE_PROJECT_DIR: repo.root,
      PATH: `${repo.bin}:${SYSTEM_PATH}`,
      JIRA_API_TOKEN: "fixture-token",
      LISA_GH_STATE: repo.state,
      LISA_GH_DROP: options.drop ?? "",
    },
  });
}

describe.each(SOURCES)("pull-request-scoped evidence uploads: %s", script => {
  it("keeps both pull requests' same-named evidence", () => {
    const repo = prepareRepository();

    expect(runFor(repo, script, "101").status).toBe(0);
    expect(runFor(repo, script, "102").status).toBe(0);

    expect(releaseAssets(repo.state)).toEqual([
      `pr-101-${HEALTH}`,
      `pr-101-${SHOT}`,
      `pr-102-${HEALTH}`,
      `pr-102-${SHOT}`,
    ]);
    expect(releaseAsset(repo.state, `pr-101-${SHOT}`)).toBe("101\n");
    expect(releaseAsset(repo.state, `pr-102-${SHOT}`)).toBe("102\n");
  });

  it("records only pull-request-scoped upload names", () => {
    const repo = prepareRepository();
    runFor(repo, script, "101");
    runFor(repo, script, "102");

    const uploads = recordedUploads(repo.state);
    expect(uploads).toHaveLength(4);
    for (const line of uploads) {
      expect(line).toMatch(/\/pr-10[12]-01-[a-z-]+\.(png|json) /);
      expect(line).not.toMatch(new RegExp(`/(${SHOT}|${HEALTH}) `));
    }
  });

  it("replaces only its own pull request's evidence on a re-run", () => {
    const repo = prepareRepository();
    runFor(repo, script, "101");
    runFor(repo, script, "102");

    expect(runFor(repo, script, "101", { tag: "rerun" }).status).toBe(0);

    expect(releaseAsset(repo.state, `pr-101-${SHOT}`)).toBe("rerun\n");
    expect(releaseAsset(repo.state, `pr-102-${SHOT}`)).toBe("102\n");
    expect(releaseAssets(repo.state)).toHaveLength(4);
  });

  it.each(["0", "-1", "abc", "1.5", "", "01"])(
    "refuses pull request number %j before any upload",
    pr => {
      const repo = prepareRepository();
      const result = runFor(repo, script, pr);

      expect(result.status).not.toBe(0);
      expect(recordedUploads(repo.state)).toEqual([]);
    }
  );

  it("fails naming an asset missing from the release after upload", () => {
    const repo = prepareRepository();
    const missing = `pr-101-${SHOT}`;
    const result = runFor(repo, script, "101", { drop: missing });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(missing);
    expect(result.stdout).not.toContain(DESCRIPTION_UPDATED);
  });

  it("refuses an evidence name GitHub would rewrite, before any upload", () => {
    const repo = prepareRepository();
    const result = runFor(repo, script, "101", {
      files: ["01-search step-desktop.png", HEALTH],
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("01-search step-desktop.png");
    expect(result.stderr).toContain("Rename it");
    expect(recordedUploads(repo.state)).toEqual([]);
  });
});

describe.each(SOURCES)("description links match the release: %s", script => {
  it.each([
    ["a bare name", `${RELEASE}/${SHOT}`],
    ["another pull request's name", `${RELEASE}/pr-102-${SHOT}`],
  ])("fails naming a description link to %s", (_kind, link) => {
    const repo = prepareRepository();
    const result = runFor(repo, script, "101", {
      commentMd: `## Evidence\n\n![Shot](${link})\n`,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(link.slice(link.indexOf("releases/")));
    expect(result.stdout).not.toContain(DESCRIPTION_UPDATED);
  });

  it("accepts a description linking only this pull request's assets", () => {
    const repo = prepareRepository();
    const result = runFor(repo, script, "101", {
      commentMd: `## Evidence\n\n![Shot](${RELEASE}/pr-101-${SHOT})\n`,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(DESCRIPTION_UPDATED);
  });

  it("fails naming a link to a stale asset an earlier run left behind", () => {
    const repo = prepareRepository();
    const stale = `${RELEASE}/pr-101-${SHOT}`;
    expect(runFor(repo, script, "101").status).toBe(0);

    const result = runFor(repo, script, "101", {
      tag: "rerun",
      files: [HEALTH],
      commentMd: `## Evidence\n\n![Shot](${stale})\n`,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(stale);
    expect(result.stderr).toContain("did not upload");
    expect(result.stdout).not.toContain(DESCRIPTION_UPDATED);
  });

  it("ignores a release URL quoted as plain text in inlined evidence", () => {
    const repo = prepareRepository();
    const result = runFor(repo, script, "101", {
      commentMd: [
        "## Evidence",
        "",
        "```text",
        "fetched releases/download/pr-assets/foo.txt",
        "```",
        "",
      ].join("\n"),
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(DESCRIPTION_UPDATED);
  });
});

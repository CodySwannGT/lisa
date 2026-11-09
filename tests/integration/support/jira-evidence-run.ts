/**
 * Runs the real Jira `post-evidence.sh` against stubbed services and one
 * shared, recorded `pr-assets` release (CodySwannGT/lisa#4639).
 *
 * Shared by the upload-scoping and description-link suites so both drive the
 * scripts identically. Callers register {@link cleanupRuns} in `afterEach`.
 * @module tests/integration/support/jira-evidence-run
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { writeRecordingGh } from "./recording-gh-stub.js";
import {
  BASH,
  REPO_ROOT,
  SYSTEM_PATH,
  writeStub,
} from "./shell-guard-refusal-fixture.js";

/** The three byte-identical source scripts. */
export const SOURCES = [
  "plugins/src/base/skills/lisa-jira-evidence/scripts/post-evidence.sh",
  "plugins/src/expo/skills/jira-evidence/scripts/post-evidence.sh",
  "plugins/src/rails/skills/jira-evidence/scripts/post-evidence.sh",
];
export const SHOT = "01-search-step-desktop.png";
export const HEALTH = "01-health-check.json";
export const RELEASE =
  "https://github.com/org/repo/releases/download/pr-assets";
export const DESCRIPTION_UPDATED = "PR description updated";

const roots: string[] = [];

/** Controls for one {@link runFor} invocation. */
export interface RunOptions {
  readonly tag?: string;
  readonly drop?: string;
  readonly files?: readonly string[];
  readonly commentMd?: string;
  readonly release?: string;
}

/** Remove every scratch repository created since the last call. */
export function cleanupRuns(): void {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
}

/**
 * A project with a Jira config, service stubs, and one shared release.
 * @returns Paths for the project, stub PATH entry, and release state.
 */
export function prepareRepository() {
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
 * @param options.release - LISA_EVIDENCE_RELEASE for this run (#4692 rotation).
 * @returns The completed process.
 */
export function runFor(
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
      ...(options.release ? { LISA_EVIDENCE_RELEASE: options.release } : {}),
    },
  });
}

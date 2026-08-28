/**
 * Extraction and bounded execution of the shipped latest-review reducer.
 * @module tests/helpers/latest-review-reducer-harness
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { ReviewRecord } from "./latest-review-identity-fixtures.js";

/** Canonical authored merge-driving skill. */
export const SOURCE_REVIEW_SKILL =
  "plugins/src/base/skills/lisa-drive-pr-to-merge/SKILL.md";

/** Closed authored and generated inventory for every supported agent. */
export const REVIEW_SKILL_SURFACES = Object.freeze([
  SOURCE_REVIEW_SKILL,
  "plugins/lisa/skills/lisa-drive-pr-to-merge/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-drive-pr-to-merge/SKILL.md",
  "plugins/lisa-agy/skills/lisa-drive-pr-to-merge/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-drive-pr-to-merge/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-drive-pr-to-merge/SKILL.md",
]);

/** Exact v4.23.26 filter without a stable-identity guard. */
export const LEGACY_REVIEW_FILTER =
  'add | map(select(.state != "DISMISSED")) | ' +
  "sort_by(.submitted_at, .id) | reduce .[] as $review ({}; " +
  ".[$review.user.login] = $review) | [.[]]";

/** Fixed absolute jq candidates used by supported local and CI hosts. */
const JQ_BINARY =
  ["/usr/bin/jq", "/opt/homebrew/bin/jq", "/usr/local/bin/jq"].find(
    existsSync
  ) ?? "/usr/bin/jq";

/** Observable result from one bounded jq reducer execution. */
export interface ReviewReducerRun {
  /** Process signal when jq did not exit normally. */
  readonly signal: NodeJS.Signals | null;
  /** Process exit status. */
  readonly status: number | null;
  /** Standard error from jq. */
  readonly stderr: string;
  /** Standard output from jq. */
  readonly stdout: string;
}

/**
 * Read one repository-relative UTF-8 file.
 * @param relative - Repository-relative path.
 * @returns Complete UTF-8 contents.
 */
export const readRepositoryFile = (relative: string): string =>
  readFileSync(path.resolve(relative), "utf8");

/**
 * Extract the exact paginated review command from one skill body.
 * @param body - Complete drive-pr-to-merge skill Markdown.
 * @returns Command code block beginning with the paginated reviews GET.
 */
export const extractReviewCommand = (body: string): string => {
  const prefix =
    "gh api --paginate repos/<owner>/<repo>/pulls/<pr>/reviews --slurp";
  const start = body.indexOf(prefix);
  if (start < 0) throw new Error("paginated review command not found");
  const end = body.indexOf("\n```", start);
  if (end < 0) throw new Error("paginated review command is not terminated");
  return body.slice(start, end);
};

/**
 * Extract the exact single-quoted jq program from a review command.
 * @param command - Paginated GitHub review command code block.
 * @returns Exact jq reducer program passed to gh.
 */
export const extractReviewFilter = (command: string): string => {
  const match = /--jq '([\s\S]+)'$/u.exec(command.trim());
  if (match?.[1] === undefined) {
    throw new Error("single-quoted latest-review jq filter not found");
  }
  return match[1];
};

/**
 * Execute the exact authored jq reducer against raw input bytes.
 * @param raw - JSON bytes shaped like gh api --paginate --slurp output.
 * @returns Bounded jq status and output streams.
 */
export const runRawReviewReducer = (raw: string): ReviewReducerRun => {
  const command = extractReviewCommand(readRepositoryFile(SOURCE_REVIEW_SKILL));
  const filter = extractReviewFilter(command);
  const child = spawnSync(JQ_BINARY, ["-c", filter], {
    encoding: "utf8",
    env: {
      LANG: "C",
      LC_ALL: "C",
    },
    input: raw,
    maxBuffer: 64 * 1024,
    timeout: 5000,
  });
  return {
    signal: child.signal,
    status: child.status,
    stderr: child.stderr,
    stdout: child.stdout,
  };
};

/**
 * Execute the authored reducer against paginated review records.
 * @param pages - REST pages as presented to gh api --slurp.
 * @returns Bounded jq status and output streams.
 */
export const runReviewReducer = (
  pages: readonly (readonly ReviewRecord[])[]
): ReviewReducerRun => runRawReviewReducer(JSON.stringify(pages));

/**
 * Recursively enumerate regular files below one repository directory.
 * @param root - Repository-relative directory.
 * @returns Sorted regular-file paths, including dot-directories.
 */
export const filesBelow = (root: string): readonly string[] =>
  readdirSync(root, { withFileTypes: true })
    .flatMap(entry => {
      const child = path.join(root, entry.name);
      if (entry.isDirectory()) return filesBelow(child);
      return entry.isFile() ? [child] : [];
    })
    .toSorted((left, right) => left.localeCompare(right));

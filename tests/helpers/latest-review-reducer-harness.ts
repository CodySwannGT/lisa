/**
 * Extraction and bounded execution of the shipped latest-review reducer.
 * @module tests/helpers/latest-review-reducer-harness
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

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

/** Observable result from the complete documented review command. */
export interface DocumentedReviewRun extends ReviewReducerRun {
  /** Exact arguments received by the hermetic GitHub CLI double. */
  readonly ghArguments: readonly string[];
}

/** GitHub CLI double that preserves and validates the documented argv. */
const GH_STUB = `#!/bin/sh
: > "$GH_ARGUMENT_LOG"
has_jq=0
has_slurp=0
for argument do
  printf '%s\\n' "$argument" >> "$GH_ARGUMENT_LOG"
  [ "$argument" = "--jq" ] && has_jq=1
  [ "$argument" = "--slurp" ] && has_slurp=1
done
if [ "$has_jq" -eq 1 ] && [ "$has_slurp" -eq 1 ]; then
  printf '%s\\n' 'the --slurp option is not supported with --jq or --template' >&2
  exit 1
fi
if [ "$GH_REVIEW_STATUS" -ne 0 ]; then
  printf '%s\\n' 'review fetch failed' >&2
  exit "$GH_REVIEW_STATUS"
fi
printf '%s\\n' "$GH_REVIEW_RESPONSE"
`;

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
    '(\n  reviews_json="$(gh api --paginate ' +
    "repos/<owner>/<repo>/pulls/<pr>/reviews --slurp)";
  const start = body.indexOf(prefix);
  if (start < 0) throw new Error("paginated review command not found");
  const end = body.indexOf("\n```", start);
  if (end < 0) throw new Error("paginated review command is not terminated");
  return body.slice(start, end);
};

/**
 * Extract the exact single-quoted jq program from a review command.
 * @param command - Paginated GitHub review command code block.
 * @returns Exact jq reducer program applied after the GitHub fetch.
 */
export const extractReviewFilter = (command: string): string => {
  const match = /jq -c '([^']+)'/u.exec(command);
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
 * Execute the complete documented command against a hermetic GitHub CLI.
 * @param raw - Exact response bytes returned by the GitHub CLI double.
 * @param ghStatus - Exit status returned before emitting response bytes.
 * @returns Bounded command result and exact GitHub CLI arguments.
 */
export const runRawDocumentedReviewCommand = (
  raw: string,
  ghStatus = 0
): DocumentedReviewRun => {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-review-command-"));
  const argumentLog = path.join(root, "gh-arguments");
  const command = extractReviewCommand(readRepositoryFile(SOURCE_REVIEW_SKILL))
    .replaceAll("<owner>", "acme")
    .replaceAll("<repo>", "widgets")
    .replaceAll("<pr>", "42");
  try {
    writeFileSync(path.join(root, "gh"), GH_STUB, { mode: 0o755 });
    const child = spawnSync("/bin/bash", ["-c", command], {
      encoding: "utf8",
      env: {
        GH_ARGUMENT_LOG: argumentLog,
        GH_REVIEW_RESPONSE: raw,
        GH_REVIEW_STATUS: String(ghStatus),
        LANG: "C",
        LC_ALL: "C",
        PATH: [root, path.dirname(JQ_BINARY)].join(path.delimiter),
      },
      maxBuffer: 64 * 1024,
      timeout: 5000,
    });
    return {
      ghArguments: readFileSync(argumentLog, "utf8").trimEnd().split("\n"),
      signal: child.signal,
      status: child.status,
      stderr: child.stderr,
      stdout: child.stdout,
    };
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
};

/**
 * Execute the documented command against paginated review records.
 * @param pages - REST pages returned by the GitHub CLI double.
 * @returns Bounded command result and exact GitHub CLI arguments.
 */
export const runDocumentedReviewCommand = (
  pages: readonly (readonly ReviewRecord[])[]
): DocumentedReviewRun => runRawDocumentedReviewCommand(JSON.stringify(pages));

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

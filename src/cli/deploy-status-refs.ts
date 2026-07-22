/**
 * Work-item ref extraction for deploy-status-sync (DSS-2, AC 1).
 *
 * Given a `base..head` commit range: union the `Work-Item:` trailer values
 * of every commit (parsed by git's own trailer engine via the
 * `%(trailers:key=Work-Item,valueonly)` pretty format) with the `Refs` /
 * `Closes` lines of every merged PR associated with those commits (GitHub
 * associated-PRs endpoint — no search-index lag), canonicalize each token
 * against the configured tracker, and dedupe on the canonical form.
 * Out-of-scope tokens are skipped with a reason, never an error.
 * @module cli/deploy-status-refs
 */
import { runKaneCommand } from "../core/kane-cli-process.js";
import type { Tracker } from "../core/deploy-status-sync.js";
import { getProcessEnv } from "./update-check.js";

/** Injectable git/gh executors used by the extractor. */
export interface RefExtractionDeps {
  /** Run git with fixed argv and return stdout */
  readonly execGit: (
    args: readonly string[],
    options?: { readonly input?: string }
  ) => Promise<string>;
  /** Run gh with fixed argv and return stdout */
  readonly execGh: (args: readonly string[]) => Promise<string>;
}

/** Extraction options. */
export interface ExtractRefsOptions {
  /** Commit range in `base..head` form */
  readonly range: string;
  /** Tracker vendor the tokens canonicalize against */
  readonly tracker: Tracker;
  /** Configured `owner/repo` (binds bare `#N`; enables PR-body lookups) */
  readonly repository?: string;
  /** Jira project key / Linear team key for `KEY-N` canonicalization */
  readonly projectKey?: string;
  /** Repository working directory */
  readonly cwd: string;
}

/** One out-of-scope token, reported instead of raised. */
export interface SkippedRef {
  readonly token: string;
  readonly reason: string;
}

/** Extraction result. */
export interface ExtractedRefs {
  /** Canonical refs, deduped, in first-appearance order */
  readonly refs: readonly string[];
  /** Out-of-scope tokens with reasons */
  readonly skipped: readonly SkippedRef[];
  /** Resolved head SHA of the range */
  readonly headSha: string;
}

const GITHUB_TOKEN_PATTERN =
  /^(?:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+))?#([1-9]\d*)$/;
/** Git revision charset: branch names, SHAs, HEAD^/~ suffixes — nothing that
 * could smuggle shell metacharacters or option-like payloads into argv. */
const REVISION_PATTERN = /^[\w./^~@-]+$/;
/** Maximum concurrent gh lookups during PR-token collection. */
const GH_CONCURRENCY = 8;

/**
 * Split items into consecutive chunks of at most `size` elements. Used to
 * bound gh fan-out: chunks run sequentially, items within a chunk run
 * concurrently.
 * @param items - Items to split
 * @param size - Maximum chunk size (must be positive)
 * @returns Consecutive chunks in input order
 */
export function chunk<T>(
  items: readonly T[],
  size: number
): readonly (readonly T[])[] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size)
  );
}
const KEY_TOKEN_PATTERN = /^([A-Za-z][A-Za-z0-9]{1,9})-([1-9]\d*)$/;
const REF_LINE_PATTERN = /^(?:refs|closes)\b(.*)$/i;

/** Canonicalization outcome for one token. */
interface TokenResult {
  readonly token: string;
  readonly ref?: string;
  readonly reason?: string;
}

/**
 * Build production deps over the shared fixed-argv process runner.
 * @param cwd - Repository working directory
 * @returns Real git/gh executors
 */
export function defaultRefExtractionDeps(cwd: string): RefExtractionDeps {
  const exec = async (
    executable: string,
    args: readonly string[]
  ): Promise<string> => {
    const result = await runKaneCommand(executable, [...args], {
      cwd,
      timeoutMs: 120_000,
      env: getProcessEnv(),
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `${executable} ${args[0] ?? ""} failed (exit ${String(result.exitCode)}): ${result.stderr.trim()}`
      );
    }
    return result.stdout;
  };
  return {
    execGit: args => exec("git", args),
    execGh: args => exec("gh", args),
  };
}

/**
 * Canonicalize one token against the configured tracker scope.
 * @param token - Raw token from a trailer or PR body
 * @param options - Extraction options (tracker, repository, project key)
 * @returns Canonical ref or a skip reason
 */
function canonicalizeToken(
  token: string,
  options: ExtractRefsOptions
): TokenResult {
  if (options.tracker === "github") {
    const match = GITHUB_TOKEN_PATTERN.exec(token);
    if (match === null) {
      return { token, reason: "not a GitHub work-item ref" };
    }
    if (options.repository === undefined) {
      return { token, reason: "no github.org/github.repo configured" };
    }
    const repository = match[1];
    if (
      repository !== undefined &&
      repository.toLowerCase() !== options.repository.toLowerCase()
    ) {
      return {
        token,
        reason: `outside configured repository ${options.repository}`,
      };
    }
    return { token, ref: `${options.repository}#${match[2] ?? ""}` };
  }
  const match = KEY_TOKEN_PATTERN.exec(token);
  if (match === null) {
    return { token, reason: `not a ${options.tracker} work-item ref` };
  }
  const key = (match[1] ?? "").toUpperCase();
  if (key !== (options.projectKey ?? "").toUpperCase()) {
    return {
      token,
      reason: `outside configured ${options.tracker} project ${options.projectKey ?? "(unset)"}`,
    };
  }
  return { token, ref: `${key}-${match[2] ?? ""}` };
}

/**
 * Collect Refs/Closes tokens from merged PRs associated with the commits.
 * @param shas - Commit SHAs of the range
 * @param repository - Configured `owner/repo`
 * @param deps - Injectable executors
 * @returns Raw tokens in appearance order
 */
async function collectPrTokens(
  shas: readonly string[],
  repository: string,
  deps: RefExtractionDeps
): Promise<readonly string[]> {
  // Chunked fan-out: a large range must not open one gh process (and one
  // API request) per SHA simultaneously.
  const payloads = await chunk(shas, GH_CONCURRENCY).reduce(
    async (accumulated: Promise<readonly string[]>, group) => {
      const previous = await accumulated;
      const results = await Promise.all(
        group.map(sha =>
          deps.execGh(["api", `repos/${repository}/commits/${sha}/pulls`])
        )
      );
      return [...previous, ...results];
    },
    Promise.resolve([] as readonly string[])
  );
  const pulls = payloads.flatMap(raw => {
    const parsed = JSON.parse(raw.length > 0 ? raw : "[]") as unknown;
    return Array.isArray(parsed)
      ? (parsed as readonly {
          number?: number;
          merged_at?: string | null;
          body?: string | null;
        }[])
      : [];
  });
  const merged = pulls.filter(
    pull => pull.merged_at !== null && pull.merged_at !== undefined
  );
  const unique = [...new Map(merged.map(pull => [pull.number, pull])).values()];
  return unique.flatMap(pull => prBodyTokens(pull.body ?? ""));
}

/** Loose candidate shapes: contains a "#" or looks like KEY-N. A candidate
 * that later fails canonicalization is reported in `skipped`, never dropped
 * silently; plain prose words are not candidates. */
const CANDIDATE_PATTERN = /#|^[A-Za-z][A-Za-z0-9]*-\d/;

/** Punctuation stripped from the end of candidate tokens. */
const TRAILING_PUNCTUATION = new Set([".", ",", ";", ":", ")"]);

/**
 * Strip trailing punctuation from a word in linear time (a quantified
 * end-anchored regex would be flagged as super-linear).
 * @param word - Raw word
 * @returns The word without its trailing punctuation run
 */
function stripTrailingPunctuation(word: string): string {
  const characters = [...word];
  const cutoff = characters.reduce(
    (keep, character, index) =>
      TRAILING_PUNCTUATION.has(character) ? keep : index + 1,
    0
  );
  return word.slice(0, cutoff);
}

/**
 * Collect candidate tokens from one PR body: Refs/Closes lines outside
 * fenced code regions (triple-backtick blocks), with trailing punctuation
 * stripped from each word so `Closes #102.` names #102.
 * @param body - Raw PR body markdown
 * @returns Candidate tokens in appearance order
 */
function prBodyTokens(body: string): readonly string[] {
  const scanned = body.split("\n").reduce(
    (state: { inFence: boolean; tokens: readonly string[] }, rawLine) => {
      const line = rawLine.trim();
      if (line.startsWith("```")) {
        return { ...state, inFence: !state.inFence };
      }
      const match = state.inFence ? null : REF_LINE_PATTERN.exec(line);
      if (match === null) return state;
      const words = (match[1] ?? "")
        .replace(/^[\s:]+/, "")
        .split(/[\s,]+/)
        .map(stripTrailingPunctuation)
        .filter(word => CANDIDATE_PATTERN.test(word));
      return { ...state, tokens: [...state.tokens, ...words] };
    },
    { inFence: false, tokens: [] }
  );
  return scanned.tokens;
}

/**
 * Extract the deduped union of work-item refs for a commit range.
 * @param options - Range, tracker scope, and working directory
 * @param deps - Injectable executors (defaults to real git/gh)
 * @returns Canonical refs, skipped tokens, and the resolved head SHA
 */
export async function extractWorkItemRefs(
  options: ExtractRefsOptions,
  deps: RefExtractionDeps = defaultRefExtractionDeps(options.cwd)
): Promise<ExtractedRefs> {
  const separator = options.range.indexOf("..");
  if (separator === -1) {
    throw new Error(
      `Invalid range "${options.range}": expected <base>..<head>`
    );
  }
  const base = options.range.slice(0, separator);
  const head = options.range.slice(separator + 2).replace(/^\./, "");
  // Charset gate + --end-of-options below: a revision must never be able to
  // smuggle option-like or shell-meta payloads into the git argv.
  if (!REVISION_PATTERN.test(base) || !REVISION_PATTERN.test(head)) {
    throw new Error(
      `Invalid range "${options.range}": each revision side must be a plain git revision (letters, digits, ".", "_", "/", "^", "~", "@", "-").`
    );
  }
  // --verify puts rev-parse in single-revision mode, where --end-of-options
  // is honored (bare rev-parse would echo it back instead).
  const headSha = (
    await deps.execGit(["rev-parse", "--verify", "--end-of-options", head])
  ).trim();
  const shas = (
    await deps.execGit([
      "rev-list",
      "--reverse",
      "--end-of-options",
      options.range,
    ])
  )
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0);
  const trailerOutputs = await Promise.all(
    shas.map(sha =>
      deps.execGit([
        "log",
        "-1",
        "--format=%(trailers:key=Work-Item,valueonly)",
        sha,
      ])
    )
  );
  const trailerTokens = trailerOutputs.flatMap(output =>
    output
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0)
  );
  const prTokens =
    options.repository === undefined
      ? []
      : await collectPrTokens(shas, options.repository, deps);
  const results = [...trailerTokens, ...prTokens].map(token =>
    canonicalizeToken(token, options)
  );
  const canonical = results.flatMap(result =>
    result.ref === undefined ? [] : [result.ref]
  );
  const refs = canonical.filter(
    (ref, index) => canonical.indexOf(ref) === index
  );
  const allSkipped = results.flatMap(result =>
    result.reason === undefined
      ? []
      : [{ token: result.token, reason: result.reason }]
  );
  const skipped = allSkipped.filter(
    (entry, index) =>
      allSkipped.findIndex(other => other.token === entry.token) === index
  );
  return { refs, skipped, headSha };
}

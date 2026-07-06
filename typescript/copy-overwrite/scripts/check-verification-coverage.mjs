#!/usr/bin/env node
/**
 * check-verification-coverage — per-change verification (UAT) gate.
 *
 * Verification IS UAT — one gate, not two. This fails a feat/fix change that
 * ships no verification-spec delta (the project's e2e/Playwright tests, where
 * `codify-verification` lands the codified playthrough), so every behavioral
 * change carries an acceptance test an agent's verification produced. A genuinely
 * non-behavioral change may carry the `verification-exempt` label, which this
 * check honors but LOGS (never a silent skip).
 *
 * Inputs (all via env, CI-friendly):
 *   VERIFY_BASE_SHA      diff base (else falls back to `origin/<VERIFY_BASE_REF|main>...HEAD`)
 *   VERIFY_HEAD_SHA      diff head (default HEAD)
 *   VERIFY_BASE_REF      base branch for the fallback range (default main)
 *   VERIFY_CHANGE_TYPES  comma list of conventional-commit types in the change
 *                        (e.g. "feat,chore"); if empty, derived from commit subjects
 *   VERIFY_LABELS        comma list of PR labels (fallback for `verification-exempt`)
 *   VERIFY_PR_NUMBER     pull request number for live label lookup
 *   VERIFY_GITHUB_REPOSITORY owner/repo for live label lookup
 *   VERIFY_GITHUB_TOKEN      token with pull-requests: read for live label lookup
 *
 * Exit 0 = satisfied / exempt / not-required. Exit 1 = required but missing.
 * @module scripts/check-verification-coverage
 */
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const BEHAVIORAL_TYPES = new Set(["feat", "fix"]);
const EXEMPT_LABEL = "verification-exempt";
// A verification spec lives in a top-level e2e/ dir, a nested tests/e2e/ tree,
// or a tests/verification/ tree — NOT an arbitrary path that merely contains an
// "e2e" segment (e.g. src/e2e/helpers.ts must not satisfy the gate).
const VERIFICATION_PATH =
  /(?:^e2e\/)|(?:(?:^|\/)tests\/(?:e2e|verification)\/)/;

/**
 * Parse a comma-delimited label list.
 * @param {string | undefined} value - Comma-delimited labels
 * @returns {string[]} Parsed labels
 */
function parseLabels(value) {
  return (value || "")
    .split(",")
    .map(label => label.trim())
    .filter(Boolean);
}

/**
 * Fetch the current PR label set from GitHub when CI provides PR context.
 * @param {object} input - GitHub API context
 * @param {string | undefined} input.repository - Repository in owner/name form
 * @param {string | undefined} input.prNumber - Pull request number
 * @param {string | undefined} input.token - GitHub token
 * @param {typeof fetch} [input.fetchImpl] - Fetch implementation for tests
 * @param {number} [input.timeoutMs] - Abort the request after this many ms
 * @returns {Promise<string[] | null>} Live labels, or null when context is absent
 */
export async function fetchLivePullRequestLabels({
  repository,
  prNumber,
  token,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10000,
}) {
  if (!repository || !prNumber || !token) {
    return null;
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Live label lookup requires a fetch implementation.");
  }

  // Bound the request so a stalled GitHub connection can't hang the gate until
  // the outer CI timeout kills the job.
  let response;
  try {
    response = await fetchImpl(
      `https://api.github.com/repos/${repository}/pulls/${prNumber}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(timeoutMs),
      }
    );
  } catch (error) {
    if (
      error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new Error(
        `Failed to fetch live PR labels: GitHub API request timed out after ${timeoutMs}ms.`
      );
    }
    throw error;
  }
  if (!response.ok) {
    throw new Error(
      `Failed to fetch live PR labels: GitHub API returned ${response.status}.`
    );
  }

  const pullRequest = await response.json();
  return Array.isArray(pullRequest.labels)
    ? pullRequest.labels
        .map(label => label?.name)
        .filter(label => typeof label === "string" && label.length > 0)
    : [];
}

/**
 * Pure decision: is a verification-spec delta required, and is it satisfied?
 * @param {object} input - Evaluation input
 * @param {string[]} input.changedFiles - Paths changed in the range
 * @param {string[]} input.changeTypes - Conventional-commit types present
 * @param {string[]} input.labels - PR labels
 * @returns {{required: boolean, ok: boolean, exempt?: boolean, reason: string}} Verdict
 */
export function evaluateVerificationCoverage({
  changedFiles,
  changeTypes,
  labels,
}) {
  const isBehavioral = changeTypes.some(type => BEHAVIORAL_TYPES.has(type));
  const isExempt = labels.includes(EXEMPT_LABEL);
  const hasDelta = changedFiles.some(file => VERIFICATION_PATH.test(file));

  if (!isBehavioral) {
    return {
      required: false,
      ok: true,
      reason: "No feat/fix change — a verification-spec delta is not required.",
    };
  }
  if (isExempt) {
    return {
      required: true,
      ok: true,
      exempt: true,
      reason: `Behavioral change exempted by the '${EXEMPT_LABEL}' label.`,
    };
  }
  if (hasDelta) {
    return {
      required: true,
      ok: true,
      reason: "Behavioral change ships a verification (e2e) spec delta.",
    };
  }
  return {
    required: true,
    ok: false,
    reason: `Behavioral change (feat/fix) ships NO verification (e2e) spec and is not labeled '${EXEMPT_LABEL}'.`,
  };
}

/**
 * Gather the change context from git + env.
 * @returns {Promise<{changedFiles: string[], changeTypes: string[], labels: string[]}>} Context
 */
async function gatherContext() {
  const head = process.env.VERIFY_HEAD_SHA || "HEAD";
  const baseRef = process.env.VERIFY_BASE_REF || "main";
  const base = process.env.VERIFY_BASE_SHA || `origin/${baseRef}`;
  // Three-dot diff = the PR's "files changed" (merge-base), matching GitHub.
  // Two-dot log = the commits the PR introduces (not both tips).
  const diffRange = `${base}...${head}`;
  const logRange = `${base}..${head}`;

  const runGit = (cmd, fallback) => {
    try {
      return execSync(cmd, { encoding: "utf8" });
    } catch {
      return fallback;
    }
  };

  const changedFiles = runGit(`git diff --name-only ${diffRange}`, "")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  const fromEnv = (process.env.VERIFY_CHANGE_TYPES || "")
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  const fromCommits = fromEnv.length
    ? []
    : runGit(`git log --format=%s ${logRange}`, "")
        .split("\n")
        .map(subject => {
          const match = subject.match(/^(\w+)[(!:]/);
          return match ? match[1].toLowerCase() : null;
        })
        .filter(Boolean);
  const changeTypes = [...new Set([...fromEnv, ...fromCommits])];

  const fallbackLabels = parseLabels(process.env.VERIFY_LABELS);
  const liveLabels = await fetchLivePullRequestLabels({
    repository: process.env.VERIFY_GITHUB_REPOSITORY,
    prNumber: process.env.VERIFY_PR_NUMBER,
    token: process.env.VERIFY_GITHUB_TOKEN,
  });
  const labels = liveLabels ?? fallbackLabels;

  return { changedFiles, changeTypes, labels };
}

/**
 * CLI entry: evaluate and exit non-zero when a required verification delta is missing.
 * @returns {Promise<void>}
 */
async function main() {
  const context = await gatherContext();
  const result = evaluateVerificationCoverage(context);
  console.log(
    `[verification-coverage] types=[${context.changeTypes.join(
      ","
    )}] labels=[${context.labels.join(",")}]`
  );
  console.log(`[verification-coverage] ${result.reason}`);
  if (result.exempt) {
    console.log(
      "[verification-coverage] EXEMPT (logged): proceeding without a verification delta for a declared non-behavioral change."
    );
  }
  if (!result.ok) {
    console.error(`[verification-coverage] FAIL: ${result.reason}`);
    process.exit(1);
  }
  console.log("[verification-coverage] OK");
}

// Run only when invoked directly — importing for tests must have no side effects.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(error => {
    console.error(`[verification-coverage] FAIL: ${error.message}`);
    process.exit(1);
  });
}

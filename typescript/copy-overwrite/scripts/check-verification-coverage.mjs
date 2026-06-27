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
 *   VERIFY_LABELS        comma list of PR labels (for `verification-exempt`)
 *
 * Exit 0 = satisfied / exempt / not-required. Exit 1 = required but missing.
 * @module scripts/check-verification-coverage
 */
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const BEHAVIORAL_TYPES = new Set(["feat", "fix"]);
const EXEMPT_LABEL = "verification-exempt";
// A verification spec = the project's e2e/Playwright tests (where codified
// verification lives), or a dedicated tests/verification tree.
const VERIFICATION_PATH = /(^|\/)e2e\/|(^|\/)tests\/verification\//;

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
 * @returns {{changedFiles: string[], changeTypes: string[], labels: string[]}} Context
 */
function gatherContext() {
  const head = process.env.VERIFY_HEAD_SHA || "HEAD";
  const baseRef = process.env.VERIFY_BASE_REF || "main";
  const range = process.env.VERIFY_BASE_SHA
    ? `${process.env.VERIFY_BASE_SHA} ${head}`
    : `origin/${baseRef}...HEAD`;

  const runGit = (cmd, fallback) => {
    try {
      return execSync(cmd, { encoding: "utf8" });
    } catch {
      return fallback;
    }
  };

  const changedFiles = runGit(`git diff --name-only ${range}`, "")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  const fromEnv = (process.env.VERIFY_CHANGE_TYPES || "")
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  const fromCommits = fromEnv.length
    ? []
    : runGit(`git log --format=%s ${range.replace("...", "..")}`, "")
        .split("\n")
        .map(subject => {
          const match = subject.match(/^(\w+)[(!:]/);
          return match ? match[1].toLowerCase() : null;
        })
        .filter(Boolean);
  const changeTypes = [...new Set([...fromEnv, ...fromCommits])];

  const labels = (process.env.VERIFY_LABELS || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);

  return { changedFiles, changeTypes, labels };
}

/**
 * CLI entry: evaluate and exit non-zero when a required verification delta is missing.
 * @returns {void}
 */
function main() {
  const context = gatherContext();
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
  main();
}

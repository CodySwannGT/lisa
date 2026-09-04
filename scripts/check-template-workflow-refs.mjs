#!/usr/bin/env node
/**
 * Deterministic gate that every `uses:` in a shipped caller template resolves
 * at the ref it names (issue #2702).
 *
 * Two expo templates shipped pinned at `@v2.345.1`, a Lisa version that
 * predates the reusable they call. The referenced file does not exist at that
 * tag, so the workflow cannot load: GitHub reports "this run likely failed
 * because of a workflow file issue" and runs ZERO jobs.
 *
 * Nothing caught it, and the reason is the point of this gate:
 *
 *   - a workflow that fails to LOAD produces no test output, so no suite goes
 *     red and no report shows a failure to read;
 *   - `nightly-e2e-report.yml` therefore stayed byte-identical to the broken
 *     template in every consumer that received it, and a filename/hash audit
 *     scored that as the HEALTHY row — identical-and-never-worked outranks
 *     diverged-and-working on every measure except whether it works;
 *   - it had never once succeeded: three scheduled runs across two repos,
 *     three failures, zero successes, from the day it shipped.
 *
 * The sibling defect was visible and so it was repaired four different ways.
 * `nightly-e2e-health.yml` backs a required gate, so consumers noticed
 * instantly: one repointed to `@v3.27.0`, one to `@v3.14.8`, and two abandoned
 * the reusable and reimplemented it locally. None of those repairs flowed back
 * upstream, so every new consumer inherited the same broken pin.
 *
 * This script reads what the templates actually reference and confirms the
 * target exists. Only that.
 *
 * Determinism guarantees (so the unit test is reproducible and CI is stable):
 *   - zero third-party dependencies (Node built-ins only),
 *   - no network access,
 *   - no `Date` / `Math.random`,
 *   - the file list comes from `git ls-files`, so the gate sees exactly what a
 *     release would carry.
 *
 * A `@main` reference is checked against the working tree, which needs no
 * history and so is correct in a depth-1 CI clone. A reference pinned to a tag
 * or SHA needs that object locally; when it is missing the gate reports
 * UNVERIFIABLE and exits 2. It never treats "I could not look" as "it is fine"
 * — a gate that passes because it did nothing is the exact failure this file
 * exists to prevent, and it would be perverse to reproduce it here.
 *
 * Discovering zero templates is likewise exit 2, not a clean pass. Finding
 * nothing to check is a broken invocation, not conformance.
 *
 * CLI:
 *   node scripts/check-template-workflow-refs.mjs [--root <dir>] [--json]
 *
 * Exit codes (mirroring the sibling parity scripts):
 *   0 — every `uses:` in every caller template resolves at its ref.
 *   1 — ≥1 reference names a target that does not exist at that ref.
 *   2 — operational/usage error: unknown flag, a flag missing its value,
 *       `--root` absent or not a git repository, git unavailable, zero
 *       templates discovered, or a pinned ref that is not present locally.
 *
 * @module scripts/check-template-workflow-refs
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { boundedExecFileSync, isChildTimeout } from "./lib/bounded-spawn.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/**
 * A caller template: `<lane>/<mode>/.github/workflows/<name>.yml`, e.g.
 * `expo/create-only/.github/workflows/maestro-e2e.yml`. The two leading
 * segments are what distinguishes a shipped template from Lisa's OWN
 * `.github/workflows/`, which is not delivered to anyone.
 */
const TEMPLATE_RE = /^[^/]+\/[^/]+\/\.github\/workflows\/[^/]+\.ya?ml$/;

/** `uses: CodySwannGT/lisa/<path>@<ref>` — the reference this gate verifies. */
const USES_RE = /uses:\s*CodySwannGT\/lisa\/([^\s@]+)@([^\s"'#]+)/g;

/**
 * `uses:` introducing a YAML block scalar — `>`, `>-`, `|`, `|+` and friends.
 *
 * A folded `uses:` puts the reference on a CONTINUATION line, so a per-line
 * scan for `uses: CodySwannGT/...` finds nothing at all and the template reads
 * as having no references. That is not a cosmetic gap: a shipped template
 * pinned to a SHA sat unseen by this gate precisely because it was written this
 * way, and every sweep run against it — including one done by hand — reported
 * the file clean. A parser that silently sees nothing is the same false green
 * this gate exists to prevent, one level up.
 *
 * The header may also carry an explicit INDENTATION indicator — a single digit
 * `1`-`9` — and YAML permits it on either side of the chomping indicator, so
 * `>2-` and `>-2` are both well-formed. Matching only the chomping indicator
 * reproduces the very blind spot above in a narrower form: the header fails to
 * match, the continuation scan never runs, and the reference is invisible
 * again. The digit class is `1`-`9` rather than `\d` because `0` is not a legal
 * indentation indicator and the indicator is exactly one digit wide.
 */
const USES_BLOCK_RE =
  /^(\s*)uses:\s*[>|](?:[-+][1-9]?|[1-9][-+]?)?\s*(?:#.*)?$/;

/** The reference itself, unanchored, for continuation lines. */
const BARE_REF_RE = /CodySwannGT\/lisa\/([^\s@]+)@([^\s"'#]+)/g;

/** The moving ref, resolvable against the working tree with no history. */
const MOVING_REF = "main";

/** Max bytes of `git ls-files` output (7k+ tracked paths is ~0.3 MB today). */
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * Usage error — thrown for an invalid invocation or an unverifiable state so
 * `main` can distinguish it (exit 2) from a finding (exit 1).
 */
export class UsageError extends Error {}

/**
 * Extract every Lisa workflow reference in `content`.
 *
 * @param {string} content - full text of a template.
 * @returns {{ target: string, ref: string, line: number }[]} one entry per
 *   reference, with 1-based line numbers, in file order.
 */
export function findWorkflowRefs(content) {
  const lines = String(content).split(/\r?\n/);
  const refs = [];
  for (let index = 0; index < lines.length; index++) {
    // A fresh lastIndex per line: the regex is global and shared.
    USES_RE.lastIndex = 0;
    let match;
    let matchedInline = false;
    while ((match = USES_RE.exec(lines[index])) !== null) {
      matchedInline = true;
      refs.push({ line: index + 1, ref: match[2], target: match[1] });
    }
    if (matchedInline) continue;

    // A folded `uses:` carries its value on the following, more-indented
    // lines. The reported line is where the reference text actually sits, so a
    // reader can jump straight to the token rather than to the key above it.
    const block = USES_BLOCK_RE.exec(lines[index]);
    if (block === null) continue;
    const keyIndent = block[1].length;
    for (let next = index + 1; next < lines.length; next++) {
      const line = lines[next];
      if (line.trim() === "") continue;
      const indent = line.length - line.trimStart().length;
      if (indent <= keyIndent) break;
      BARE_REF_RE.lastIndex = 0;
      let inner;
      while ((inner = BARE_REF_RE.exec(line)) !== null) {
        refs.push({ line: next + 1, ref: inner[2], target: inner[1] });
      }
    }
  }
  return refs;
}

/**
 * Whether a reference violates the standing rule that every consumer-facing
 * reference to a Lisa reusable workflow tracks `@main`.
 *
 * The rule is a decision, not a preference, and both alternatives to it fail
 * SILENTLY, which is why this is enforced rather than documented:
 *
 *   - a tag pin goes stale without ever failing. Two templates sat on a tag a
 *     full major version behind; nothing went red, they simply stopped
 *     receiving anything.
 *   - a SHA pin is worse, because a history rewrite makes the commit
 *     unreachable and GitHub Actions then cannot LOAD the workflow. Zero jobs
 *     are created, so the required context is ABSENT rather than red, and
 *     pull requests block forever waiting on a verdict that will never arrive.
 *     That has already happened here once and needed an admin override.
 *
 * `@main` breaking is the loud failure, and the sanctioned response to it is to
 * fix the reusable workflow upstream rather than to freeze a consumer.
 * @param {{ ref: string }} reference - the parsed reference.
 * @returns {boolean} true when the reference is pinned rather than tracking.
 */
export function violatesRefPolicy(reference) {
  return reference.ref !== MOVING_REF;
}

/**
 * List every tracked file in `root`, relative to it. Throws `UsageError` when
 * git is unavailable or `root` is not a repository.
 *
 * @param {string} root - the repository root.
 * @returns {string[]} tracked paths, relative to `root`.
 */
function listTrackedFiles(root) {
  let stdout;
  try {
    stdout = boundedExecFileSync("git", ["-C", root, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    throw new UsageError(
      `could not list tracked files in ${root}: ${error.message}`
    );
  }
  return stdout.split("\0").filter(entry => entry !== "");
}

/**
 * Whether `ref` names an object present in this clone.
 *
 * A KILLED child re-raises. `false` here does not mean "unknown", it means
 * "this reference is broken" — a verdict the caller reports. So a busy machine
 * would manufacture a failure about a reference that is perfectly fine, and a
 * guard that invents failures is one people learn to re-run rather than read.
 * That is the sibling harm to failing open, and it is just as corrosive.
 * @param {string} root - the repository root.
 * @param {string} ref - a tag, branch, or SHA.
 * @returns {boolean} whether the ref resolves locally.
 * @throws {Error} When the child was killed at its deadline
 */
function refExists(root, ref) {
  try {
    boundedExecFileSync(
      "git",
      ["-C", root, "rev-parse", "--verify", `${ref}^{commit}`],
      {
        stdio: ["ignore", "ignore", "ignore"],
      }
    );
    return true;
  } catch (error) {
    if (isChildTimeout(error)) throw error;
    return false;
  }
}

/**
 * Whether `target` exists in the tree named by `ref`.
 *
 * A KILLED child re-raises, for the reason given on `refExists` above: `false`
 * is a verdict of "absent at that ref", not an admission of ignorance.
 * @param {string} root - the repository root.
 * @param {string} ref - a tag, branch, or SHA known to resolve.
 * @param {string} target - a repo-relative path.
 * @returns {boolean} whether the path exists at that ref.
 * @throws {Error} When the child was killed at its deadline
 */
function pathExistsAtRef(root, ref, target) {
  try {
    boundedExecFileSync(
      "git",
      ["-C", root, "cat-file", "-e", `${ref}:${target}`],
      {
        stdio: ["ignore", "ignore", "ignore"],
      }
    );
    return true;
  } catch (error) {
    if (isChildTimeout(error)) throw error;
    return false;
  }
}

/**
 * Resolve one reference to a verdict.
 *
 * `@main` is checked against the working tree so the gate is correct in a
 * depth-1 clone, where `main` frequently is not a local ref at all. A pinned
 * ref that is absent locally yields `unverifiable`, never `ok`.
 *
 * @param {string} root - the repository root.
 * @param {{ target: string, ref: string }} reference - the parsed reference.
 * @returns {"ok" | "missing" | "unverifiable"} the verdict.
 */
export function classifyRef(root, reference) {
  const { ref, target } = reference;
  if (ref === MOVING_REF) {
    return fs.existsSync(path.join(root, target)) ? "ok" : "missing";
  }
  if (!refExists(root, ref)) {
    return "unverifiable";
  }
  return pathExistsAtRef(root, ref, target) ? "ok" : "missing";
}

/**
 * Assemble the machine-readable report.
 *
 * @param {ReadonlyArray<Record<string, unknown>>} results - non-ok references.
 * @param {{ root: string, templates: number, checked: number }} opts - resolved
 *   options plus scan size.
 * @returns {Record<string, unknown>} the report object.
 */
export function buildReport(results, opts) {
  const missing = results.filter(result => result.verdict === "missing");
  const unverifiable = results.filter(
    result => result.verdict === "unverifiable"
  );
  const pinned = results.filter(result => result.policy === "pinned");
  return {
    results,
    root: opts.root,
    schemaVersion: 1,
    summary: {
      checked: opts.checked,
      missing: missing.length,
      ok: opts.checked - results.length,
      pinned: pinned.length,
      templates: opts.templates,
      unverifiable: unverifiable.length,
    },
  };
}

/**
 * Render the human-readable report.
 *
 * @param {{ results: ReadonlyArray<Record<string, unknown>>, summary: Record<string, number> }} report
 *   the report object.
 * @returns {string} the rendered report.
 */
function humanReport(report) {
  const { summary } = report;
  if (
    summary.missing === 0 &&
    summary.unverifiable === 0 &&
    summary.pinned === 0
  ) {
    return `✓ ${summary.checked} workflow reference(s) across ${summary.templates} caller template(s) all resolve and track @${MOVING_REF}`;
  }
  const describe = result => {
    if (result.verdict === "missing")
      return "target does not exist at that ref";
    if (result.verdict === "unverifiable")
      return "ref not present in this clone, cannot verify";
    return `pinned, but every consumer reference must track @${MOVING_REF}`;
  };
  const lines = report.results.map(
    result =>
      `${result.verdict === "unverifiable" ? "?" : "✗"} ${result.file}:${result.line}\n    ${result.target}@${result.ref} — ${describe(result)}`
  );
  const tail = [];
  if (summary.pinned > 0) {
    tail.push(
      `${summary.pinned} reference(s) are pinned rather than tracking @${MOVING_REF}.`,
      "Both ways of pinning fail silently: a tag quietly stops receiving",
      "anything, and a SHA becomes unreachable after a history rewrite, so the",
      "workflow cannot load, zero jobs run, and the required check is ABSENT",
      "rather than red — which blocks pull requests on a verdict that never",
      `arrives. Repoint these at @${MOVING_REF}; when @${MOVING_REF} breaks, fix it upstream.`
    );
  }
  if (summary.missing > 0) {
    tail.push(
      `${summary.missing} reference(s) name a target that does not exist at the pinned ref.`,
      "A consumer receiving this template gets a workflow that cannot load:",
      "GitHub runs zero jobs and reports a workflow file issue, which produces",
      "no test output and so reads as silence rather than as failure."
    );
  }
  if (summary.unverifiable > 0) {
    tail.push(
      `${summary.unverifiable} reference(s) could not be verified because the ref`,
      "is absent from this clone. Fetch tags and history, then re-run. This is",
      "reported rather than passed: a gate that cannot look must not claim it saw."
    );
  }
  return [...lines, "", ...tail].join("\n");
}

/**
 * Parse argv into resolved options. Throws `UsageError` on a bad invocation.
 *
 * @param {readonly string[]} argv - arguments (without node/script prefix).
 * @returns {{ root: string, json: boolean }} options.
 */
export function parseArgs(argv) {
  let root = null;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--root") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new UsageError("--root requires a value");
      }
      root = next;
      i += 1;
    } else {
      throw new UsageError(`unknown argument: ${arg}`);
    }
  }
  return { json, root: path.resolve(root ?? REPO_ROOT) };
}

/**
 * Run the gate. Returns the process exit code (does not call `exit`).
 *
 * @param {readonly string[]} argv - arguments (without node/script prefix).
 * @param {{ stdout?: { write(s: string): void }, stderr?: { write(s: string): void } }} [io]
 *   injectable streams (defaults to process streams).
 * @returns {number} exit code (0 clean, 1 finding, 2 usage/unverifiable).
 */
export function main(argv, io = {}) {
  const out = io.stdout ?? process.stdout;
  const err = io.stderr ?? process.stderr;
  let opts;
  let templates;
  try {
    opts = parseArgs(argv);
    if (!fs.existsSync(opts.root) || !fs.statSync(opts.root).isDirectory()) {
      throw new UsageError(`--root is not a directory: ${opts.root}`);
    }
    templates = listTrackedFiles(opts.root).filter(file =>
      TEMPLATE_RE.test(file)
    );
    if (templates.length === 0) {
      // Finding nothing to check is a broken invocation, not conformance.
      throw new UsageError(
        `no caller templates found under ${opts.root} — expected paths like ` +
          "expo/create-only/.github/workflows/*.yml. Refusing to report a " +
          "clean run for a scan that examined nothing."
      );
    }
  } catch (error) {
    err.write(`error: ${error.message}\n`);
    return 2;
  }

  let checked = 0;
  const results = [];
  try {
    for (const file of templates) {
      const content = fs.readFileSync(path.join(opts.root, file), "utf8");
      for (const reference of findWorkflowRefs(content)) {
        checked += 1;
        const verdict = classifyRef(opts.root, reference);
        const pinned = violatesRefPolicy(reference);
        // Resolution and policy are independent questions, and a pinned ref
        // that resolves today is exactly the case worth reporting: it is
        // healthy right now and will fail silently later. Reporting only
        // unresolvable refs would call it clean.
        if (verdict !== "ok" || pinned) {
          results.push({
            ...reference,
            file,
            policy: pinned ? "pinned" : "tracking",
            verdict,
          });
        }
      }
    }
  } catch (error) {
    err.write(`error: failed to scan caller templates: ${error.message}\n`);
    return 2;
  }

  const report = buildReport(results, {
    checked,
    root: opts.root,
    templates: templates.length,
  });
  out.write(
    `${opts.json ? JSON.stringify(report, null, 2) : humanReport(report)}\n`
  );
  if (report.summary.unverifiable > 0) {
    return 2;
  }
  return report.summary.missing === 0 && report.summary.pinned === 0 ? 0 : 1;
}

if (invokedAsScript(import.meta.url)) {
  // exitCode (not process.exit): when stdout is a pipe, writes are async and
  // process.exit() truncates the report mid-flush.
  process.exitCode = main(process.argv.slice(2));
}

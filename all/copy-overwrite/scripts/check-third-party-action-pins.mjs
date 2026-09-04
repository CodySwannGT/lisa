#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.
/**
 * Deterministic gate that every THIRD-PARTY GitHub Action this repository uses
 * — in its own workflows and in the workflow templates it seeds into consumers
 * — is referenced by a full 40-character commit SHA (issue #3585).
 *
 * A mutable ref is not a version. `@master`, `@main`, `@v1` and `@v0.9.0` are
 * pointers that resolve, at job start, to whatever the upstream owner has
 * pushed at that instant, and for a third-party action that owner is a
 * stranger. A tag is mutable by definition — `git push --force` moves it — and
 * a floating major is *designed* to move.
 *
 * The exposure is not theoretical here. When this gate was written the tree
 * held 19 distinct third-party references, none pinned, thirteen of them in
 * jobs holding a credential:
 *
 *   - `snyk/actions/node@master` with the Snyk token in the same step's `env:`;
 *   - `fossas/fossa-action@main` handed the FOSSA key as an input;
 *   - `noliran/branch-based-secrets@v1`, whose ENTIRE FUNCTION is to resolve
 *     repository secrets into the job environment, in the publish path;
 *   - `GeoWerkstatt/create-jira-release@v1`, handed a webhook secret.
 *
 * `quality.yml` and `release.yml` are reusable workflows the fleet calls at
 * `@main`, so a compromised upstream would execute inside every consumer's
 * quality gate on their next run.
 *
 * Pinning today does not stop the next `uses:` line, which is why the durable
 * artifact is this detector rather than the pins. A stale comment in a
 * consumer repository nearly caused two load-bearing references to be
 * unpinned; prose does not hold a boundary, an executable check does.
 *
 * ## What is deliberately NOT in scope
 *
 * **First-party references.** `uses: CodySwannGT/lisa/...@main` is a different
 * threat model — a stability question about an upstream we own and can read,
 * tracked separately in #3488 — and a check that reddens it is the wrong check
 * and will be turned off. First-party references never appear in this gate's
 * findings and are never named in its output. That exemption is a required
 * property with its own test, not an afterthought.
 *
 * **`actions/*` and `github/*`.** These are published by GitHub itself, the
 * same party that runs the job, so pinning them moves no trust boundary. The
 * decision is recorded here so it stays consistent, and the exemption is
 * narrow: it is an OWNER allowlist, not a substring match.
 *
 * **Fixture trees** (`tests/fixtures/`, `parity/fixtures/`). These are inputs
 * to other checks, never executed by GitHub Actions, and pinning them would
 * distort the shapes those checks exist to recognise. The count of skipped
 * fixture files is REPORTED in every run rather than silently dropped, so the
 * boundary is visible in the output instead of buried in this comment.
 *
 * **Consumer repositories already seeded from the `create-only` templates.**
 * A `create-only` file is written once and never overwritten, so correcting a
 * template changes what FUTURE repositories are seeded with and changes
 * nothing about any repository that already exists. This gate runs in this
 * repository only; it cannot and does not report seeded consumers as fixed.
 *
 * ## Why a bare SHA is also a finding
 *
 * `uses: <vendor>/<action>@<40-hex>` with no trailing comment is
 * immutable but unreadable: nobody can tell what is installed, so nobody
 * upgrades it, so it rots at whatever commit it was pinned at. The pin and the
 * human-readable version are one artifact, and the gate treats them that way.
 *
 * Determinism guarantees (so the unit test is reproducible and CI is stable):
 *   - zero third-party dependencies (Node built-ins only),
 *   - no network access,
 *   - no `Date` / `Math.random`,
 *   - the file list comes from `git ls-files`, so the gate sees exactly what a
 *     release would carry.
 *
 * ## `--warn`: how this arrives in a consumer without breaking it
 *
 * This file also ships to consumers through `all/copy-overwrite/scripts/`,
 * which — unlike `create-only` — reaches every repository that already exists,
 * on its next update. That reach is exactly why it must not arrive blocking.
 *
 * A consumer's seeded workflows carry mutable refs *today*: that is the defect
 * #3588 exists to migrate away. A detector that hard-failed on arrival would
 * redden the entire installed base at once, for a condition those repositories
 * did not introduce and could not have fixed yet, since the migration that
 * fixes it lands in the same update. That is not hypothetical — a guard added
 * to a workflow consumed at `@main` failed closed on a pre-existing consumer
 * misconfiguration and took four repositories' releases down for five hours;
 * the repair was to keep it loud and stop it blocking (#3755, #3757).
 *
 * So `--warn` reports every finding and exits 0, and the shipped consumer
 * script entry uses it. Tightening to blocking is a separate, deliberate
 * decision for once the installed base has had a chance to migrate — one flag
 * on one line — not something to "finish" while consumers are still mutable.
 *
 * `--warn` also softens the empty-scan usage error, because a consumer with no
 * workflow files is an ordinary shape rather than a broken invocation. A
 * misspelled flag stays a hard error in every mode: that one is the caller's.
 *
 * CLI:
 *   node scripts/check-third-party-action-pins.mjs [--root <dir>] [--json] [--warn]
 *
 * Exit codes (mirroring the sibling gates in this directory):
 *   0 — every third-party reference is a 40-hex SHA carrying a version comment;
 *       or `--warn` was passed and the findings are being reported, not enforced.
 *   1 — >=1 reference is mutable, or pinned without a version comment.
 *   2 — operational/usage error: unknown flag, a flag missing its value,
 *       `--root` absent or not a git repository, git unavailable, or zero
 *       workflow files discovered. Finding nothing to check is a broken
 *       invocation, not conformance — except under `--warn`, see above.
 *
 * @module scripts/check-third-party-action-pins
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { boundedExecFileSync } from "./lib/bounded-spawn.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/**
 * Any workflow file, at any depth: this repository's own `.github/workflows/`
 * and every seeded template tree, so a mutable ref cannot be introduced by
 * seeding rather than by running.
 */
const WORKFLOW_RE = /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/;

/**
 * Fixture trees: inputs to other checks, never executed by GitHub Actions.
 * Prefix match on the repo-relative path, so a real workflow cannot hide
 * behind a directory that merely contains the word "fixtures".
 */
const FIXTURE_PREFIXES = ["tests/fixtures/", "parity/fixtures/"];

/**
 * The owner of this repository's own reusable workflows. Compared
 * case-insensitively because GitHub owners are case-insensitive and a `uses:`
 * line may spell one either way.
 */
const FIRST_PARTY_OWNERS = ["codyswanngt"];

/** GitHub's own action namespaces — the runner's publisher, see header. */
const GITHUB_OWNED_OWNERS = ["actions", "github"];

/** Classification of an action's owner against the two documented exemptions. */
const FIRST_PARTY = "first-party";
const GITHUB_OWNED = "github-owned";
const THIRD_PARTY = "third-party";

/** Verdicts `evaluateReference` returns; `MUTABLE` is the headline finding. */
const OK = "ok";
const MUTABLE = "mutable-ref";
const NO_VERSION = "missing-version-comment";

/**
 * `uses: <owner>/<repo>[/<subpath>]@<ref>` with anything after it captured, so
 * a trailing `# v1.2.3` can be read. Local (`./path`) and container
 * (`docker://`) references have no owner and never match.
 */
const USES_RE = /^[ \t]*(?:-[ \t]*)?uses:[ \t]*(?<value>[^\s"'#]+)/;

/** A well-formed action owner. Anchored, so matching is linear. */
const OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

/** A well-formed action path below the owner. Anchored, so linear. */
const ACTION_PATH_RE = /^[A-Za-z0-9_.][A-Za-z0-9_./-]*$/;

/**
 * Split a `uses:` value into owner, action path, and ref.
 *
 * The shape is validated with anchored parts rather than described as one
 * pattern. Spelling `owner/repo/path@ref` as adjacent character classes gives
 * the engine several ways to divide the same text, which is super-linear on a
 * long line; splitting first and validating each piece has one.
 *
 * @param {string} value - the raw value of a `uses:` line.
 * @returns {{ owner: string, rest: string, ref: string } | null} parts, or null
 *   when this is not an `owner/repo@ref` reference (a local `./path` or a
 *   `docker://` image never is).
 */
function parseUsesValue(value) {
  const at = value.lastIndexOf("@");
  if (at <= 0) return null;
  const action = value.slice(0, at);
  const ref = value.slice(at + 1);
  const slash = action.indexOf("/");
  if (ref === "" || slash <= 0 || action.includes("://")) return null;
  const owner = action.slice(0, slash);
  const rest = action.slice(slash + 1);
  if (!OWNER_RE.test(owner) || !ACTION_PATH_RE.test(rest)) return null;
  return { owner, rest, ref };
}

/** A full commit SHA. Abbreviated SHAs are ambiguous and do not count. */
const FULL_SHA_RE = /^[0-9a-f]{40}$/;

/**
 * Read the version out of a line's trailing `# ...` comment.
 *
 * Deliberately not a regex. Every spelling of "text after a hash to end of
 * line" is either a backtracking shape or an unanchored `.*$` the engine
 * retries from each position, and neither is worth it for a one-character
 * search.
 *
 * @param {string} trailer - everything on the line after the `uses:` value.
 * @returns {string | null} the comment text, or null when there is none.
 */
function versionComment(trailer) {
  const hash = trailer.indexOf("#");
  if (hash < 0) return null;
  const version = trailer.slice(hash + 1).trim();
  return version === "" ? null : version;
}

/** Max bytes of `git ls-files` output (7k+ tracked paths is ~0.3 MB today). */
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * Usage error — thrown for an invalid invocation or an unusable state so
 * `main` can distinguish it (exit 2) from a finding (exit 1).
 */
export class UsageError extends Error {}

/**
 * Classify an action owner against the two documented exemptions.
 *
 * @param {string} owner - the owner segment of a `uses:` reference.
 * @returns {"first-party" | "github-owned" | "third-party"} the classification.
 */
export function classifyOwner(owner) {
  const normalized = String(owner).toLowerCase();
  if (FIRST_PARTY_OWNERS.includes(normalized)) return FIRST_PARTY;
  if (GITHUB_OWNED_OWNERS.includes(normalized)) return GITHUB_OWNED;
  return THIRD_PARTY;
}

/**
 * Extract every action reference in `content`, already classified.
 *
 * Every reference is returned, first-party ones included, so the caller can
 * count what it examined. Only third-party ones are ever eligible to become a
 * finding — see `evaluateReference`.
 *
 * @param {string} content - full text of a workflow file.
 * @returns {{ action: string, owner: string, ref: string, version: string | null, kind: string, line: number }[]}
 *   one entry per reference, with 1-based line numbers, in file order.
 */
export function findActionRefs(content) {
  const lines = String(content).split(/\r?\n/);
  const refs = [];
  for (let index = 0; index < lines.length; index++) {
    const match = USES_RE.exec(lines[index]);
    if (match === null) continue;
    const parsed = parseUsesValue(match.groups.value);
    if (parsed === null) continue;
    const { owner, ref, rest } = parsed;
    refs.push({
      action: `${owner}/${rest}`,
      kind: classifyOwner(owner),
      line: index + 1,
      owner,
      ref,
      // The rest of the line is sliced rather than captured: a trailing `.*`
      // after the value's character class gives the engine two ways to divide
      // the same text, which is the super-linear shape.
      version: versionComment(lines[index].slice(match[0].length)),
    });
  }
  return refs;
}

/**
 * Decide whether one reference is a finding.
 *
 * @param {{ kind: string, ref: string, version: string | null }} reference -
 *   a reference from `findActionRefs`.
 * @returns {"ok" | "mutable-ref" | "missing-version-comment"} the verdict.
 */
export function evaluateReference(reference) {
  if (reference.kind !== THIRD_PARTY) return OK;
  if (!FULL_SHA_RE.test(reference.ref)) return MUTABLE;
  return reference.version === null ? NO_VERSION : OK;
}

/**
 * Whether a repo-relative path is a workflow this gate governs.
 *
 * @param {string} file - repo-relative path.
 * @returns {boolean} whether the file is an in-scope workflow.
 */
export function isGovernedWorkflow(file) {
  return WORKFLOW_RE.test(file) && !isFixtureWorkflow(file);
}

/**
 * Whether a repo-relative path is an excluded fixture workflow.
 *
 * @param {string} file - repo-relative path.
 * @returns {boolean} whether the file sits in an excluded fixture tree.
 */
export function isFixtureWorkflow(file) {
  return (
    WORKFLOW_RE.test(file) &&
    FIXTURE_PREFIXES.some(prefix => file.startsWith(prefix))
  );
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
 * Assemble the machine-readable report.
 *
 * @param {ReadonlyArray<Record<string, unknown>>} findings - non-ok references.
 * @param {{ root: string, workflows: number, fixturesSkipped: number, thirdParty: number, checked: number }} opts
 *   resolved options plus scan size.
 * @returns {Record<string, unknown>} the report object.
 */
export function buildReport(findings, opts) {
  return {
    findings,
    root: opts.root,
    schemaVersion: 1,
    summary: {
      checked: opts.checked,
      fixturesSkipped: opts.fixturesSkipped,
      missingVersionComment: findings.filter(
        finding => finding.verdict === NO_VERSION
      ).length,
      mutable: findings.filter(finding => finding.verdict === MUTABLE).length,
      thirdParty: opts.thirdParty,
      workflows: opts.workflows,
    },
  };
}

/**
 * The remediation text. A guard that reddens without teaching the fix gets
 * bypassed, so the exact command that produces the SHA is in the output.
 *
 * @returns {string[]} lines of remediation guidance.
 */
function remediation() {
  return [
    "Pin every third-party action to a full 40-character commit SHA, with the",
    "human-readable version in a trailing comment so the pin stays auditable:",
    "",
    "    - uses: <vendor>/<action>@<40-hex-sha>  # v1.2.3",
    "",
    "Resolve the SHA for the ref the workflow uses TODAY — pinning and",
    "upgrading in one commit makes a regression unattributable:",
    "",
    "    gh api repos/<owner>/<repo>/commits/<ref> --jq .sha",
    "",
    "Then name the version that SHA carries:",
    "",
    "    gh api repos/<owner>/<repo>/tags --jq '.[] | select(.commit.sha==\"<sha>\") | .name'",
    "",
    "A branch head with no tag is pinned the same way; say so in the comment,",
    "e.g. `# main (untagged, 2026-08-28)`.",
    "",
    "First-party workflow references and GitHub's own actions/* and github/*",
    "are out of scope for this gate by design and are never reported here.",
  ];
}

/**
 * Render the human-readable report.
 *
 * @param {{ findings: ReadonlyArray<Record<string, unknown>>, summary: Record<string, number> }} report
 *   the report object.
 * @returns {string} the rendered report.
 */
function humanReport(report) {
  const { summary } = report;
  const scanned =
    `${summary.thirdParty} third-party reference(s) across ` +
    `${summary.workflows} workflow file(s) ` +
    `(${summary.fixturesSkipped} fixture workflow(s) skipped)`;
  if (report.findings.length === 0) {
    return `✓ ${scanned} — all pinned to a full commit SHA with a version comment`;
  }
  const lines = report.findings.map(finding =>
    finding.verdict === MUTABLE
      ? `✗ ${finding.file}:${finding.line}\n    ${finding.action}@${finding.ref} — mutable ref, not a commit SHA`
      : `✗ ${finding.file}:${finding.line}\n    ${finding.action}@${finding.ref} — pinned but no version comment`
  );
  return [
    ...lines,
    "",
    `${report.findings.length} of ${scanned} are not safely pinned.`,
    "",
    ...remediation(),
  ].join("\n");
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
  let warn = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--warn") {
      warn = true;
    } else if (arg === "--root") {
      const valueAt = i + 1;
      if (valueAt >= argv.length || !Object.hasOwn(argv, valueAt)) {
        throw new UsageError("--root requires a value");
      }
      const next = argv[valueAt];
      if (next.startsWith("--")) {
        throw new UsageError("--root requires a value");
      }
      root = next;
      i += 1;
    } else {
      throw new UsageError(`unknown argument: ${arg}`);
    }
  }
  return { json, warn, root: path.resolve(root ?? REPO_ROOT) };
}

/**
 * Resolve the file list for a run, or throw `UsageError`.
 *
 * @param {string} root - the repository root.
 * @returns {{ workflows: string[], fixturesSkipped: number }} the scan inputs.
 */
function collectWorkflows(root) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new UsageError(`--root is not a directory: ${root}`);
  }
  const tracked = listTrackedFiles(root);
  const workflows = tracked.filter(file => isGovernedWorkflow(file));
  if (workflows.length === 0) {
    // Finding nothing to check is a broken invocation, not conformance.
    throw new UsageError(
      `no workflow files found under ${root} — expected paths like ` +
        ".github/workflows/*.yml. Refusing to report a clean run for a scan " +
        "that examined nothing."
    );
  }
  return {
    fixturesSkipped: tracked.filter(file => isFixtureWorkflow(file)).length,
    workflows,
  };
}

/**
 * Run the gate. Returns the process exit code (does not call `exit`).
 *
 * @param {readonly string[]} argv - arguments (without node/script prefix).
 * @param {{ stdout?: { write(s: string): void }, stderr?: { write(s: string): void } }} [io]
 *   injectable streams (defaults to process streams).
 * @returns {number} exit code (0 clean, 1 finding, 2 usage error).
 */
export function main(argv, io = {}) {
  const out = io.stdout ?? process.stdout;
  const err = io.stderr ?? process.stderr;
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (error) {
    // A misspelled flag is the caller's mistake and stays loud in every mode.
    err.write(`error: ${error.message}\n`);
    return 2;
  }
  let scan;
  try {
    scan = collectWorkflows(opts.root);
  } catch (error) {
    // Under --warn this is a repository with nothing to scan, which for a
    // consumer is an ordinary shape rather than a broken invocation.
    err.write(`error: ${error.message}\n`);
    return opts.warn ? 0 : 2;
  }

  let checked = 0;
  let thirdParty = 0;
  const findings = [];
  try {
    for (const file of scan.workflows) {
      const content = fs.readFileSync(path.join(opts.root, file), "utf8");
      for (const reference of findActionRefs(content)) {
        checked += 1;
        if (reference.kind === THIRD_PARTY) thirdParty += 1;
        const verdict = evaluateReference(reference);
        if (verdict !== OK) {
          findings.push({ ...reference, file, verdict });
        }
      }
    }
  } catch (error) {
    err.write(`error: failed to scan workflows: ${error.message}\n`);
    return 2;
  }

  const report = buildReport(findings, {
    checked,
    fixturesSkipped: scan.fixturesSkipped,
    root: opts.root,
    thirdParty,
    workflows: scan.workflows.length,
  });
  out.write(
    `${opts.json ? JSON.stringify(report, null, 2) : humanReport(report)}\n`
  );
  if (report.findings.length === 0) {
    return 0;
  }
  if (opts.warn) {
    out.write(
      "\nReporting only: this check is not blocking here. Nothing above stops " +
        "a build.\nRun `npx @codyswann/lisa@latest .` to pin these " +
        "references, then re-run.\n"
    );
    return 0;
  }
  return 1;
}

if (invokedAsScript(import.meta.url)) {
  // exitCode (not process.exit): when stdout is a pipe, writes are async and
  // process.exit() truncates the report mid-flush.
  process.exitCode = main(process.argv.slice(2));
}

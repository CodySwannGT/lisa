#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.
/**
 * Report remote branches carrying work that was pushed and never submitted
 * (issue #3446).
 *
 * ## The state this exists for
 *
 * `lisa-git-submit-pr` lists **Push** and **PR Management** as separate steps
 * with nothing binding them: no atomicity, no post-condition, no terminal check
 * that a pull request exists when the flow ends. An agent that stops between
 * them — context exhaustion, a turn limit, an interruption, a refused call —
 * leaves a branch on the remote carrying finished work that is in no review, no
 * CI run, and no report.
 *
 * The skill's own `Never` list contained the rule for exactly this pair of
 * steps, pointing the other way: *"skip pushing before PR creation"* forbids a
 * PR without a push. Push without a PR was unprohibited and undetected.
 *
 * **The last signal such an agent receives is green.** The pre-push hook prints
 * `no pull request exists yet, so gates 4 and 5 could not be checked here — CI
 * will verify both`, which is accurate and reads as an informational pass.
 * Downstream the silence holds: the work item keeps its in-progress role, so
 * intake will not re-dispatch it, and nothing counts a branch without a pull
 * request. The state is unreachable by every other check.
 *
 * Measured when this was written: 15 such branches in one repository, roughly
 * 12,900 insertions, every one dated within a single day. Fifteen simultaneous
 * stops at the same step is not fifteen coincidences.
 *
 * ## What it reports, and what it deliberately does not
 *
 * Reported: a remote branch **ahead** of the default branch, with **no** pull
 * request of any state.
 *
 * A branch level with the default branch has nothing to submit. A branch whose
 * pull request already MERGED is an un-deleted leftover, not lost work — and
 * keying on "no OPEN pull request" instead would report every such branch in
 * the repository. Both exclusions exist because a check that reports everything
 * is one nobody reads, which is the same outcome as no check at all.
 *
 * ## The work item is resolved BEFORE the branch (issue #3904)
 *
 * Every signal above is a property of the **copy**: ahead, unpushed, untracked,
 * stale. None of them says whether the **work** survived, and that is only
 * visible in the tracker. Abandonment and uniqueness look identical from inside
 * a checkout, so a report built on branch facts alone reads superseded work as
 * unique — with maximum apparent urgency, because the more thoroughly stranded
 * a branch looks, the more it demands rescue.
 *
 * Measured in this repository: a branch one commit ahead of the default branch,
 * on the remote, with no pull request in any state — the textbook "just open
 * the PR" recovery. Its work item was CLOSED; the behaviour had already shipped
 * from a sibling item through a different merged pull request. Opening that PR
 * would have produced a duplicate for a reviewer to work out, and it could not
 * have been landed anyway: the commit gate requires a `Work-Item:` trailer
 * naming a **live** item, so the only routes left are a refusal or retro-fitted
 * attribution — which is falsified provenance, not a recovery.
 *
 * So the tracker is asked first and the verdict is the tracker's:
 * `superseded` (item closed — preserve, never promote), `unsubmitted` (item
 * live — this really is work awaiting a pull request), or `unresolved` (no item
 * could be resolved, which is reported as its own outcome and never folded into
 * either of the other two).
 *
 * ## Which side is ahead is measured, never inferred from the diff
 *
 * The sharpest case in the same sweep: a branch whose subjects were all absent
 * from the default branch, reading as dozens of stranded commits, whose pull
 * request had in fact merged days after the local ref last moved. It was
 * stale-**behind**, not ahead, and its `git diff` was symmetric and enormous
 * because it predated a large amount of the base. **A conflict resolution that
 * takes the branch side there deletes everything the base gained** — the
 * reading that feels like rescue is the one that destroys. Every candidate
 * therefore carries a two-sided `--left-right` count, so the direction is a
 * number that was read rather than an impression formed from a diff.
 *
 * Determinism: Node built-ins only, no `Date`, no `Math.random`. Branch,
 * pull-request and work-item facts come from `git` and `gh`; with neither
 * available the script reports that it could not look rather than that it found
 * nothing.
 * @module check-orphaned-branches
 */

import { spawnSync } from "node:child_process";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/** Branch name prefixes that are never work-in-flight. */
const IGNORED_PREFIXES = Object.freeze(["backup/", "gh-readonly-queue/"]);

/** Exit codes. `FOUND` is advisory by default; see `--fail-on-found`. */
const EXIT = Object.freeze({ OK: 0, FOUND: 1, UNAVAILABLE: 70 });

/**
 * What the tracker says about the work, which is what decides the verdict.
 *
 * `UNRESOLVED` is a third outcome and not a shade of the other two. A branch
 * whose item could not be resolved has not been cleared and has not been
 * condemned — reporting it as either would be the vacuous pass this file's
 * family exists to refuse.
 */
const VERDICT = Object.freeze({
  SUPERSEDED: "superseded",
  UNRESOLVED: "unresolved",
  UNSUBMITTED: "unsubmitted",
});

/**
 * Where a work-item reference came from, which changes how much it is worth.
 *
 * A `Work-Item:` trailer is the canonical binding the commit gate itself reads.
 * A number lifted from a branch name is an inference — `chore/bump-node-22`
 * names no work item — so a verdict resting on one is printed with its source
 * attached, and the reader is told to confirm before acting on it.
 */
const REF_SOURCE = Object.freeze({ NAME: "branch name", TRAILER: "trailer" });

/**
 * A work-item reference inside one `/`-separated branch-name segment.
 *
 * Anchored, and deliberately narrow. Measured against the real branch list, a
 * loose "first run of digits anywhere" rule invented references out of
 * `chore/lisa-update-fixes-2026-04-12` (the year) and
 * `claude/wonderful-vaughan-61d007` (a hex suffix), then reported a confident
 * verdict on each. A missed reference degrades to `unresolved`, which is loud
 * and safe; an invented one produces a wrong ruling that reads exactly like a
 * right one, so the trade is taken deliberately in that direction.
 *
 * Accepts `3604-…`, `wi3791`, `issue-1423-…`, `worktree-issues-1055`. The
 * trailing `(?![0-9a-z])` is what rejects `61d007`.
 */
const REF_IN_SEGMENT = /^(?:[a-z]+-)*[a-z]{0,4}(\d{2,})(?![0-9a-z])/u;

/** A work-item reference inside a `Work-Item:` trailer value. */
const REF_IN_TRAILER = /(?:^|\D)(\d{2,})/u;

/** `20260904`: a compact `yyyymmdd` date, never a work item. */
const COMPACT_DATE = /^20\d{6}$/u;

/** A bare year, which is a date only when a `-04-12` follows it. */
const YEAR = /^20\d{2}$/u;

/** The separator that turns a bare year into a date. */
const DATE_TAIL = /^-\d{2}/u;

/**
 * Run a command and return its trimmed stdout, or undefined on any failure.
 *
 * Undefined means "could not look", never "looked and found nothing" — the two
 * are reported differently, because a check that turns a broken command into a
 * clean result is the vacuous-success failure this file's family exists to
 * refuse.
 * @param {string} command Executable name.
 * @param {string[]} args Arguments.
 * @returns {string | undefined} Trimmed stdout, or undefined.
 */
function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  // probe-direction: fail-closed — every caller of this helper refuses on
  // undefined (`EXIT.UNAVAILABLE`, "This is NOT a clean result") instead of
  // reporting a clean tree, so losing the answer costs a refusal, never a
  // missed orphan.
  if (result.error || result.status !== 0) return undefined;
  return result.stdout.trim();
}

/**
 * The repository's default branch, as the remote reports it.
 * @param {string} remote Remote name.
 * @returns {string | undefined} Short branch name, or undefined.
 */
export function defaultBranch(remote = "origin") {
  const symref = run("git", [
    "symbolic-ref",
    "--quiet",
    `refs/remotes/${remote}/HEAD`,
  ]);
  return symref?.startsWith(`refs/remotes/${remote}/`)
    ? symref.slice(`refs/remotes/${remote}/`.length)
    : undefined;
}

/**
 * Every branch name that has a pull request, in any state.
 *
 * Any state, not just OPEN. A branch whose pull request merged is a leftover
 * ref, not unsubmitted work, and reporting it would bury the real findings
 * under every branch nobody deleted.
 * @returns {Set<string> | undefined} Branch names, or undefined if `gh` failed.
 */
export function branchesWithPullRequests() {
  const json = run("gh", [
    "pr",
    "list",
    "--state",
    "all",
    "--limit",
    "1000",
    "--json",
    "headRefName",
  ]);
  if (json === undefined) return undefined;
  try {
    const rows = JSON.parse(json);
    return new Set(
      Array.isArray(rows)
        ? rows
            .map(row => row?.headRefName)
            .filter(name => typeof name === "string")
        : []
    );
  } catch {
    // probe-direction: fail-closed — unparseable output is not an empty pull-
    // request set. `main` turns undefined into EXIT.UNAVAILABLE, so a branch is
    // never called orphaned because the listing could not be read.
    return undefined;
  }
}

/**
 * Remote branches ahead of the default branch, with their commit counts.
 * @param {string} remote Remote name.
 * @param {string} base Default branch name.
 * @returns {ReadonlyArray<{branch: string, ahead: number}> | undefined} Rows.
 */
export function branchesAhead(remote = "origin", base = "main") {
  const listed = run("git", [
    "for-each-ref",
    "--format=%(refname:strip=3)",
    `refs/remotes/${remote}`,
  ]);
  if (listed === undefined) return undefined;
  const rows = [];
  for (const branch of listed.split("\n").map(line => line.trim())) {
    if (!branch || branch === base || branch === "HEAD") continue;
    if (IGNORED_PREFIXES.some(prefix => branch.startsWith(prefix))) continue;
    const count = run("git", [
      "rev-list",
      "--count",
      `${remote}/${base}..${remote}/${branch}`,
    ]);
    const ahead = Number.parseInt(count ?? "", 10);
    if (Number.isFinite(ahead) && ahead > 0) rows.push({ ahead, branch });
  }
  return rows;
}

/**
 * The work-item reference a branch is bound to, and how strongly.
 *
 * The trailer is asked first because it is the same binding the commit gate
 * enforces. It is routinely absent — the branch that motivated this check
 * carried no trailer at all — so the branch name is the fallback, reported as
 * an inference rather than as a fact.
 * @param {string} branch Short branch name.
 * @param {string} base Default branch name.
 * @param {string} remote Remote name.
 * @param {typeof run} exec Command runner.
 * @returns {{ref: string, refSource: string} | undefined} The reference.
 */
export function workItemRef(branch, base, remote = "origin", exec = run) {
  const trailers = exec("git", [
    "log",
    "--format=%(trailers:key=Work-Item,valueonly,separator=%x2C)",
    `${remote}/${base}..${remote}/${branch}`,
  ]);
  const fromTrailer = trailers
    ?.split(/[\n,]/u)
    .map(value => value.trim())
    .find(value => value.length > 0);
  if (fromTrailer) {
    const digits = REF_IN_TRAILER.exec(fromTrailer);
    if (digits) return { ref: digits[1], refSource: REF_SOURCE.TRAILER };
  }
  const fromName = refInBranchName(branch);
  return fromName ? { ref: fromName, refSource: REF_SOURCE.NAME } : undefined;
}

/**
 * The work-item number a branch NAME suggests, if any.
 *
 * Segment-anchored, and dates are refused outright — see `REF_IN_SEGMENT`.
 * @param {string} branch Short branch name.
 * @returns {string | undefined} The number, as written.
 */
export function refInBranchName(branch) {
  for (const segment of branch.split("/")) {
    const matched = REF_IN_SEGMENT.exec(segment);
    if (!matched) continue;
    const [whole] = matched;
    const number = matched[1];
    if (COMPACT_DATE.test(number)) continue;
    if (YEAR.test(number) && DATE_TAIL.test(segment.slice(whole.length)))
      continue;
    return number;
  }
  return undefined;
}

/**
 * The merged pull request that carried a work item, when one can be named.
 *
 * Two routes, and they are not equally strong. `closedByPullRequestsReferences`
 * is the tracker's own answer. When it is empty — which is exactly what
 * supersession by a SIBLING item looks like — a merged pull request mentioning
 * the reference is a candidate the reader is asked to verify, never a
 * conclusion. Naming it is the whole point: "superseded" with no route attached
 * is a classification the reader has to take on trust.
 * @param {string} ref Work-item reference.
 * @param {typeof run} exec Command runner.
 * @returns {string | undefined} The pull request, prefixed with `#`.
 */
export function mergedRoute(ref, exec = run) {
  const closedBy = exec("gh", [
    "issue",
    "view",
    ref,
    "--json",
    "closedByPullRequestsReferences",
  ]);
  const direct =
    parseJson(closedBy)?.closedByPullRequestsReferences?.[0]?.number;
  if (direct) return `#${direct}`;
  const searched = exec("gh", [
    "pr",
    "list",
    "--state",
    "merged",
    "--search",
    ref,
    "--limit",
    "1",
    "--json",
    "number",
  ]);
  const candidate = parseJson(searched)?.[0]?.number;
  return candidate ? `#${candidate}` : undefined;
}

/**
 * What the tracker said about one branch's work item.
 * @typedef {object} WorkItem
 * @property {string} ref The item, as `#1234`.
 * @property {string} state The tracker's own state string.
 * @property {string} [refSource] One of `REF_SOURCE`; absent when the caller does not track it.
 * @property {string} [route] The merged pull request the work reached the base through.
 */

/** @typedef {{baseAhead: number, branchAhead: number}} Divergence */

/**
 * One reported branch, with the tracker's verdict on whether its work survived.
 * @typedef {object} Candidate
 * @property {number} ahead Commits ahead of the base.
 * @property {boolean} [baseLeads] Whether the base has moved; undefined when unmeasured.
 * @property {string} branch Short branch name.
 * @property {Divergence} [divergence] The two-sided count, when it was taken.
 * @property {string} [ref] The work item, as `#1234`.
 * @property {string} [refSource] Where the reference came from.
 * @property {string} [route] The merged pull request that carried the work.
 * @property {string} [state] The tracker's state for the item.
 * @property {string} verdict One of `VERDICT`.
 */

/**
 * Parse JSON, returning undefined rather than throwing.
 * @param {string | undefined} text Candidate JSON.
 * @returns {any} The parsed value, or undefined.
 */
function parseJson(text) {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The tracker's state for each candidate branch, keyed by branch.
 *
 * A branch missing from the returned map is one whose item could not be
 * resolved. That is reported as `unresolved`, not as clean.
 * @param {ReadonlyArray<string>} branches Candidate branch names.
 * @param {string} base Default branch name.
 * @param {string} remote Remote name.
 * @param {typeof run} exec Command runner.
 * @returns {Map<string, WorkItem>} States, keyed by branch.
 */
export function workItemStates(branches, base, remote = "origin", exec = run) {
  const states = new Map();
  for (const branch of branches) {
    const found = workItemRef(branch, base, remote, exec);
    if (!found) continue;
    const view = parseJson(
      exec("gh", ["issue", "view", found.ref, "--json", "number,state,url"])
    );
    if (typeof view?.state !== "string") continue;
    // `gh issue view <n>` resolves a PULL REQUEST number just as happily as an
    // issue number, and returns `MERGED` for it. Measured: a number lifted from
    // a branch name landed on a pull request, which was then read as a closed
    // work item and reported as proof the work had shipped. The url is the only
    // field that separates the two.
    if (typeof view.url === "string" && view.url.includes("/pull/")) continue;
    const entry = {
      ref: `#${view.number ?? found.ref}`,
      refSource: found.refSource,
      state: view.state,
    };
    if (view.state !== "OPEN") {
      const route = mergedRoute(found.ref, exec);
      // A work item is not its own route. The search below matches the
      // reference itself, so without this the report claims a superseded item
      // "reached main through" the very number under discussion.
      if (route && route !== entry.ref) entry.route = route;
    }
    states.set(branch, entry);
  }
  return states;
}

/**
 * How far each side has moved since the branches parted, keyed by branch.
 *
 * `--left-right` against the merge base, so the two counts are independent.
 * `rev-list --count base..branch` alone — what the ahead collector uses to find
 * candidates — cannot distinguish a branch carrying new work from one that
 * merely predates a large amount of the base.
 * @param {ReadonlyArray<string>} branches Candidate branch names.
 * @param {string} base Default branch name.
 * @param {string} remote Remote name.
 * @param {typeof run} exec Command runner.
 * @returns {Map<string, Divergence>} Counts, keyed by branch.
 */
export function divergences(branches, base, remote = "origin", exec = run) {
  const counts = new Map();
  for (const branch of branches) {
    const measured = exec("git", [
      "rev-list",
      "--left-right",
      "--count",
      `${remote}/${base}...${remote}/${branch}`,
    ]);
    const [left, right] = (measured ?? "")
      .split(/\s+/u)
      .map(value => Number.parseInt(value, 10));
    if (Number.isFinite(left) && Number.isFinite(right))
      counts.set(branch, { baseAhead: left, branchAhead: right });
  }
  return counts;
}

/**
 * Branches carrying commits that no pull request has ever covered, each with
 * the tracker's verdict on whether the WORK survived.
 *
 * The branch facts narrow the field; the work item decides. A superseded row is
 * still returned — suppressing it would hide the very finding that stops a
 * duplicate pull request — but it is returned labelled.
 * @param {object} inputs Inputs.
 * @param {ReadonlyArray<{branch: string, ahead: number}>} inputs.ahead Branches ahead of base.
 * @param {Set<string>} inputs.submitted Branch names that have a pull request.
 * @param {Map<string, WorkItem>} [inputs.items] Work-item states by branch.
 * @param {Map<string, Divergence>} [inputs.divergence] Two-sided counts by branch.
 * @returns {ReadonlyArray<Candidate>} The candidates, each carrying a verdict.
 */
export function orphanedBranches({
  ahead,
  divergence = new Map(),
  items = new Map(),
  submitted,
}) {
  return ahead
    .filter(row => !submitted.has(row.branch))
    .map(row => {
      const item = items.get(row.branch);
      const sides = divergence.get(row.branch);
      return {
        ahead: row.ahead,
        // Undefined, deliberately, when the direction was never measured. A
        // `false` here would assert that the base does not lead, which is a
        // claim nothing checked.
        baseLeads: sides ? sides.baseAhead > 0 : undefined,
        branch: row.branch,
        divergence: sides,
        ref: item?.ref,
        refSource: item?.refSource,
        route: item?.route,
        state: item?.state,
        verdict: verdictFor(item),
      };
    });
}

/**
 * The verdict a work-item state earns.
 * @param {{state: string} | undefined} item The tracker's answer, if any.
 * @returns {string} One of `VERDICT`.
 */
function verdictFor(item) {
  if (!item) return VERDICT.UNRESOLVED;
  return item.state === "OPEN" ? VERDICT.UNSUBMITTED : VERDICT.SUPERSEDED;
}

/**
 * Report orphaned branches.
 * @param {string[]} argv Arguments.
 * @returns {number} Exit code.
 */
export function main(argv = process.argv.slice(2), probe = {}) {
  const {
    collectAhead = branchesAhead,
    collectDivergence = divergences,
    collectSubmitted = branchesWithPullRequests,
    collectWorkItems = workItemStates,
    log = console.log,
    resolveDefaultBranch = defaultBranch,
    warn = console.error,
  } = probe;
  const remote = "origin";
  const base = resolveDefaultBranch(remote);
  if (!base) {
    warn(
      "check-orphaned-branches: could not resolve the remote default branch, so nothing was checked. This is NOT a clean result."
    );
    return EXIT.UNAVAILABLE;
  }
  const ahead = collectAhead(remote, base);
  const submitted = collectSubmitted();
  if (ahead === undefined || submitted === undefined) {
    warn(
      `check-orphaned-branches: could not read ${ahead === undefined ? "branches" : "pull requests"}, so nothing was checked. This is NOT a clean result.`
    );
    return EXIT.UNAVAILABLE;
  }
  const candidates = ahead
    .filter(row => !submitted.has(row.branch))
    .map(row => row.branch);
  if (candidates.length === 0) {
    log(
      `check-orphaned-branches: every remote branch ahead of ${base} has a pull request.`
    );
    return EXIT.OK;
  }
  // The tracker is asked BEFORE anything is classified, because the branch
  // facts above cannot tell abandonment from uniqueness and the tracker can.
  const orphans = orphanedBranches({
    ahead,
    divergence: collectDivergence(candidates, base, remote),
    items: collectWorkItems(candidates, base, remote),
    submitted,
  });
  log(
    `check-orphaned-branches: work item resolved before branch state, for ${orphans.length} branch(es) ahead of ${base} with no pull request.\n`
  );
  const sorted = [...orphans].sort((a, b) => a.branch.localeCompare(b.branch));
  for (const section of SECTIONS) {
    const rows = sorted.filter(row => row.verdict === section.verdict);
    if (rows.length === 0) continue;
    log(`${section.heading}\n`);
    for (const row of rows)
      for (const line of section.render(row, base)) log(line);
    log("");
  }
  return argv.includes("--fail-on-found") ? EXIT.FOUND : EXIT.OK;
}

/**
 * How each verdict is written up.
 *
 * Advice is scoped to its own section rather than gathered into one closing
 * paragraph, because the closing paragraph is what told an operator to open a
 * pull request for work that had already shipped. A superseded candidate must
 * be able to appear in this report without the words "open a pull request"
 * appearing anywhere near it.
 */
const SECTIONS = Object.freeze([
  Object.freeze({
    heading:
      "  SUPERSEDED — the work item is closed. The work reached the base by another route.\n" +
      "  Preserve these; do not promote them. The branch on the remote IS the durable copy:\n" +
      "  it is not deleted here, and it must not be committed, pushed further, or opened as a\n" +
      "  pull request. The commit gate would refuse it anyway — it requires a Work-Item trailer\n" +
      "  naming a LIVE item — and the only way around that refusal is to retro-fit attribution\n" +
      "  to an unrelated open item, which falsifies the commit's provenance.",
    render: renderRow,
    verdict: VERDICT.SUPERSEDED,
  }),
  Object.freeze({
    heading:
      "  UNSUBMITTED — the work item is live. This is real work in no review, no CI run and no\n" +
      "  report, drifting from the base until it is submitted. Open a pull request for each.",
    render: renderRow,
    verdict: VERDICT.UNSUBMITTED,
  }),
  Object.freeze({
    heading:
      "  UNRESOLVED — no work item could be resolved for these, so nothing is known about\n" +
      "  whether the work survived. This is NOT a clean result and NOT a licence to act:\n" +
      "  resolve the item by hand before deciding anything about the branch.",
    render: renderRow,
    verdict: VERDICT.UNRESOLVED,
  }),
]);

/**
 * One candidate, written out.
 * @param {Candidate} row A row from `orphanedBranches`.
 * @param {string} base Default branch name.
 * @returns {ReadonlyArray<string>} Lines to print.
 */
function renderRow(row, base) {
  const item = row.ref
    ? `${row.ref} ${row.state}${row.refSource === REF_SOURCE.NAME ? " (reference inferred from the branch name — confirm it before acting)" : ""}`
    : "no work item resolved (no Work-Item trailer, no reference in the branch name)";
  const lines = [`    ${row.branch} — ${item}`];
  if (row.route)
    lines.push(`      the work reached ${base} through ${row.route}`);
  lines.push(
    `      ${row.ahead} commit(s) ahead of ${base}${direction(row, base)}`
  );
  return lines;
}

/**
 * The conflict-direction clause for one candidate.
 *
 * Says nothing reassuring when nothing was measured. An unmeasured direction
 * reported as "the base does not lead" is exactly the false all-clear that
 * makes a branch-side resolution look safe.
 * @param {Candidate} row A row from `orphanedBranches`.
 * @param {string} base Default branch name.
 * @returns {string} The clause, empty when there is nothing to say.
 */
function direction(row, base) {
  if (row.baseLeads === undefined)
    return "; direction NOT measured — establish which side leads before resolving any conflict";
  if (!row.baseLeads) return `; ${base} has not moved since they parted`;
  return (
    `; ${base} leads by ${row.divergence.baseAhead} commit(s) — ` +
    "do NOT take the branch side in any conflict here, it would delete what the base gained"
  );
}

if (invokedAsScript(import.meta.url)) {
  // exitCode (not process.exit): when stdout is a pipe, writes are async and
  // process.exit() truncates the report mid-flush.
  process.exitCode = main(process.argv.slice(2));
}

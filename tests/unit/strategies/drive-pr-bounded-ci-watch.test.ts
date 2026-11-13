/**
 * Regression tests for CodySwannGT/lisa#4608: `lisa-drive-pr-to-merge` must
 * name ONE way to wait on CI, and that way must be bounded and in the
 * foreground.
 *
 * Before this change the watch loop polled the PR state but never said how to
 * wait between polls. Agents filled the gap themselves — a backgrounded
 * `gh pr checks --watch`, a sleep loop, a harness background task — and those
 * stall silently, die with the session, or let the session end while required
 * checks are still pending, so a later CI failure reaches nobody.
 *
 * The contract asserted here:
 *   1. section 2 instructs a bounded blocking watch (`gh pr checks <pr>
 *      --required --watch --interval ... --fail-fast` under a timeout), followed
 *      by a full re-poll, repeated until a terminal or actionable state;
 *   2. the skill explicitly forbids detached/background watchers, and no line
 *      anywhere in the file actually starts one;
 *   3. a run that spends its budget with checks pending records the PR, head
 *      SHA and pending checks and ends with an explicit `CI PENDING` line —
 *      never success.
 *
 * Headings are matched with a leading newline because several section headings
 * are also quoted inline elsewhere; an unanchored search can slice the wrong
 * range and pass on an empty string. Every generated plugin root is asserted so
 * a missed `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/drive-pr-bounded-ci-watch
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-devin/skills",
  "plugins/lisa/.codex-plugin/skills",
] as const;

const readSkill = (root: string): string =>
  readFileSync(
    path.resolve(root, "lisa-drive-pr-to-merge", "SKILL.md"),
    "utf8"
  );

/**
 * Slice a document between two line-anchored headings.
 * @param content - Whole skill text
 * @param from - Heading that opens the range, including its leading newline
 * @param to - Heading that closes the range, or undefined for end of document
 * @returns The text from `from` up to (not including) `to`
 */
const slice = (content: string, from: string, to?: string): string => {
  const start = content.indexOf(from);
  const end = to === undefined ? content.length : content.indexOf(to, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return content.slice(start, end);
};

/**
 * Lines of every fenced code block in the document — the text an agent would
 * copy and run, as opposed to prose that names a command to forbid it.
 * @param content - Whole skill text
 * @returns Each line that sits inside a ``` fence
 */
const fencedLines = (content: string): readonly string[] =>
  content
    .split("\n")
    .reduce<{ readonly inFence: boolean; readonly lines: readonly string[] }>(
      (acc, line) =>
        line.trimStart().startsWith("```")
          ? { inFence: !acc.inFence, lines: acc.lines }
          : {
              inFence: acc.inFence,
              lines: acc.inFence ? [...acc.lines, line] : acc.lines,
            },
      { inFence: false, lines: [] }
    ).lines;

describe.each(ROOTS)("drive-pr-to-merge bounded CI watch (%s)", root => {
  const content = readSkill(root);
  const watchLoop = (): string =>
    slice(content, "\n## 2. The watch loop", "\n## 3. Merge and verify");
  const terminal = (): string => slice(content, "\n## 4. Terminal states");

  // --- Scenario: the skill waits with a bounded blocking watch -------------

  it("instructs a required-checks watch with an interval and fail-fast", () => {
    expect(watchLoop()).toMatch(
      /gh pr checks <pr> --required --watch --interval \d+ --fail-fast/
    );
  });

  it("runs the watch under a timeout bounded by the harness command limit", () => {
    const loop = watchLoop();
    expect(loop).toMatch(/timeout 540 gh pr checks <pr> --required --watch/);
  });

  it("re-polls the full PR state after the watch returns, and repeats", () => {
    const loop = watchLoop();
    const watchAt = loop.indexOf("--required --watch");
    const rePollAt = loop.search(/re-poll the full PR state/i);
    expect(watchAt).toBeGreaterThanOrEqual(0);
    expect(rePollAt).toBeGreaterThan(watchAt);
  });

  it("never reads the watch's exit code as the CI verdict", () => {
    // `gh pr checks` exits non-zero both on a failed check (--fail-fast) and,
    // with empty stdout, when it lacks `actions: read`. Only the re-poll of
    // statusCheckRollup says which one happened.
    const loop = watchLoop();
    expect(loop).toMatch(/statusCheckRollup.{0,40}is the authority/is);
  });

  it("keeps the existing per-iteration rules intact", () => {
    const loop = watchLoop();
    expect(loop).toMatch(
      /gh pr view <pr> --json state,mergeStateStatus,mergeable,reviewDecision,statusCheckRollup/
    );
  });

  it("contains no runnable instruction that starts a background watcher", () => {
    // The one sleep allowed is the bounded foreground gap between re-polls for
    // a head with no checks yet: a single `timeout N gh pr checks ...; sleep N`
    // line. A standalone, looped or backgrounded sleep is still an offender.
    const boundedGap =
      /^\s*timeout \d+ gh pr checks <pr> --watch --interval \d+; sleep \d+\s*$/;
    const lines = fencedLines(content);
    expect(lines.length).toBeGreaterThan(0);
    const offenders = lines.filter(
      line =>
        /&\s*(#.*)?$/.test(line.replace(/&&/g, "")) ||
        /\bnohup\b/.test(line) ||
        /\bsetsid\b/.test(line) ||
        /\bdisown\b/.test(line) ||
        /run_in_background/.test(line) ||
        (/\bsleep\s+\d/.test(line) && !boundedGap.test(line))
    );
    expect(offenders).toEqual([]);
  });

  it("never pairs a watch with backgrounding anywhere in the prose", () => {
    // Prose can instruct too. The prohibition sentence names `&` and `nohup`
    // as bare tokens, so it does not match these command-shaped patterns.
    expect(content).not.toMatch(/--watch[^\n`]*&\s*`?$/m);
    expect(content).not.toMatch(/run_in_background:\s*true/);
  });

  it("mentions background or detached waiting only inside the prohibition", () => {
    // Plain English can instruct as well as a code block can ("start the watch
    // as a background task and check back later"). Every such phrase in the
    // whole file must sit in the one paragraph that forbids it.
    const pStart = content.indexOf(
      "**Never start a detached or background watcher"
    );
    const pEnd = content.indexOf("\n\n", pStart);
    expect(pStart).toBeGreaterThanOrEqual(0);
    const outside = [
      ...content.matchAll(
        /background (task|watcher|job)|detached (watcher|wait|process)/gi
      ),
    ].filter(m => m.index < pStart || m.index > pEnd);
    expect(outside.map(m => m[0])).toEqual([]);
  });

  it("handles a head with no required checks registered yet without spinning", () => {
    const loop = watchLoop();
    expect(loop).toContain("/protection/required_status_checks");
    // A 404 is also what a token without admin gets on a protected branch.
    expect(loop).toContain('branches/<base>" --jq .protected');
    expect(loop).toContain(
      "timeout 60 gh pr checks <pr> --watch --interval 10; sleep 30"
    );
  });

  it("names who completes the work item when a pending PR later merges", () => {
    expect(terminal()).toMatch(
      /left to `lisa-repair-intake`'s\s+merged-PR recovery; re-invoking this skill on the PR also completes them/
    );
  });

  it("records the PR, head SHA and pending checks when the budget runs out", () => {
    const loop = watchLoop();
    // The wake-up for a later failure is E1's re-dispatch, named not rebuilt.
    expect(loop).toContain("[lisa-ci-failed]");
  });

  it("reports CI PENDING, never success, as a terminal state", () => {
    const loop = watchLoop();
    const end = terminal();
    const line = "CI PENDING — <n> required checks still running at <sha>";
    expect(loop).toContain(line);
    expect(end).toContain(line);
  });
});

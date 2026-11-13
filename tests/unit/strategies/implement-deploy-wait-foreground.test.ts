/**
 * Regression tests for CodySwannGT/lisa#4762: `lisa-implement` step 10 must
 * wait on the post-merge deploy in the lead's own foreground.
 *
 * Step 10 used to say only "Monitor the deploy action that triggers
 * automatically from the successful merge". A lead filled the gap by handing
 * the wait to a background agent; that agent wrote its result to its own
 * output, never messaged the lead, and the lead sat idle for ~28 minutes after
 * the deploy had finished. A background task's result reaches only the agent
 * that started it.
 *
 * The step-10 block (from the line starting `10. ` up to the line starting
 * `11. `) is the "step-10 prompt fixture" the issue's regression check names.
 * The contract asserted here, on every generated plugin root so a missed
 * `bun run build:plugins` fails the suite:
 *   1. it forbids a detached or background watcher for the deploy wait;
 *   2. it requires a bounded foreground watch with a stated ceiling that
 *      falls through to step 11;
 *   3. any watcher subagent it mentions must `SendMessage` the lead
 *      when the run succeeds or fails;
 *   4. it never otherwise mentions background waiting — every occurrence sits
 *      inside the prohibition sentence.
 * @module tests/unit/strategies/implement-deploy-wait-foreground
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

const PROHIBITION =
  "Never wait on the deploy with a detached or background watcher";

const readSkill = (root: string): string =>
  readFileSync(path.resolve(root, "lisa-implement", "SKILL.md"), "utf8");

/**
 * Extract the step-10 block: from the line starting `10. ` up to (not
 * including) the line starting `11. `.
 * @param content - Whole skill text
 * @returns The step-10 block text
 */
const stepTen = (content: string): string => {
  const start = content.search(/^10\. /m);
  const rest = start < 0 ? "" : content.slice(start);
  const end = rest.search(/^11\. /m);
  if (start < 0 || end <= 0) {
    throw new Error("lisa-implement SKILL.md has no `10. ` … `11. ` block");
  }
  return rest.slice(0, end);
};

/**
 * Split a block into sentences on a full stop followed by whitespace, or a
 * newline. Good enough for prose; backticked commands carry no `. `.
 * @param block - Text to split
 * @returns Sentence fragments
 */
const sentences = (block: string): readonly string[] =>
  block.split(/(?<=\.)\s+|\n+/).filter(s => s.trim().length > 0);

describe.each(ROOTS)(
  "lisa-implement step 10 foreground deploy wait (%s)",
  root => {
    const block = stepTen(readSkill(root));

    it("keeps the original step's meaning: monitor the post-merge deploy", () => {
      expect(block).toMatch(
        /Monitor the deploy action that triggers automatically from the successful merge/
      );
    });

    it("forbids a detached or background watcher for the deploy wait", () => {
      expect(block).toContain(PROHIBITION);
      for (const named of [
        "`&`",
        "`nohup`",
        "background task",
        "scheduled re-check",
      ]) {
        expect(block).toContain(named);
      }
    });

    it("explains that a background result never reaches the lead", () => {
      expect(block).toMatch(/reaches only the agent that started it/i);
    });

    it("requires a bounded foreground watch with an interval", () => {
      expect(block).toMatch(/bounded foreground watch/i);
      expect(block).toMatch(
        /gh run watch <[^>]+> --interval \d+ --exit-status/
      );
    });

    it("states the watch bound with a fallback where `timeout` is missing", () => {
      // macOS ships no `timeout`; the bound must not depend on it existing.
      expect(block).toMatch(/timeout 540.{0,80}where.{0,40}exists/is);
      expect(block).toMatch(/harness'?s own command timeout/i);
      expect(block).toMatch(/tool call.{0,60}timeout above/is);
      expect(block).toMatch(/600000 ms/);
    });

    it("watches the run step 8 confirmed instead of re-discovering it", () => {
      expect(block).toMatch(/step 8/);
      expect(block).toMatch(/watch the run step 8 confirmed/);
      // No second lookup and no unbounded find-poll loop.
      expect(block).not.toMatch(/gh run list/);
      expect(block).not.toMatch(/no run found within/i);
      // The workflow is never hardcoded.
      expect(block).not.toMatch(/deploy\.ya?ml/);
    });

    it("bounds the wait with an overridable ceiling", () => {
      expect(block).toMatch(/ceiling is 60 minutes/i);
      expect(block).toMatch(/work item/i);
      expect(block).toMatch(/`timeout-minutes`/);
      expect(block).toMatch(
        /concluded unsuccessfully.{0,60}deploy failure.{0,40}step 11/is
      );
    });

    it("never routes a run still in progress at the ceiling to step 11", () => {
      const inProgress = sentences(block).filter(s =>
        /still in progress at the ceiling/i.test(s)
      );
      expect(inProgress.length).toBeGreaterThan(0);
      for (const s of inProgress) {
        expect(s).toMatch(/not a code failure/i);
        expect(s).toMatch(/blocked/i);
        expect(s).toMatch(/never open a fix PR/i);
        expect(s).not.toMatch(/go to step 11/i);
      }
    });

    it("never routes a missing deploy run to step 11", () => {
      // drive-pr-to-merge returns `blocked:deploy` (or, in report mode,
      // `blocked:no-deploy-run`) when NO run fired — there is no code to fix,
      // so a fix PR would be invented work.
      const noRun = sentences(block).filter(s =>
        /`blocked:(deploy|no-deploy-run)`/.test(s)
      );
      expect(noRun.length).toBeGreaterThan(0);
      expect(noRun.join(" ")).toContain("`blocked:no-deploy-run`");
      for (const s of noRun) {
        expect(s).toMatch(/not a code failure/i);
        expect(s).toMatch(/blocked/i);
        expect(s).toMatch(/never open a fix PR/i);
        expect(s).not.toMatch(/go to step 11/i);
      }
    });

    it("says who the lead is, since the skill no longer forms a team", () => {
      expect(block).toMatch(/agent running this flow \(the lead\)/);
    });

    it("cites the drive-pr-to-merge rule by name", () => {
      expect(block).toContain("lisa-drive-pr-to-merge");
    });

    it("pairs any watcher subagent with a SendMessage to the lead", () => {
      const mentions = sentences(block).filter(s =>
        /\b(teammate|subagent|watcher agent)\b/i.test(s)
      );
      expect(mentions.length).toBeGreaterThan(0);
      for (const s of mentions) {
        expect(s).toMatch(/SendMessage/);
        expect(s).toMatch(/\blead\b/);
        expect(s).toMatch(/succeeds or fails|finishes or fails/i);
      }
    });

    it("lets the lead's turn end only to wait for the watcher's message", () => {
      expect(block).toMatch(
        /lead's turn may end only to wait for that message/
      );
    });

    it("mentions background or detached waiting only inside the prohibition", () => {
      // Plain English instructs as well as a command does ("start the watch as
      // a background task and check back later"), so every such word in the
      // step must sit in the sentence that forbids it.
      const pStart = block.indexOf(PROHIBITION);
      expect(pStart).toBeGreaterThanOrEqual(0);
      const why = block.indexOf(
        "reaches only the agent that started it",
        pStart
      );
      expect(why).toBeGreaterThan(pStart);
      const pEnd = block.indexOf(". ", why);
      expect(pEnd).toBeGreaterThan(why);
      const outside = [...block.matchAll(/background|detached|nohup/gi)].filter(
        m => m.index < pStart || m.index > pEnd
      );
      expect(outside.map(m => m[0])).toEqual([]);
    });

    it("never instructs running the deploy watch in the background", () => {
      expect(block).not.toMatch(/gh run watch[^\n`]*&\s*`?/);
      expect(block).not.toMatch(/nohup\s+gh/);
      expect(block).not.toMatch(/run_in_background:\s*true/);
    });

    it("notes the parity gap for runtimes without cross-agent messaging", () => {
      expect(block).toMatch(
        /without cross-agent messaging.{0,120}foreground watch is the only option/is
      );
    });
  }
);

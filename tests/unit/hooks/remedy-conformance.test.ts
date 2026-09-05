/**
 * Every remedy a shipped guard prints must be one this environment permits.
 *
 * #3825: a guard refuses correctly and then hands the operator an instruction
 * that cannot work. Nothing executed a remedy string, so a remedy rotted like a
 * comment — except an agent will act on it, and when the advice gets it
 * refused, the refusal names the guard it OBEYED rather than the advice that
 * sent it there. Three guards, three unrelated authors, before anyone named it.
 *
 * ## What this suite proves, stated precisely
 *
 * **The live sweep passes on the tree as it stands.** Measured while building
 * this: 15 guard refusals, 81 printed commands, all permitted. The three
 * instances the ticket names were each fixed by their own ticket before this
 * one landed. So the sweep is a REGRESSION GUARD, and saying so plainly matters
 * more than manufacturing a red — a suite that only asserts today's remedies
 * pass today pins nothing, which is the ticket's own load-bearing criterion.
 *
 * **The bite direction is what carries the evidence**, and it is exercised
 * here: `widening a guard pattern over a printed remedy turns the sweep red`
 * mutates a guard copy in scratch and asserts the sweep names the remedy and
 * the probe. That is #3825's fourth acceptance scenario.
 * @module tests/unit/hooks/remedy-conformance
 */
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import {
  FORBIDDEN_REMEDY_OPERATIONS,
  classifyRemedy,
  extractRemedyCommands,
  formatRemedyConformanceReport,
  guardChainClassifier,
  remedyConformanceExitCode,
  sweepRemedyConformance,
} from "../../../scripts/remedy-conformance.mjs";

/**
 * A guard chain that permits everything.
 * @returns The exit status of a permitting guard.
 */
const PERMITS = (): number => 0;

/**
 * A guard chain that refuses everything.
 * @returns The exit status of a refusing guard.
 */
const REFUSES = (): number => 2;

/** The shared-stash advisory form, the founding forbidden remedy. */
const STASH_PUSH = "git stash push";

/** The restore step `PRESERVE_GUIDANCE` prints, and the bite check's subject. */
const GIT_APPLY_PATCH = 'git apply "$patch"';

/**
 * Run one guard over a proposed command and return its refusal.
 * @param guard - Path to the guard script.
 * @param command - The proposed shell command.
 * @returns The guard's exit status and refusal text.
 */
function classify(
  guard: string,
  command: string
): { readonly status: number | null; readonly stderr: string } {
  const outcome = boundedSpawnSync({
    label: "parity-safety-net.sh",
    command: "/bin/bash",
    args: [guard],
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
      cwd: process.cwd(),
    }),
    env: process.env,
  });
  return { status: outcome.status, stderr: outcome.stderr ?? "" };
}

describe("remedy conformance (#3825)", () => {
  describe("permission alone is not the check", () => {
    it("flags the shared stash even though the guard chain permits it", () => {
      // The founding instance. `git stash push` exits 0 through
      // parity-safety-net — guard 7 refuses only drop/clear — so a
      // permission-only mechanism would have passed the very advice that
      // motivated the ticket.
      expect(
        classifyRemedy(`${STASH_PUSH} -m preserve`, PERMITS)
      ).toMatchObject({
        verdict: "FORBIDDEN",
        reason: expect.stringContaining("shared-stash"),
      });
    });

    it("leaves a prohibition alone: guard 7's own message must keep saying stash", () => {
      expect(classifyRemedy("git stash drop", PERMITS).verdict).toBe(
        "PERMITTED"
      );
      expect(classifyRemedy("git stash clear", PERMITS).verdict).toBe(
        "PERMITTED"
      );
    });

    it("keys on advisory forms, never the bare token", () => {
      const [sharedStash] = FORBIDDEN_REMEDY_OPERATIONS;
      expect(sharedStash?.advisory.test(STASH_PUSH)).toBe(true);
      expect(sharedStash?.advisory.test("git stash drop")).toBe(false);
    });

    it("still reports a remedy the guard chain refuses", () => {
      expect(
        classifyRemedy("git checkout -- src/index.ts", REFUSES)
      ).toMatchObject({ verdict: "REFUSED" });
    });
  });

  describe("a command the text mentions is not a command it prescribes", () => {
    /** The real sentence, wrapped as the heredoc wraps it. */
    const COMPARISON =
      "the record of what you discarded. Untracked files survive, exactly as they\nsurvive `git reset --hard`.";

    it("does not prescribe a command a comparison merely names", () => {
      const extracted = extractRemedyCommands(COMPARISON);

      expect(extracted.commands).toEqual([]);
      expect(extracted.mentions).toEqual(["git reset --hard"]);
    });

    it("reads across the line break the qualifier is wrapped over", () => {
      // Line-scoped detection missed this: "as they survive" ends one line and
      // the backtick opens the next. This is the case that made the first live
      // run report six false findings.
      expect(COMPARISON.split("\n")[1]).toContain("`git reset --hard`");
      expect(COMPARISON.split("\n")[1]).not.toMatch(/as they survive/);
      expect(extractRemedyCommands(COMPARISON).commands).toEqual([]);
    });

    it("keeps genuine remedies that share a bullet with a negation", () => {
      // Paragraph-scoped detection deleted these three: the bullet opens with
      // "Do not try to reword it" and then names the real routes.
      const bullet =
        "Do not try to reword it; the string is the deliverable. Write the text to " +
        "a file and pass it BY PATH instead: `gh issue comment --body-file f`, " +
        "`gh pr create --body-file f`, `git commit -F f`.";

      expect(extractRemedyCommands(bullet).commands).toEqual([
        "gh issue comment --body-file f",
        "gh pr create --body-file f",
        "git commit -F f",
      ]);
    });

    it("treats an indented code block as an instruction regardless of prose", () => {
      const text = `Never do this, but here is the shape:\n\n  ${GIT_APPLY_PATCH}\n`;

      expect(extractRemedyCommands(text).commands).toEqual([GIT_APPLY_PATCH]);
    });
  });

  describe("examined is not the same answer as conformant", () => {
    it("refuses to call a guard set conformant when a probe read no remedy", () => {
      const sweep = sweepRemedyConformance({
        probes: [
          { label: "refused", refusal: "  git status --short\n" },
          { label: "never refused", refusal: null },
        ],
        permits: PERMITS,
      });

      expect(sweep.verdict).toBe("NOT_MEASURED");
      expect(sweep.verdict).not.toBe("CONFORMING");
      expect(sweep.notExamined).toEqual(["never refused"]);
      expect(sweep.examinedCount).toBe(1);
    });

    it("separates an unrunnable sweep from a conformant one", () => {
      expect(sweepRemedyConformance({}).verdict).toBe("NOT_MEASURED");
      expect(sweepRemedyConformance({}).reasons).toEqual([
        "probe-list-unavailable",
      ]);
    });

    it("counts the mentions it declined to classify", () => {
      const sweep = sweepRemedyConformance({
        probes: [
          {
            label: "one of each",
            refusal: "Never run `git clean -fd`.\n\n  git status --short\n",
          },
        ],
        permits: PERMITS,
      });

      expect(sweep.verdict).toBe("CONFORMING");
      expect(sweep.commandCount).toBe(1);
      expect(sweep.mentionCount).toBe(1);
      expect(formatRemedyConformanceReport(sweep)).toContain(
        "Not classified: 1 command(s)"
      );
    });

    it("never exits 0 on an unmeasured sweep", () => {
      expect(
        remedyConformanceExitCode(
          sweepRemedyConformance({
            probes: [{ label: "p", refusal: "  git status\n" }],
            permits: PERMITS,
          })
        )
      ).toBe(0);
      expect(
        remedyConformanceExitCode(
          sweepRemedyConformance({
            probes: [{ label: "p", refusal: `  ${STASH_PUSH}\n` }],
            permits: PERMITS,
          })
        )
      ).toBe(1);
      expect(remedyConformanceExitCode(sweepRemedyConformance({}))).toBe(2);
    });
  });

  describe("bite: a guard change that breaks a remedy is caught", () => {
    let scratch = "";

    beforeAll(() => {
      scratch = mkdtempSync(path.join(tmpdir(), "remedy-bite-"));
    });

    afterAll(() => {
      if (scratch) rmSync(scratch, { recursive: true, force: true });
    });

    it("widening a guard pattern over a printed remedy turns the sweep red", () => {
      // #3825's fourth acceptance scenario, the one it calls load-bearing.
      // `PRESERVE_GUIDANCE` restores work with `git apply "$patch"` — the route
      // every discard guard now points at, after #3722 replaced the stash
      // advice. Widening a pattern over `git apply` would make that route
      // unfollowable in silence, at the moment an operator is holding the work
      // most worth protecting.
      //
      // The mutant guard is EXECUTED, not simulated. Classifying with a stub
      // that always refuses would prove the sweep reacts to a refusal and say
      // nothing about whether a guard edit produces one.
      const real = path.resolve("plugins/lisa/hooks/parity-safety-net.sh");
      const mutant = path.join(scratch, "parity-safety-net.sh");
      copyFileSync(real, mutant);

      const anchor = 'readonly GIT_CLEAN="${GIT_CMD}clean"';
      const source = readFileSync(mutant, "utf8");
      expect(source).toContain(anchor);
      writeFileSync(
        mutant,
        source.replace(
          anchor,
          `if matches "\${GIT_CMD}"'apply([[:space:]]|$)'; then\n  block "widened by the bite check"\nfi\n${anchor}`
        )
      );

      // The remedy text comes from the real guard's real refusal, so the
      // command under test is one the guard set genuinely prints. The trigger
      // must refuse regardless of repository state: guard 3's `--hard` refusal
      // fires only on a dirty tree, which made an earlier draft of this pass
      // scoped and fail in the push gate.
      const refusal = classify(real, "git checkout -- src/index.ts").stderr;
      expect(refusal).toContain(GIT_APPLY_PATCH);

      const probes = [{ label: "guard 4", refusal }];
      const before = sweepRemedyConformance({
        probes,
        permits: guardChainClassifier(real, process.cwd()),
      });
      const after = sweepRemedyConformance({
        probes,
        permits: guardChainClassifier(mutant, process.cwd()),
      });

      expect(before.verdict).toBe("CONFORMING");
      expect(after.verdict).toBe("UNFOLLOWABLE_REMEDIES");
      expect(after.findings.map(finding => finding.command)).toContain(
        GIT_APPLY_PATCH
      );
      expect(after.findings[0]?.probe).toBe("guard 4");
      expect(formatRemedyConformanceReport(after)).toContain("[guard 4]");
    });
  });

  it("declares its fail direction in the report, findings and blindness apart", () => {
    const findings = sweepRemedyConformance({
      probes: [{ label: "p", refusal: `  ${STASH_PUSH}\n` }],
      permits: PERMITS,
    });
    const blind = sweepRemedyConformance({
      probes: [{ label: "p", refusal: null }],
      permits: PERMITS,
    });

    expect(findings.reportOnly).toBe(true);
    expect(blind.reportOnly).toBe(true);
    expect(formatRemedyConformanceReport(blind)).toContain(
      "not a conformant guard set"
    );
    expect(process.cwd()).toBeTruthy();
  });
});

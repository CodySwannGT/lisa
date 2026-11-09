/**
 * The prover's `--publish` mode: the verdict a run judged, published as a
 * check run on the head it judged (CodySwannGT/lisa#4630).
 *
 * The evidence workflow runs from the default branch on `status` and
 * `check_run` events, so its own check run lands on the default branch's
 * latest commit and no pull request ever shows the verdict. The workflow now
 * saves the prover's JSON verdict and its exit code, and this mode turns them
 * into one check run on the head — or into nothing, said out loud, when there
 * is no head to show it on or the run cannot change the answer. Broken
 * machinery fails the mode, so it still shows on the job.
 * @module tests/unit/scripts/third-party-review-evidence-publish
 */
import { describe, expect, it } from "vitest";

import {
  EVIDENCE_OUTCOMES,
  fencedReport,
  main,
} from "../../../all/copy-overwrite/scripts/check-third-party-review-evidence.mjs";

const HEAD = "a".repeat(40);
const CONTEXT = "Example Reviewer";
const VERDICT_FILE = "/runner/temp/verdict.json";

/** What one publish run did. */
interface PublishRun {
  readonly code: number;
  readonly out: string;
  readonly err: string;
  readonly summary: string;
  readonly posted: ReadonlyArray<{ args: string[]; body: unknown }>;
}

/**
 * Run `--publish` once against a saved verdict.
 * @param options - The saved verdict and how the run is woken
 * @param options.verdict - The verdict JSON text the prover step saved
 * @param options.proverExit - The prover step's exit code
 * @param options.context - The reviewer that woke the run, if any
 * @param options.refuse - A refusal for GitHub to answer the write with
 * @returns The run
 */
function publish({
  verdict,
  proverExit = "0",
  context = CONTEXT,
  refuse,
}: {
  verdict: string;
  proverExit?: string;
  context?: string;
  refuse?: string;
}): PublishRun {
  const out: string[] = [];
  const err: string[] = [];
  const summary: string[] = [];
  const posted: Array<{ args: string[]; body: unknown }> = [];
  const code = main(
    [
      `--publish=${VERDICT_FILE}`,
      `--prover-exit=${proverExit}`,
      `--sha=${HEAD}`,
      `--context=${context}`,
      "--repo=acme/code",
    ],
    {
      readFile: (file: string) => {
        if (file !== VERDICT_FILE) throw new Error(`unexpected read ${file}`);
        return verdict;
      },
      gh: (args: string[], input: string) => {
        posted.push({ args, body: JSON.parse(input) });
        if (refuse !== undefined) throw new Error(refuse);
        return '{"id": 1}';
      },
      appendSummary: (text: string) => {
        summary.push(text);
      },
      out: {
        write: (text: string) => {
          out.push(text);
        },
      },
      err: {
        write: (text: string) => {
          err.push(text);
        },
      },
    }
  );
  return {
    code,
    out: out.join(""),
    err: err.join(""),
    summary: summary.join(""),
    posted,
  };
}

/**
 * A saved verdict for one outcome.
 * @param outcome - The outcome
 * @returns Its JSON text, as `--json` writes it
 */
const saved = (outcome: string) =>
  JSON.stringify({ outcome, sha: HEAD, readings: [] });

describe("--publish", () => {
  it.each([
    [EVIDENCE_OUTCOMES.satisfied, "0", "success"],
    [EVIDENCE_OUTCOMES.substituted, "0", "success"],
    [EVIDENCE_OUTCOMES.unsatisfied, "1", "failure"],
    [EVIDENCE_OUTCOMES.pullRequestsUnreadable, "1", "failure"],
  ])(
    "publishes %s on the head it judged as %s→%s and exits 0",
    (outcome, proverExit, conclusion) => {
      const run = publish({ verdict: saved(outcome), proverExit });

      expect(run.code).toBe(0);
      expect(run.posted).toHaveLength(1);
      expect(run.posted[0]?.args).toEqual([
        "api",
        "repos/acme/code/check-runs",
        "--method",
        "POST",
        "--input",
        "-",
      ]);
      expect(run.posted[0]?.body).toMatchObject({
        name: `🕵️ Third-party review evidence (${CONTEXT})`,
        head_sha: HEAD,
        status: "completed",
        conclusion,
      });
    }
  );

  it("titles the check run with the report's first line and summarises it with the fenced report", () => {
    const run = publish({ verdict: saved(EVIDENCE_OUTCOMES.substituted) });
    const fenced = `\`\`\`text\nSUBSTITUTED at ${HEAD}\n\n\`\`\``;

    expect(run.posted[0]?.body).toMatchObject({
      output: { title: `SUBSTITUTED at ${HEAD}`, summary: fenced },
    });
    expect(run.summary).toContain(fenced);
  });

  it("keeps a long report's fence closed inside GitHub's summary limit", () => {
    const verdict = JSON.stringify({
      outcome: EVIDENCE_OUTCOMES.unsatisfied,
      sha: HEAD,
      readings: [
        {
          context: CONTEXT,
          reviewed: false,
          reading: "unrecognised",
          observed: "x".repeat(70_000),
          state: "success",
        },
      ],
    });

    const summary = String(
      (
        publish({ verdict, proverExit: "1" }).posted[0]?.body as {
          output: { summary: string };
        }
      ).output.summary
    );

    expect(summary.length).toBeLessThanOrEqual(65_535);
    expect(summary.startsWith(`\`\`\`text\nUNSATISFIED at ${HEAD}`)).toBe(true);
    expect(summary.endsWith("\n```")).toBe(true);
  });

  it("fences a report whole when no limit applies, and cuts only the report under one", () => {
    expect(fencedReport("a\nb")).toBe("```text\na\nb\n```");
    expect(fencedReport("abcdef", 15)).toBe("```text\nabc\n```");
  });

  it("names the manual path's check run without a reviewer", () => {
    const run = publish({
      verdict: saved(EVIDENCE_OUTCOMES.satisfied),
      context: "",
    });

    expect(run.posted[0]?.body).toMatchObject({
      name: "🕵️ Third-party review evidence",
    });
  });

  it.each([
    [EVIDENCE_OUTCOMES.noReviewerConfigured, "no third-party reviewer"],
    [EVIDENCE_OUTCOMES.notAConfiguredReviewer, "cannot change the answer"],
    [EVIDENCE_OUTCOMES.notAPullRequestHead, "no pull request head"],
    [EVIDENCE_OUTCOMES.pending, "has not answered yet"],
  ])("publishes nothing for %s, and says why", (outcome, why) => {
    const run = publish({ verdict: saved(outcome) });

    expect(run.code).toBe(0);
    expect(run.posted).toEqual([]);
    expect(run.out).toContain("Nothing published");
    expect(run.out).toContain(why);
  });

  it.each([
    ["a usage error", "2"],
    ["a crash", "134"],
    ["no exit code at all", ""],
  ])(
    "fails, publishing nothing, when the prover ended in %s",
    (_name, proverExit) => {
      const run = publish({
        verdict: saved(EVIDENCE_OUTCOMES.satisfied),
        proverExit,
      });

      expect(run.code).toBe(1);
      expect(run.posted).toEqual([]);
      expect(run.err).toContain("exited");
    }
  );

  it.each([
    ["nothing", ""],
    ["text that is not JSON", "Error: boom"],
    ["JSON with no outcome", "{}"],
    ["an outcome nothing here knows", saved("maybe")],
    [
      "a verdict about another commit",
      saved("satisfied").replace(HEAD, "b".repeat(40)),
    ],
  ])(
    "fails, publishing nothing, when the saved verdict is %s",
    (_name, verdict) => {
      const run = publish({ verdict });

      expect(run.code).toBe(1);
      expect(run.posted).toEqual([]);
    }
  );

  it("fails when the exit code contradicts the verdict it came with", () => {
    const run = publish({
      verdict: saved(EVIDENCE_OUTCOMES.satisfied),
      proverExit: "1",
    });

    expect(run.code).toBe(1);
    expect(run.posted).toEqual([]);
  });

  it("fails, and shows the refusal, when GitHub refuses the check run", () => {
    const refusal = "HTTP 403: Resource not accessible by integration";
    const run = publish({
      verdict: saved(EVIDENCE_OUTCOMES.unsatisfied),
      proverExit: "1",
      refuse: refusal,
    });

    expect(run.code).toBe(1);
    expect(run.err).toContain(refusal);
    expect(run.err).toContain("not published");
  });
});

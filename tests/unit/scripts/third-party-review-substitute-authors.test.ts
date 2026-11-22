/**
 * Who may stand in for a third-party reviewer (CodySwannGT/lisa#4628).
 *
 * The substitute marker is plain text, and this repository is public: any
 * account can comment it. The merge-path gate already counts a marker only as
 * the FIRST line of a comment by someone with write access. These cases hold
 * the evidence prover to the same rule, and hold it to saying so out loud: a
 * marker it refuses is named in its report with the author and the reason,
 * never dropped in silence.
 * @module tests/unit/scripts/third-party-review-substitute-authors
 */
import { describe, expect, it } from "vitest";

import {
  configuredReviewers,
  EVIDENCE_OUTCOMES,
  humanReport,
  main,
  reviewEvidenceVerdict,
  substituteMarker,
  SUBSTITUTE_REFUSALS,
  substitutePosted,
} from "../../../all/copy-overwrite/scripts/check-third-party-review-evidence.mjs";

const CONTEXT = "Example Reviewer";
const HEAD = "e".repeat(40);
const REPO_ARG = "--repo=acme/code";
const THROTTLED = "Review rate limited";
const WRITER = "maintainer";
const STRANGER = "drive-by";
const UNREADABLE = "ghost";
/** The reasons, in the words the issue's acceptance criteria use. */
const NO_WRITE_ACCESS = SUBSTITUTE_REFUSALS.noWriteAccess;
const NOT_FIRST_LINE = SUBSTITUTE_REFUSALS.notFirstLine;
const PERMISSION_UNREADABLE = SUBSTITUTE_REFUSALS.permissionUnreadable;

/** One gates block declaring a single third-party reviewer. */
const ONE_REVIEWER = {
  "code-review": {
    "pull-request": {
      level: "required",
      await: CONTEXT,
      evidence: { reviewer: true, proof: ["Review completed"] },
    },
  },
};

const MARKER = substituteMarker({ context: CONTEXT, sha: HEAD });

/**
 * One raw issue comment, shaped as the GitHub API returns it.
 * @param body - The comment body
 * @param login - Its author
 * @returns The comment
 */
const comment = (body: string, login: string) => ({
  body,
  user: { login },
});

/**
 * The permission reader the tests inject: a writer, a reader, and one login
 * whose permission read fails.
 * @param login - The comment author
 * @returns true for a writer, false for anyone else, null when unreadable
 */
const permissions = (login: string): boolean | null => {
  if (login === UNREADABLE) return null;
  return login === WRITER;
};

/**
 * Run the CLI once over one comment list, with every read injected.
 * @param comments - Issue comments on the pull request
 * @param json - Whether to ask for JSON
 * @param canWrite - The injected permission reader
 * @returns The exit code and everything written to stdout
 */
const runMain = (
  comments: ReadonlyArray<object>,
  json = false,
  canWrite: (login: string) => boolean | null = permissions
) => {
  const chunks: string[] = [];
  const code = main([`--sha=${HEAD}`, REPO_ARG, ...(json ? ["--json"] : [])], {
    gates: ONE_REVIEWER,
    pulls: () => [7],
    statuses: () => [
      { context: CONTEXT, state: "success", description: THROTTLED },
    ],
    comments: () => comments,
    canWrite,
    out: {
      write: (text: string) => {
        chunks.push(text);
      },
    },
  });
  return { code, stdout: chunks.join("") };
};

/**
 * The single reading in a JSON verdict.
 * @param stdout - The CLI's JSON output
 * @returns The outcome and its only reading
 */
const parsed = (stdout: string) => {
  const verdict = JSON.parse(stdout) as {
    outcome: string;
    readings: ReadonlyArray<{
      substituted: boolean;
      substituteRefusals: ReadonlyArray<{ author: string; reason: string }>;
    }>;
  };
  return { outcome: verdict.outcome, reading: verdict.readings[0] };
};

describe("the refusal reasons", () => {
  it("are worded as the acceptance criteria word them", () => {
    expect(SUBSTITUTE_REFUSALS).toEqual({
      notFirstLine: "not the first line",
      noWriteAccess: "no write access",
      permissionUnreadable: "permission unreadable",
    });
  });
});

describe("a stranger's first-line marker is refused", () => {
  it("is unsatisfied and exits 1", () => {
    const { code, stdout } = runMain([comment(MARKER, STRANGER)], true);

    expect(code).toBe(1);
    expect(parsed(stdout).outcome).toBe(EVIDENCE_OUTCOMES.unsatisfied);
    expect(parsed(stdout).reading?.substituted).toBe(false);
  });

  it("names the author and the reason in the report", () => {
    const { stdout } = runMain([comment(MARKER, STRANGER)]);

    expect(stdout).toContain(`@${STRANGER}`);
    expect(stdout).toContain("not counted");
    expect(stdout).toContain(NO_WRITE_ACCESS);
    expect(stdout).toContain("NOTHING stands in its place");
  });

  it("names the author and the reason in the JSON output", () => {
    const { stdout } = runMain([comment(MARKER, STRANGER)], true);

    expect(parsed(stdout).reading?.substituteRefusals).toEqual([
      { author: STRANGER, reason: NO_WRITE_ACCESS },
    ]);
  });
});

describe("a quoted marker is refused", () => {
  it("does not count a writer's marker that is not the first line", () => {
    const { code, stdout } = runMain(
      [comment(`Paste this when you are done:\n${MARKER}`, WRITER)],
      true
    );

    expect(code).toBe(1);
    expect(parsed(stdout).outcome).toBe(EVIDENCE_OUTCOMES.unsatisfied);
    expect(parsed(stdout).reading?.substituteRefusals).toEqual([
      { author: WRITER, reason: NOT_FIRST_LINE },
    ]);
  });

  it("says in the report that the marker was not on the first line", () => {
    const { stdout } = runMain([comment(`quoted: ${MARKER}`, WRITER)]);

    expect(stdout).toContain(`@${WRITER}`);
    expect(stdout).toContain(NOT_FIRST_LINE);
  });
});

describe("a writer's substitute still counts", () => {
  it("is substituted and exits 0", () => {
    const { code, stdout } = runMain(
      [comment(`${MARKER}\nRead the diff.`, WRITER)],
      true
    );

    expect(code).toBe(0);
    expect(parsed(stdout).outcome).toBe(EVIDENCE_OUTCOMES.substituted);
    expect(parsed(stdout).reading?.substituteRefusals).toEqual([]);
  });

  it("ignores a trailing carriage return on the first line, as the gate does", () => {
    const { code } = runMain([comment(`${MARKER}\r\nRead the diff.`, WRITER)]);

    expect(code).toBe(0);
  });

  it("still reports a stranger's refused marker beside a writer's counted one", () => {
    const { code, stdout } = runMain(
      [comment(MARKER, STRANGER), comment(MARKER, WRITER)],
      true
    );

    expect(code).toBe(0);
    expect(parsed(stdout).reading?.substituteRefusals).toEqual([
      { author: STRANGER, reason: NO_WRITE_ACCESS },
    ]);
  });
});

describe("an unreadable permission fails closed", () => {
  it("does not count the marker and says the permission could not be read", () => {
    const { code, stdout } = runMain([comment(MARKER, UNREADABLE)], true);

    expect(code).toBe(1);
    expect(parsed(stdout).reading?.substituteRefusals).toEqual([
      { author: UNREADABLE, reason: PERMISSION_UNREADABLE },
    ]);
  });

  it("treats a permission reader that throws as unreadable", () => {
    const { code, stdout } = runMain([comment(MARKER, WRITER)], true, () => {
      throw new Error("gh: HTTP 502");
    });

    expect(code).toBe(1);
    expect(parsed(stdout).reading?.substituteRefusals).toEqual([
      { author: WRITER, reason: PERMISSION_UNREADABLE },
    ]);
  });

  it("counts nothing when no permission reader is supplied at all", () => {
    expect(
      reviewEvidenceVerdict({
        reviewers: configuredReviewers({ gates: ONE_REVIEWER }),
        statuses: [],
        comments: [comment(MARKER, WRITER)],
        sha: HEAD,
      }).outcome
    ).toBe(EVIDENCE_OUTCOMES.unsatisfied);
  });
});

describe("each author's permission is read once per run", () => {
  it("asks once for an author who posted twice", () => {
    const asked: string[] = [];
    runMain(
      [comment(MARKER, STRANGER), comment(MARKER, STRANGER)],
      true,
      login => {
        asked.push(login);
        return false;
      }
    );

    expect(asked).toEqual([STRANGER]);
  });

  it("asks once in an --arm run, where the reading and the arm share one reader", () => {
    const asked: string[] = [];
    const chunks: string[] = [];
    const code = main([`--sha=${HEAD}`, REPO_ARG, "--arm", "--json"], {
      gates: ONE_REVIEWER,
      pulls: () => [7],
      statuses: () => [
        { context: CONTEXT, state: "success", description: THROTTLED },
      ],
      comments: () => [
        comment(`${MARKER}\nRead the diff.`, WRITER),
        comment(`${MARKER}\nRead it again.`, WRITER),
      ],
      reviews: () => [],
      requiredChecks: () => false,
      readFile: () => "{}",
      canWrite: login => {
        asked.push(login);
        return true;
      },
      out: {
        write: (text: string) => {
          chunks.push(text);
        },
      },
    });
    const report = JSON.parse(chunks.join("")) as {
      arm: boolean;
      evidence: { outcome: string };
    };

    expect(asked).toEqual([WRITER]);
    expect(report.evidence.outcome).toBe(EVIDENCE_OUTCOMES.substituted);
    expect(report.arm).toBe(true);
    expect(code).toBe(0);
  });
});

describe("a bot's marker is refused without asking", () => {
  it("reports no write access and never calls the permission reader", () => {
    const asked: string[] = [];
    const { code, stdout } = runMain(
      [comment(MARKER, "github-actions[bot]")],
      true,
      login => {
        asked.push(login);
        return true;
      }
    );

    expect(code).toBe(1);
    expect(asked).toEqual([]);
    expect(parsed(stdout).reading?.substituteRefusals).toEqual([
      { author: "github-actions[bot]", reason: NO_WRITE_ACCESS },
    ]);
  });
});

describe("substitutePosted applies the same rule", () => {
  it("counts only a writer's first-line marker", () => {
    const posted = (body: string, login: string) =>
      substitutePosted({
        comments: [comment(body, login)],
        context: CONTEXT,
        sha: HEAD,
        canWrite: permissions,
      });

    expect(posted(MARKER, WRITER)).toBe(true);
    expect(posted(MARKER, STRANGER)).toBe(false);
    expect(posted(`x\n${MARKER}`, WRITER)).toBe(false);
    expect(posted(MARKER, UNREADABLE)).toBe(false);
  });
});

describe("humanReport", () => {
  it("prints one line per refused marker under the reading", () => {
    const report = humanReport(
      reviewEvidenceVerdict({
        reviewers: configuredReviewers({ gates: ONE_REVIEWER }),
        statuses: [],
        comments: [
          comment(MARKER, STRANGER),
          comment(`see ${MARKER}`, WRITER),
          comment(MARKER, UNREADABLE),
        ],
        sha: HEAD,
        canWrite: permissions,
      })
    );

    const refusals = report
      .split("\n")
      .filter(line => line.includes("not counted"));
    expect(refusals).toHaveLength(3);
    expect(refusals[0]).toContain(`@${STRANGER}`);
    expect(refusals[0]).toContain(NO_WRITE_ACCESS);
    expect(refusals[1]).toContain(`@${WRITER}`);
    expect(refusals[1]).toContain(NOT_FIRST_LINE);
    expect(refusals[2]).toContain(`@${UNREADABLE}`);
    expect(refusals[2]).toContain(PERMISSION_UNREADABLE);
  });
});

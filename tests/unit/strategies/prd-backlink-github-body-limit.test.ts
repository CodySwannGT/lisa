/**
 * Regression tests for the prd-backlink skill's GitHub issue body limit
 * (CodySwannGT/lisa#5004).
 *
 * The `## Tickets` section the skill documents pushed a 60-requirement,
 * 41-ticket GitHub PRD past the 65,536-character issue body limit, so the
 * write was refused and the PRD kept no record of its tickets. The skill had
 * no instruction for that case.
 *
 * The skill's prose is guidance and is reviewed, not pinned (#4867). What is
 * tested is the program the skill ships for the size rule: it is lifted out of
 * every copy of the skill and RUN against a PRD rendered to the documented
 * standard form. A copy that lost the rule, or a rule that stopped fitting the
 * body, keeping every `lisa:gw` token or quoting the requirement verbatim,
 * fails here.
 * @module tests/unit/strategies/prd-backlink-github-body-limit
 */
import { describe, expect, it } from "vitest";

import {
  BODY_LIMIT,
  COVERAGE_MARKER,
  PRD_REPO,
  SOURCE_COPY,
  buildPrd,
  chars,
  liftProgram,
  runFit,
  skillCopies,
  standardLink,
  tokensOf,
} from "./prd-backlink-github-body-limit-helpers.js";

/** The PRD the bug was measured on: about 35,000 characters before the section. */
const LARGE = buildPrd(35_000);

/** A PRD so long that even the compact coverage list has no room. */
const LARGER = buildPrd(48_000);

/** A PRD the entry lines alone push past the limit. */
const TOO_LARGE = buildPrd(60_000);

/** Stands in for the managed comment's URL once the comment exists. */
const COMMENT_URL = `https://github.com/${PRD_REPO}/issues/4953#issuecomment-1`;

/** The heading label the compact form keeps from `Story N — As an operator…`. */
const LABEL = /^- \*\*R\d+\*\* §"Story \d": "/u;

/**
 * The requirement-coverage lines of a body or comment.
 * @param text Body or comment text.
 * @returns Every coverage line, in order.
 */
const coverageLines = (text: string): readonly string[] =>
  text.split("\n").filter(line => line.startsWith("- **R"));

describe("the standard section overflows GitHub's issue body limit (#5004)", () => {
  it("is rendered for 60 requirements and 41 tickets", () => {
    expect(LARGE.requirements).toHaveLength(60);
    expect(LARGE.tickets).toHaveLength(41);
    expect(tokensOf(LARGE.standardBody)).toHaveLength(41);
  });

  it("pushes a 35,000-character PRD past 65,536 characters", () => {
    expect(chars(LARGE.source)).toBe(35_000);
    expect(chars(LARGE.standardBody)).toBeGreaterThan(BODY_LIMIT);
  });
});

describe("every shipped copy of the skill carries the size rule", () => {
  const copies = skillCopies();

  it("finds the source and every agent's projection", () => {
    expect(copies).toEqual(
      expect.arrayContaining([
        SOURCE_COPY,
        "plugins/lisa/skills/lisa-prd-backlink/SKILL.md",
        "plugins/lisa/.codex-plugin/skills/lisa-prd-backlink/SKILL.md",
        "plugins/lisa-agy/skills/lisa-prd-backlink/SKILL.md",
        "plugins/lisa-copilot/skills/lisa-prd-backlink/SKILL.md",
        "plugins/lisa-cursor/skills/lisa-prd-backlink/SKILL.md",
        "plugins/lisa-devin/skills/lisa-prd-backlink/SKILL.md",
      ])
    );
  });

  it.each(copies)("%s ships the program the source ships", copy => {
    expect(liftProgram(copy)).toBe(liftProgram(SOURCE_COPY));
  });
});

describe("fitting a GitHub PRD body to the limit", () => {
  it("leaves a body that already fits exactly as rendered", () => {
    const small = buildPrd(0);
    expect(chars(small.standardBody)).toBeLessThanOrEqual(BODY_LIMIT);

    const run = runFit(liftProgram(SOURCE_COPY), small.standardBody);

    expect(run.form).toBe("standard");
    expect(run.body).toBe(small.standardBody);
    expect(run.comment).toBeNull();
  });

  it("counts characters, not bytes", () => {
    // 65,536 characters exactly, but 3 bytes each: a byte count would refuse it.
    const atLimit = "—".repeat(BODY_LIMIT);
    expect(runFit(liftProgram(SOURCE_COPY), atLimit).form).toBe("standard");

    const over = runFit(liftProgram(SOURCE_COPY), `${atLimit}—`);
    expect(over.form).toBe("too-large");
    expect(over.status).toBe(1);
  });

  describe("a large PRD still receives its back-link, in the compact form", () => {
    const run = runFit(liftProgram(SOURCE_COPY), LARGE.standardBody);
    const body = run.body ?? "";

    it("writes a body within the limit", () => {
      expect(run.form).toBe("compact");
      expect(chars(body)).toBeGreaterThan(0);
      expect(chars(body)).toBeLessThanOrEqual(BODY_LIMIT);
      expect(run.comment).toBeNull();
    });

    it("keeps one lisa:gw token per created ticket, unchanged", () => {
      expect(tokensOf(body)).toHaveLength(LARGE.tickets.length);
      expect(tokensOf(body)).toEqual(tokensOf(LARGE.standardBody));
    });

    it("quotes every requirement exactly as the PRD words it", () => {
      const lines = coverageLines(body);
      expect(lines).toHaveLength(LARGE.requirements.length);
      for (const [index, requirement] of LARGE.requirements.entries()) {
        expect(LARGE.source).toContain(requirement.text);
        expect(lines[index]).toContain(
          `**${requirement.id}** §"Story ${(index % 8) + 1}": "${requirement.text}" — `
        );
      }
    });

    it("shortens same-repository tickets to #<number> and keeps other links whole", () => {
      const [first] = coverageLines(body);
      expect(first?.endsWith('" — #4961, #4962, #4970')).toBe(true);

      const elsewhere = LARGE.tickets.find(ticket => ticket.repo !== PRD_REPO);
      if (elsewhere === undefined) {
        throw new Error("the fixture has no cross-repository ticket");
      }
      const carrying = coverageLines(body).filter(line =>
        line.includes(standardLink(elsewhere))
      );
      expect(carrying).toHaveLength(elsewhere.reqs.length);
    });

    it("changes nothing outside the requirement-coverage list", () => {
      const outside = (text: string): string =>
        text
          .split("\n")
          .filter(line => line.trim() !== "")
          .filter(line => !line.startsWith("- **R") && !line.startsWith("_"))
          .join("\n");
      expect(outside(body)).toBe(outside(LARGE.standardBody));
    });

    it("writes the same bytes on every run", () => {
      expect(runFit(liftProgram(SOURCE_COPY), LARGE.standardBody).body).toBe(
        body
      );
    });

    it("reads a body with CRLF line endings the same way", () => {
      const crlf = LARGE.standardBody.replaceAll("\n", "\r\n");
      const crlfRun = runFit(liftProgram(SOURCE_COPY), crlf);
      expect(crlfRun.form).toBe("compact");
      expect(tokensOf(crlfRun.body ?? "")).toEqual(tokensOf(body));
      expect(coverageLines(crlfRun.body ?? "")).toHaveLength(60);
    });
  });

  describe("a PRD the compact form cannot fit moves the coverage list to a comment", () => {
    const first = runFit(liftProgram(SOURCE_COPY), LARGER.standardBody);
    const second = runFit(
      liftProgram(SOURCE_COPY),
      LARGER.standardBody,
      COMMENT_URL
    );
    const body = second.body ?? "";

    it("writes the comment first and no body until the comment has a URL", () => {
      expect(first.form).toBe("comment");
      expect(first.status).toBe(0);
      expect(first.body).toBeNull();
      expect(first.comment?.startsWith(`${COVERAGE_MARKER}\n`)).toBe(true);
    });

    it("writes a body within the limit that names the comment", () => {
      expect(second.form).toBe("comment");
      expect(chars(body)).toBeLessThanOrEqual(BODY_LIMIT);
      expect(body).toContain(`(${COMMENT_URL})`);
      expect(coverageLines(body)).toHaveLength(0);
    });

    it("keeps every entry line and its token in the body", () => {
      expect(tokensOf(body)).toEqual(tokensOf(LARGER.standardBody));
    });

    it("carries every requirement, verbatim, in a comment within the limit", () => {
      const comment = second.comment ?? "";
      expect(comment).toBe(first.comment);
      expect(chars(comment)).toBeLessThanOrEqual(BODY_LIMIT);
      const lines = coverageLines(comment);
      expect(lines).toHaveLength(LARGER.requirements.length);
      for (const [index, requirement] of LARGER.requirements.entries()) {
        expect(lines[index]).toMatch(LABEL);
        expect(lines[index]).toContain(`: "${requirement.text}" — `);
      }
    });
  });

  it("writes nothing, and says so, when even the entry lines do not fit", () => {
    const run = runFit(liftProgram(SOURCE_COPY), TOO_LARGE.standardBody);

    expect(run.form).toBe("too-large");
    expect(run.status).toBe(1);
    expect(run.body).toBeNull();
    expect(run.comment).toBeNull();
    expect(run.stderr).toContain(String(BODY_LIMIT));
  });
});

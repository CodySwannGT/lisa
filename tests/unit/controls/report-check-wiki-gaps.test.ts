/**
 * The audit's open questions in a repository's wiki.
 *
 * Where a repository keeps a wiki, the check also writes the open questions
 * to `wiki/gaps.md`, the file `/lisa:agent-ready` already has people answer
 * in. It writes one marked block and nothing else: whatever that file held
 * before stays byte for byte, a wiki is never created, and an answer typed
 * there is as safe as one typed in the report (CodySwannGT/lisa#4980).
 */
import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AUDIT_REPORT_JSON_PATH,
  AUDIT_REPORT_MARKDOWN_PATH,
} from "../../../src/controls/audit-report.js";
import {
  buildFNone,
  runControlAuditGit,
} from "../../helpers/control-audit-fixtures.js";
import {
  askAbout,
  completeAuditReport,
  writeAuditReport,
} from "../../helpers/control-audit-report.js";
import { AT_FIRST, CRITERIA, FIRST, WHOLE } from "./audit-report-facts.js";
import {
  absorb,
  answerInline,
  audited,
  fileOf,
  GAPS,
  recordOf,
  REPORT_MD,
  writeFileOf,
} from "./support/report-answers-run.js";
import { check, keep, removeFixtures } from "./support/report-check-run.js";

afterEach(removeFixtures);

const FIRST_ID = `${FIRST}@${WHOLE}`;
const START = "<!-- lisa:audit-questions:start -->";
const END = "<!-- lisa:audit-questions:end -->";
const EVERY_FILE = [
  "status",
  "--porcelain",
  "--ignored",
  "--untracked-files=all",
];
const TWO_QUESTIONS = askAbout(completeAuditReport(), AT_FIRST);

/** What `/lisa:agent-ready` keeps in the file, in its own form. */
const AGENT_READY_GAPS = [
  "# Knowledge gaps",
  "",
  "## Open gaps (answer inline under each question, then re-run /lisa:agent-ready in a new session)",
  "",
  "### billing-cutoff",
  "- **Question**: Why does the billing cutoff run at 02:00?",
  "- **Answer**: _(human fills in)_",
  "- **Status**: open",
  "",
  "## Resolved",
  "",
  "### release-day",
  "- **Answer**: We ship on Tuesdays.",
  "- **Status**: absorbed",
  "",
].join("\n");

/**
 * F-none with a wiki in it.
 * @param gaps - The content of `wiki/gaps.md`, when the wiki has one
 * @returns A builder for the fixture
 */
function withWiki(gaps?: string): () => ReturnType<typeof buildFNone> {
  return () =>
    buildFNone({
      extraFiles: {
        "wiki/index.md": "# Wiki\n",
        ...(gaps === undefined ? {} : { [GAPS]: gaps }),
      },
    });
}

/**
 * The ids of the questions a file's headings show.
 * @param text - The file's content
 * @returns Each id under a third-level heading that is a question id
 */
function idsIn(text: string): readonly string[] {
  return text
    .split("\n")
    .filter(line => line.startsWith("### "))
    .map(line => line.slice(4))
    .filter(id => id === "tracker" || id.includes("@"));
}

describe("a repository with no wiki", () => {
  it("gets no wiki folder, and the questions are in the report only", async () => {
    const repoPath = await audited(TWO_QUESTIONS);

    expect(existsSync(path.join(repoPath, "wiki"))).toBe(false);
    expect(idsIn(fileOf(repoPath, REPORT_MD))).toEqual(["tracker", FIRST_ID]);
    expect(runControlAuditGit(repoPath, EVERY_FILE).split("\n")).toEqual([
      `?? ${AUDIT_REPORT_JSON_PATH}`,
      `?? ${AUDIT_REPORT_MARKDOWN_PATH}`,
    ]);
  });
});

describe("a repository with a wiki", () => {
  it("has each open question once in the report and once in wiki/gaps.md", async () => {
    const repoPath = await audited(TWO_QUESTIONS, withWiki());

    expect(idsIn(fileOf(repoPath, REPORT_MD))).toEqual(["tracker", FIRST_ID]);
    expect(idsIn(fileOf(repoPath, GAPS))).toEqual(["tracker", FIRST_ID]);
    expect(runControlAuditGit(repoPath, EVERY_FILE).split("\n")).toEqual([
      `?? ${AUDIT_REPORT_JSON_PATH}`,
      `?? ${AUDIT_REPORT_MARKDOWN_PATH}`,
      `?? ${GAPS}`,
    ]);
  });

  it("says that it wrote the wiki file", async () => {
    const { repoPath } = keep(withWiki()());
    writeAuditReport(repoPath, TWO_QUESTIONS);

    const run = await check(repoPath);

    expect(run.stdout).toEqual([
      `report-check: PASS. ${CRITERIA.length} findings across 1 part; wrote ${AUDIT_REPORT_MARKDOWN_PATH} and 2 open questions to ${GAPS}`,
    ]);
  });

  it("adds its block after what agent-ready keeps there, and changes none of that", async () => {
    const repoPath = await audited(TWO_QUESTIONS, withWiki(AGENT_READY_GAPS));
    const gaps = fileOf(repoPath, GAPS);

    expect(gaps.startsWith(`${AGENT_READY_GAPS}\n${START}\n`)).toBe(true);
    expect(gaps.endsWith(`${END}\n`)).toBe(true);
    expect(idsIn(gaps)).toEqual(["tracker", FIRST_ID]);
  });

  it("writes nothing the second time when nothing changed", async () => {
    const repoPath = await audited(TWO_QUESTIONS, withWiki(AGENT_READY_GAPS));
    const once = fileOf(repoPath, GAPS);

    const run = await check(repoPath);

    expect(run.code).toBe(0);
    expect(fileOf(repoPath, GAPS)).toBe(once);
  });

  it("refreshes its block in place, keeping what is before and after it", async () => {
    const repoPath = await audited(TWO_QUESTIONS, withWiki(AGENT_READY_GAPS));
    writeFileOf(
      repoPath,
      GAPS,
      `${fileOf(repoPath, GAPS)}\n## Notes\n\nKept by hand.\n`
    );
    writeAuditReport(repoPath, completeAuditReport());

    await check(repoPath);
    const gaps = fileOf(repoPath, GAPS);

    expect(idsIn(gaps)).toEqual(["tracker"]);
    expect(gaps.startsWith(`${AGENT_READY_GAPS}\n${START}\n`)).toBe(true);
    expect(gaps.endsWith(`${END}\n\n## Notes\n\nKept by hand.\n`)).toBe(true);
  });

  it("leaves the wiki alone when it has nothing to ask and never wrote there", async () => {
    const { repoPath } = keep(withWiki(AGENT_READY_GAPS)());
    writeAuditReport(repoPath, {
      ...completeAuditReport(),
      questions: [],
      answers: [{ id: "tracker", question: "Which tracker?", answer: "Jira" }],
    });

    const run = await check(repoPath);

    expect(run.code).toBe(0);
    expect(fileOf(repoPath, GAPS)).toBe(AGENT_READY_GAPS);
  });

  it("is not treated as a wiki when the folder is a link", async () => {
    const { repoPath } = keep(buildFNone());
    const elsewhere = path.join(keep(buildFNone()).repoPath, "shared-wiki");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, path.join(repoPath, "wiki"));
    writeAuditReport(repoPath, TWO_QUESTIONS);

    const run = await check(repoPath);

    expect(run.code).toBe(0);
    expect(existsSync(path.join(elsewhere, "gaps.md"))).toBe(false);
  });

  it("refuses, writing nothing at all, when gaps.md is a link", async () => {
    const { repoPath } = keep(withWiki()());
    const elsewhere = path.join(keep(buildFNone()).repoPath, "gaps.md");
    writeFileOf(path.dirname(elsewhere), "gaps.md", AGENT_READY_GAPS);
    symlinkSync(elsewhere, path.join(repoPath, GAPS));
    writeAuditReport(repoPath, TWO_QUESTIONS);

    const run = await check(repoPath);

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toBe(
      `${GAPS} is not an ordinary file (it may be a link), so nothing was written. Remove it, then run this check again.`
    );
    expect(existsSync(path.join(repoPath, REPORT_MD))).toBe(false);
    expect(fileOf(path.dirname(elsewhere), "gaps.md")).toBe(AGENT_READY_GAPS);
  });
});

describe("an answer typed in wiki/gaps.md", () => {
  it("stops the check from refreshing the file until it is absorbed", async () => {
    const repoPath = await audited(TWO_QUESTIONS, withWiki(AGENT_READY_GAPS));
    answerInline(repoPath, "tracker", "Linear", GAPS);
    const typed = fileOf(repoPath, GAPS);

    const run = await check(repoPath);

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toMatch(
      /^wiki\/gaps\.md line \d+ holds an answer to .* that the record does not carry/u
    );
    expect(fileOf(repoPath, GAPS)).toBe(typed);
  });

  it("is absorbed, and then shown as answered in the report and gone from the wiki", async () => {
    const repoPath = await audited(TWO_QUESTIONS, withWiki(AGENT_READY_GAPS));
    answerInline(repoPath, "tracker", "Linear", GAPS);

    const absorbed = await absorb(repoPath);
    const run = await check(repoPath);

    expect(absorbed.code).toBe(0);
    expect(run.stderr).toEqual([]);
    expect(recordOf(repoPath).answers).toEqual([
      expect.objectContaining({ id: "tracker", answer: "Linear" }),
    ]);
    expect(idsIn(fileOf(repoPath, GAPS))).toEqual([FIRST_ID]);
    expect(fileOf(repoPath, GAPS)).not.toContain("Linear");
    expect(fileOf(repoPath, REPORT_MD)).toContain("- **Answer**: Linear");
    expect(fileOf(repoPath, GAPS).startsWith(AGENT_READY_GAPS)).toBe(true);
  });

  it("is refused when the report gives the same question another answer", async () => {
    const repoPath = await audited(TWO_QUESTIONS, withWiki());
    answerInline(repoPath, "tracker", "Linear", GAPS);
    answerInline(repoPath, "tracker", "Jira");

    const run = await absorb(repoPath);

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toMatch(
      /^\.lisa\/audit\/report\.md line \d+ and wiki\/gaps\.md line \d+ give different answers to/u
    );
    expect(recordOf(repoPath).answers).toBeUndefined();
  });

  it("says none are open once every question is answered", async () => {
    const repoPath = await audited(completeAuditReport(), withWiki());
    answerInline(repoPath, "tracker", "Linear", GAPS);
    await absorb(repoPath);

    await check(repoPath);

    expect(fileOf(repoPath, GAPS)).toBe(
      `${START}\n\n## Open questions from the audit (none open)\n\n${END}\n`
    );
  });

  it("is never read from the part of the file agent-ready keeps", async () => {
    const repoPath = await audited(
      completeAuditReport(),
      withWiki(AGENT_READY_GAPS)
    );
    rmSync(path.join(repoPath, REPORT_MD));

    const run = await absorb(repoPath);

    expect(run.stdout).toEqual([
      "report-check --absorb: PASS. No answers to absorb",
    ]);
    expect(recordOf(repoPath).answers).toBeUndefined();
  });
});

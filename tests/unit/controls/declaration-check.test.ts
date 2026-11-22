/**
 * `lisa controls declaration-check`: the audit report must support every part
 * the gates declaration declares.
 *
 * The configure step is carried out by an agent, which can write down a check
 * nobody evidenced. This command is the code that refuses it: a part names a
 * place the audit reported, or a question a person answered, and nothing is
 * declared for a requirement the audit still asks about
 * (CodySwannGT/lisa#4984).
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  foundAt,
  openQuestion,
  reportWith,
} from "../../helpers/control-audit-findings.js";
import { runControlAuditGit } from "../../helpers/control-audit-fixtures.js";
import { completeAuditReport } from "../../helpers/control-audit-report.js";
import {
  F_PAVED_GATES,
  evidenceAt,
  type GatesBlock,
} from "../../helpers/control-register.js";
import {
  MIXED_PARTS,
  configured,
  declarationCheck,
} from "./support/declaration-check-run.js";
import { removeFixtures } from "./support/report-check-run.js";

const STYLE = "SI7";
const COVERAGE = "SI2";
const RUFF = ["ruff", "check", "."];
const API_SETTINGS = "api/ruff.toml";
const WEB_MANIFEST = "web/package.json";
const FAIL = /^declaration-check: FAIL\. /u;

/** One part of the lint gate, as the declaration writes it. */
type Part = Readonly<Record<string, unknown>>;

const API_PART: Part = {
  scope: "api",
  command: RUFF,
  evidence: evidenceAt(API_SETTINGS),
};
const WEB_PART: Part = {
  scope: "web",
  command: ["npm", "run", "lint"],
  evidence: evidenceAt(WEB_MANIFEST),
};

/**
 * A lint gate with the given parts.
 * @param parts - The gate's parts
 * @param criteria - The requirements the gate says it serves
 * @returns The `gates` block
 */
function lint(
  parts: readonly Part[],
  criteria: readonly string[] = [STYLE]
): GatesBlock {
  return { "code-style": { "pull-request": "required", criteria, parts } };
}

/** The audit of F-mixed: a style checker found in each folder. */
const BOTH_FOUND = reportWith(MIXED_PARTS, [
  foundAt(STYLE, "api", API_SETTINGS),
  foundAt(STYLE, "web", WEB_MANIFEST),
]);

afterEach(removeFixtures);

describe("a declaration the audit supports", () => {
  it("passes, and says how many parts the report supports", async () => {
    const run = await declarationCheck(
      configured("F-mixed", lint([API_PART, WEB_PART]), BOTH_FOUND)
    );

    expect(run.stderr).toEqual([]);
    expect(run.code).toBe(0);
    expect(run.stdout).toEqual([
      "declaration-check: PASS. .lisa/audit/report.json supports each of the 2 parts declared in .lisa.config.json",
    ]);
  });

  it("passes for one part that covers the whole repository, on a check found in a folder", async () => {
    const whole = { ...API_PART, scope: "." };

    const run = await declarationCheck(
      configured("F-mixed", lint([whole]), BOTH_FOUND)
    );

    expect(run.stdout).toEqual([
      "declaration-check: PASS. .lisa/audit/report.json supports the 1 part declared in .lisa.config.json",
    ]);
  });

  it("writes nothing", async () => {
    const repoPath = configured("F-mixed", lint([API_PART]), BOTH_FOUND);
    const status = ["status", "--porcelain", "--untracked-files=all"];
    const before = runControlAuditGit(repoPath, status);

    await declarationCheck(repoPath);

    expect(runControlAuditGit(repoPath, status)).toBe(before);
  });
});

describe("a declaration with no parts", () => {
  it("passes with no audit report: nothing in it was declared from a finding", async () => {
    const run = await declarationCheck(configured("F-paved", F_PAVED_GATES));

    expect(run.stderr).toEqual([]);
    expect(run.stdout).toEqual([
      "declaration-check: PASS. No gate in .lisa.config.json declares a part, so nothing in it needs the audit report's support",
    ]);
  });

  it("passes in a repository that declares nothing at all", async () => {
    expect((await declarationCheck(configured("F-none", {}))).code).toBe(0);
  });
});

describe("a place the audit did not report", () => {
  it.each([
    [
      "a line the finding does not name",
      { ...API_PART, evidence: evidenceAt(API_SETTINGS, 3) },
      "api/ruff.toml line 3",
    ],
    [
      "a file no finding names",
      { ...API_PART, evidence: evidenceAt("api/pyproject.toml") },
      "api/pyproject.toml line 1",
    ],
    [
      "a place found in another part",
      { ...API_PART, evidence: evidenceAt(WEB_MANIFEST) },
      "web/package.json line 1",
    ],
  ])("is refused: %s", async (_what, part, place) => {
    const run = await declarationCheck(
      configured("F-mixed", lint([part]), BOTH_FOUND)
    );

    expect(run.code).toBe(1);
    expect(run.stdout).toEqual([]);
    expect(run.stderr).toEqual([
      `The gate "code-style" in .lisa.config.json has a part for the folder api that says its check was found at ${place}, but .lisa/audit/report.json reports no check there for a requirement this gate serves in that part of the repository. Copy the place exactly from a finding that says a check exists, or remove the part.`,
      expect.stringMatching(
        /^declaration-check: FAIL\. 1 problem between \.lisa\.config\.json and \.lisa\/audit\/report\.json\./u
      ),
    ]);
  });

  it("is refused when the place was found for a requirement the gate does not serve", async () => {
    const run = await declarationCheck(
      configured("F-mixed", lint([API_PART], [COVERAGE]), BOTH_FOUND)
    );

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toContain("reports no check there for a requirement");
  });

  it("is refused on a gate that serves no requirement, saying so", async () => {
    const run = await declarationCheck(
      configured(
        "F-mixed",
        { "x-docs": { push: "optional", parts: [API_PART] } },
        BOTH_FOUND
      )
    );

    expect(run.stderr[0]).toBe(
      'The gate "x-docs" in .lisa.config.json has a part for the folder api that names a place the audit found its check, but the gate serves no requirement, so no finding of the audit can support it. List the requirements it serves in the gate\'s "criteria", or remove the part.'
    );
  });
});

describe("an audit report with one unanswered question", () => {
  const WEB_OPEN = reportWith(MIXED_PARTS, [
    foundAt(STYLE, "api", API_SETTINGS),
    openQuestion(STYLE, "web"),
  ]);

  it("refuses an entry for that question's requirement in that part", async () => {
    const run = await declarationCheck(
      configured("F-mixed", lint([API_PART, WEB_PART]), WEB_OPEN)
    );

    expect(run.code).toBe(1);
    expect(run.stderr.filter(line => !FAIL.test(line))).toEqual([
      expect.stringContaining(
        "has a part for the folder web that says its check was found at web/package.json line 1"
      ),
      'The gate "code-style" in .lisa.config.json has a part for the folder web, but the audit still has an open question for the folder web: "Is a change refused when it breaks your limits on code size, complexity, structure, unused code or house style?" Nothing is recorded for a requirement until its question is answered. Remove the part, or take that requirement off the gate\'s "criteria", until the audit has the answer.',
    ]);
  });

  it("refuses a part for the whole repository, which would cover the open part", async () => {
    const run = await declarationCheck(
      configured("F-mixed", lint([{ ...API_PART, scope: "." }]), WEB_OPEN)
    );

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toContain(
      "has a part for the whole repository, but the audit still has an open question for the folder web"
    );
  });

  it("passes once nothing is declared for it, and every part left names a place", async () => {
    const run = await declarationCheck(
      configured("F-mixed", lint([API_PART]), WEB_OPEN)
    );

    expect(run.stderr).toEqual([]);
    expect(run.code).toBe(0);
  });
});

describe("a declaration or a report that cannot be relied on", () => {
  it("refuses parts when there is no audit report to support them", async () => {
    const run = await declarationCheck(configured("F-mixed", lint([API_PART])));

    expect(run.code).toBe(1);
    expect(run.stderr).toEqual([
      "No audit report was found at .lisa/audit/report.json. Run the audit first, then run this check again.",
      "declaration-check: FAIL. 1 part in .lisa.config.json could not be checked, because .lisa/audit/report.json cannot be relied on. Run the audit, then run this again",
    ]);
  });

  it("refuses a report the report check would refuse", async () => {
    const run = await declarationCheck(
      configured("F-mixed", lint([API_PART]), {
        ...completeAuditReport(MIXED_PARTS),
        scopes: ["."],
      })
    );

    expect(run.code).toBe(1);
    expect(run.stderr.at(-1)).toMatch(/cannot be relied on/u);
  });

  it("refuses a part that names nothing, before reading any report", async () => {
    const { evidence: _evidence, ...bare } = API_PART;

    const run = await declarationCheck(
      configured("F-mixed", lint([bare]), BOTH_FOUND)
    );

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toContain("says nothing about what supports it");
    expect(run.stderr[1]).toBe(
      "declaration-check: FAIL. 1 problem with the gates declaration in .lisa.config.json. Fix the declaration, then run this again"
    );
  });

  it("refuses a path that is not a folder", async () => {
    const run = await declarationCheck("/nonexistent/declaration-check");

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toBe(
      "/nonexistent/declaration-check is not a folder."
    );
  });
});

/**
 * `lisa controls report-check` never puts a secret's value on the screen or
 * in the rendered report, whatever state the record is in.
 *
 * The rules refuse a record that holds a value, field by field. Two things
 * are left over, and each is closed here: the rendering closes up white
 * space, so text can read as a value in `report.md` where it did not in the
 * record; and a record that is not valid JSON is never looked at by a rule,
 * while the parser's own message quotes a piece of it.
 *
 * Every credential-shaped value in this suite is made up when the test runs.
 * None is written in this file (CodySwannGT/lisa#4999).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AUDIT_REPORT_JSON_PATH,
  AUDIT_REPORT_MARKDOWN_PATH,
} from "../../../src/controls/audit-report.js";
import { parseProblemWithoutExcerpt } from "../../../src/controls/secret-scan-json.js";
import { credentialKinds } from "../../../src/controls/secret-scan.js";
import { fakeCredential } from "../../helpers/audit-probes.js";
import { buildFNone } from "../../helpers/control-audit-fixtures.js";
import {
  amendFinding,
  completeAuditReport,
} from "../../helpers/control-audit-report.js";
import { fakeGithubToken } from "../../helpers/fake-credentials.js";
import { AT_FIRST } from "./audit-report-facts.js";
import {
  check,
  checkOnFNone,
  keep,
  removeFixtures,
} from "./support/report-check-run.js";

afterEach(removeFixtures);

const RANDOM = fakeCredential();
const TOKEN = fakeGithubToken();
/** More blank space than the scanner takes to join a name to its value. */
const WIDE = " ".repeat(60);

/**
 * Every run of eight characters of a value, to look for a piece of it.
 * @param value - The value
 * @returns The runs
 */
function piecesOf(value: string): readonly string[] {
  return Array.from({ length: value.length - 7 }, (_unused, index) =>
    value.slice(index, index + 8)
  );
}

describe("the rendered report", () => {
  it("has a value taken out when it only reads as one once white space is closed up", async () => {
    const what = `The deploy settings hold password${WIDE}=${WIDE}${RANDOM} today.`;
    const run = await checkOnFNone(
      amendFinding(completeAuditReport(), AT_FIRST, { what })
    );
    const rendered = readFileSync(
      path.join(run.repoPath, AUDIT_REPORT_MARKDOWN_PATH),
      "utf8"
    );

    expect(credentialKinds(what)).toEqual([]);
    expect(run.stderr).toEqual([]);
    expect(run.code).toBe(0);
    expect(rendered).toContain(
      "The deploy settings hold password = [REDACTED:SECRET] today."
    );
    expect(rendered).not.toContain(RANDOM);
  });

  it("is the rendering, unchanged, when nothing in it reads as a value", async () => {
    const run = await checkOnFNone(completeAuditReport());
    const rendered = readFileSync(
      path.join(run.repoPath, AUDIT_REPORT_MARKDOWN_PATH),
      "utf8"
    );

    expect(run.code).toBe(0);
    expect(rendered).not.toContain("[REDACTED:");
    expect(credentialKinds(rendered)).toEqual([]);
  });
});

describe("a record that is not valid JSON and holds a credential", () => {
  it("is refused without any piece of the value being printed", async () => {
    const { repoPath } = keep(buildFNone());
    const file = path.join(repoPath, AUDIT_REPORT_JSON_PATH);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `{"scopes": ["."], "findings": ${TOKEN} }`);

    const run = await check(repoPath);
    const said = [...run.stdout, ...run.stderr].join("\n");

    expect(run.code).toBe(1);
    expect(run.stderr[0]).toMatch(
      /^\.lisa\/audit\/report\.json is not valid JSON, so it cannot be checked\. Write it again\. \(Unexpected token 'g'\)$/u
    );
    expect(piecesOf(TOKEN).filter(piece => said.includes(piece))).toEqual([]);
  });
});

describe("a parser's message", () => {
  it.each([
    [`{"a": ${TOKEN}}`, "Unexpected token 'g'"],
    [TOKEN, "Unexpected token 'g'"],
    [
      '{"a": 1',
      "Expected ',' or '}' after property value in JSON at position 7 (line 1 column 8)",
    ],
    ["", "Unexpected end of JSON input"],
  ])("loses the piece of the text it quotes (case %#)", (text, expected) => {
    const thrown = ((): unknown => {
      try {
        return JSON.parse(text) as unknown;
      } catch (error) {
        return error;
      }
    })();

    expect(parseProblemWithoutExcerpt(thrown)).toBe(expected);
  });

  it("is used as it is when it is not an error object", () => {
    expect(parseProblemWithoutExcerpt("it broke")).toBe("it broke");
  });
});

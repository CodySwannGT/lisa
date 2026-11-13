/**
 * Every Markdown link form in comment.md is checked against this run's uploads.
 *
 * `post-evidence.sh` refuses a description that links a release asset this
 * pull request did not upload in this run (CodySwannGT/lisa#4639). A check
 * that parsed only `](url)` let a titled link `](url "title")`, an
 * angle-bracketed `](<url>)` and a reference definition `[ref]: url` through
 * unvalidated, so each of those forms is driven here, with a passing control
 * per form so a check that refuses everything cannot pass.
 * @module tests/integration/jira-evidence-link-forms
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  DESCRIPTION_UPDATED,
  RELEASE,
  SHOT,
  SOURCES,
  cleanupRuns,
  prepareRepository,
  runFor,
} from "./support/jira-evidence-run.js";

const OTHER_PR = `${RELEASE}/pr-102-${SHOT}`;
const BARE = `${RELEASE}/${SHOT}`;
const OWN = `${RELEASE}/pr-101-${SHOT}`;

afterEach(cleanupRuns);

/**
 * Run PR 101 with the given description markdown.
 * @param script - Source script path.
 * @param commentMd - The description markdown.
 * @returns The completed process.
 */
function runWith(script: string, commentMd: string) {
  return runFor(prepareRepository(), script, "101", { commentMd });
}

describe.each(SOURCES)("Markdown link forms are validated: %s", script => {
  it.each([
    ["a titled link to another PR's asset", `![Shot](${OTHER_PR} "Shot")\n`],
    [
      "an angle-bracketed link to another PR's asset",
      `![Shot](<${OTHER_PR}>)\n`,
    ],
    ["a reference definition to a bare name", `![Shot][s]\n\n[s]: ${BARE}\n`],
    [
      "a bracketed, titled reference definition to a bare name",
      `![Shot][s]\n\n  [s]: <${BARE}> "Shot"\n`,
    ],
  ])("fails naming %s", (_kind, commentMd) => {
    const result = runWith(script, commentMd);
    const named = commentMd.includes("pr-102-") ? OTHER_PR : BARE;

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(named);
    expect(result.stdout).not.toContain(DESCRIPTION_UPDATED);
  });

  it("fails when a link names another evidence release of this repository (#4838)", () => {
    // The templates were generated against one release and the upload went
    // to another (a roll-over in between): every such link would 404.
    const other = `https://github.com/org/repo/releases/download/pr-assets-2026-11/pr-101-${SHOT}`;
    const result = runWith(script, `![Shot](${other})\n`);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(other);
    expect(result.stderr).toContain("'pr-assets-2026-11'");
    expect(result.stderr).toContain("LISA_EVIDENCE_RELEASE=pr-assets");
    expect(result.stdout).not.toContain(DESCRIPTION_UPDATED);
  });

  it("accepts a link into another repository's release alongside this run's upload", () => {
    const foreign = `https://github.com/other/repo/releases/download/v1.0.0/notes.txt`;
    const result = runWith(script, `![Shot](${OWN})\n[notes](${foreign})\n`);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(DESCRIPTION_UPDATED);
  });

  it.each([
    ["a titled link", `![Shot](${OWN} "Shot")\n`],
    ["an angle-bracketed titled link", `![Shot](<${OWN}> "Shot")\n`],
    ["a reference definition", `![Shot][s]\n\n[s]: <${OWN}> "Shot"\n`],
  ])("accepts %s to this run's upload", (_kind, commentMd) => {
    const result = runWith(script, commentMd);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(DESCRIPTION_UPDATED);
  });
});

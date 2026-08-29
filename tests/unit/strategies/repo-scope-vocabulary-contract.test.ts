/**
 * The repo-scope audit's premise is quoted from `assertRepoScope`, not assumed.
 *
 * Step 4c of `lisa-validate-tracker-mapping` exists because validation accepts
 * three spellings of repo scope while every build scan filters on one. That is
 * only worth auditing while it stays true: if `assertRepoScope` ever stopped
 * accepting the bare label, the skill's table would become a lie and the audit
 * would report drift about a spelling nothing accepts any more.
 *
 * So this file pins the three surfaces together — the acceptance rule in
 * `lisa-work-item.mjs`, the table in the skill, and the finding kinds the
 * module emits — rather than letting them drift apart silently, which is the
 * same failure mode the audit itself is about.
 * @module tests/unit/strategies/repo-scope-vocabulary-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CANONICAL_SEPARATOR,
  MALFORMED_SEPARATORS,
  REPO_SCOPE_FINDING_KINDS,
} from "../../../plugins/src/base/scripts/repo-scope-vocabulary-audit.mjs";

const WORK_ITEM_SCRIPT = "all/copy-overwrite/scripts/lisa-work-item.mjs";
const VALIDATE_MAPPING_SKILL =
  "plugins/src/base/skills/lisa-validate-tracker-mapping/SKILL.md";

/**
 * Read a repository file as UTF-8 text.
 * @param relative - Path relative to the repository root.
 * @returns The file's contents.
 */
const read = (relative: string): string =>
  readFileSync(path.resolve(relative), "utf8");

/**
 * The body of `assertRepoScope`, which is the acceptance rule being quoted.
 * @returns The function's source between its signature and closing brace.
 */
const assertRepoScopeBody = (): string => {
  const source = read(WORK_ITEM_SCRIPT);
  const start = source.indexOf("function assertRepoScope(");
  const end = source.indexOf("\n}", start);

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe("the audited premise matches assertRepoScope", () => {
  const body = assertRepoScopeBody();

  it("still accepts the canonical repo label", () => {
    expect(body).toContain("const expected = `repo:${bare}`");
    expect(body).toContain("labelNames.includes(expected)");
  });

  it("still accepts the bare repo-name label, which is what makes this audit necessary", () => {
    // Load-bearing: Sentry-provenance items arrive carrying only the bare name.
    // If this branch is ever removed, Step 4c's `unstamped-alias` finding stops
    // describing reality and the skill's table needs rewriting with it.
    expect(body).toContain("labelNames.includes(bare)");
  });

  it("still accepts a Jira component equal to the bare name", () => {
    expect(body).toContain("componentNames.includes(bare)");
  });

  it("accepts exactly those three spellings and no fourth", () => {
    expect(body.match(/\.includes\(/g)).toHaveLength(3);
  });
});

describe("the skill and the module agree", () => {
  const skill = read(VALIDATE_MAPPING_SKILL);

  it("documents every finding kind the module can emit", () => {
    for (const kind of REPO_SCOPE_FINDING_KINDS) {
      expect(skill).toContain(`\`${kind}\``);
    }
  });

  it("documents the canonical separator the module treats as correct", () => {
    expect(CANONICAL_SEPARATOR).toBe(":");
    expect(skill).toContain("`repo:<name>` (canonical)");
  });

  it("names a malformed separator the module actually reports", () => {
    expect(MALFORMED_SEPARATORS).toContain("-");
    expect(skill).toContain("`repo-frontend`");
  });

  it("records that the vocabulary is derived, never declared in config", () => {
    // The rejected alternative, kept rejected: a config key nothing reads would
    // look like an assertion and assert nothing.
    expect(skill).toContain("Never introduce a config key declaring it");
  });

  it("records that an empty vocabulary is UNRESOLVABLE rather than VALID", () => {
    expect(skill).toContain("`UNRESOLVABLE`, never\n`VALID`");
  });
});

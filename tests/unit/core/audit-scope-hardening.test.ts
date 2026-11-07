/**
 * Review hardening for the canonical audit scope (#4521).
 *
 * Three ways an exclusion could still widen beyond what was reviewed, and one
 * way an unrelated lockfile entry could take the whole gate down:
 * - a misspelled scope field (`path`, `version`) was ignored, so the entry
 *   silently meant "every copy";
 * - an advisory-wide entry for the same advisory accepted the finding even
 *   when a narrower paths/versions entry rejected it;
 * - a git, file, link, tarball or workspace entry in the lockfile threw, so any
 *   scoped exclusion failed the gate for a reason unrelated to the advisory.
 * Controlled fixtures only; no live advisory data.
 * @module tests/unit/core/audit-scope-hardening
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  auditScopeProblems,
  classifyUnknownFields,
  evaluateAuditReport,
  requiresLockfileScope,
} from "../../../src/core/audit.js";
import type { AuditManager } from "../../../src/core/audit.js";

const GHSA = "GHSA-aaaa-bbbb-cccc";
const DEV_PATH = "lint-plugin/zod";
const VULNERABLE = "zod@3.25.76";
const roots: string[] = [];
const REPORT = JSON.stringify({
  zod: [
    {
      id: 123,
      severity: "high",
      url: `https://github.com/advisories/${GHSA}`,
      vulnerable_versions: "<4.6.6",
    },
  ],
});
const SCOPED = {
  id: GHSA,
  package: "zod",
  versions: "3.x",
  paths: [DEV_PATH],
  reason: "Controlled lint-tool exception",
};
const LOCKFILE = {
  bun: "bun.lock",
  npm: "package-lock.json",
  yarn: "yarn.lock",
};

/**
 * Write one isolated tree.
 * @param files - Exclusion documents keyed by file name
 * @param lock - Lockfile text
 * @param manager - Manager whose lockfile name is used
 * @returns The fixture root
 */
function tree(
  files: Record<string, unknown[]>,
  lock: string,
  manager: AuditManager = "bun"
): string {
  const root = mkdtempSync(join(tmpdir(), "lisa-audit-hardening-"));
  roots.push(root);
  for (const [file, exclusions] of Object.entries(files))
    writeFileSync(join(root, file), JSON.stringify({ exclusions }));
  writeFileSync(join(root, LOCKFILE[manager]), lock);
  return root;
}

/**
 * A bun.lock holding a fixed production zod, the reviewed dev copy, and extras.
 * @param extra - Additional packages-map entries
 * @returns The lockfile text
 */
function bunLock(extra: Record<string, unknown[]> = {}): string {
  return JSON.stringify({
    packages: { zod: ["zod@4.6.7"], [DEV_PATH]: [VULNERABLE], ...extra },
  });
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("a misspelled scope field fails closed; other extra keys do not (B2)", () => {
  it.each([
    ["path", { path: [DEV_PATH] }, "paths"],
    ["version", { version: "3.x" }, "versions"],
    ["packages", { packages: ["zod"] }, "package"],
    ["Paths", { Paths: [DEV_PATH] }, "paths"],
    ["pathes", { pathes: [DEV_PATH] }, "paths"],
    ["Package", { Package: "zod" }, "package"],
    ["ids", { ids: [GHSA] }, "id"],
  ])(
    "rejects a misspelled %s field and names the real one",
    (_, typo, real) => {
      const entry = { id: GHSA, reason: "typo", ...typo };
      const problems = auditScopeProblems(entry);
      expect(problems.join("\n")).toContain(`did you mean "${real}"`);
      const root = tree({ "audit.ignore.local.json": [entry] }, bunLock());
      expect(() => evaluateAuditReport(root, "bun", REPORT)).toThrow(
        /unknown field/u
      );
    }
  );

  it("accepts every decision-record field shipped exclusion files use", () => {
    expect(
      auditScopeProblems({
        id: GHSA,
        cve: "CVE-2026-1234",
        package: "zod",
        versions: "3.x",
        paths: [DEV_PATH],
        reason: "r",
        notes: "n",
        justification: "j",
        decision: "d",
        rationale: "r",
        comment: "c",
        owner: "o",
        tracking: "t",
        review_by: "2026-12-01T00:00:00Z",
        expiry_enforced: false,
        active: true,
        "//": "a JSON comment key",
      })
    ).toEqual([]);
  });

  it.each([
    ["url", "https://example.invalid/advisory"],
    ["title", "Prototype pollution"],
    ["expires", "2026-12-01"],
    ["by", "a reviewer"],
    ["pr", 123],
  ])(
    "accepts an unrelated %s key, which the audit ignores as before",
    (key, value) => {
      const entry = { ...SCOPED, [key]: value };
      expect(auditScopeProblems(entry)).toEqual([]);
      expect(classifyUnknownFields(entry)).toEqual({
        misspelledScope: [],
        ignored: [key],
      });
      const root = tree({ "audit.ignore.local.json": [entry] }, bunLock());
      expect(evaluateAuditReport(root, "bun", REPORT).passed).toBe(true);
    }
  );

  it("the repository's own exclusion files contain no unknown field", () => {
    for (const file of [
      "audit.ignore.config.json",
      "audit.ignore.local.json",
    ]) {
      const { exclusions } = JSON.parse(readFileSync(file, "utf8")) as {
        exclusions: Record<string, unknown>[];
      };
      for (const entry of exclusions)
        expect(
          classifyUnknownFields(entry),
          `${file} ${String(entry.id)}`
        ).toEqual({ misspelledScope: [], ignored: [] });
    }
  });
});

describe("an advisory-wide entry cannot widen a scoped one (B3)", () => {
  const WIDE = { id: GHSA, package: "zod", reason: "Managed package-wide" };

  it("fails an uncovered copy even when the managed file has a package-wide entry", () => {
    const root = tree(
      {
        "audit.ignore.config.json": [WIDE],
        "audit.ignore.local.json": [SCOPED],
      },
      bunLock({ "production/zod": [VULNERABLE] })
    );
    const verdict = evaluateAuditReport(root, "bun", REPORT);
    const text = verdict.messages.join("\n");
    expect(verdict.passed).toBe(false);
    expect(text).toContain("production/zod");
    expect(text).toContain(
      "advisory-wide exclusion was not applied because a narrower paths/versions exclusion exists"
    );
  });

  it("still passes covered copies, and says the wide entry was set aside", () => {
    const root = tree(
      {
        "audit.ignore.config.json": [WIDE],
        "audit.ignore.local.json": [SCOPED],
      },
      bunLock()
    );
    const verdict = evaluateAuditReport(root, "bun", REPORT);
    expect(verdict.passed).toBe(true);
    expect(verdict.messages.join("\n")).toContain(
      `excluded ${GHSA} for ${DEV_PATH}`
    );
    expect(verdict.messages.join("\n")).toContain("was not applied");
  });

  it("a scoped entry for a different package does not shadow this package's wide entry", () => {
    const root = tree(
      {
        "audit.ignore.config.json": [WIDE],
        "audit.ignore.local.json": [{ ...SCOPED, package: "left-pad" }],
      },
      bunLock({ "production/zod": [VULNERABLE] })
    );
    expect(evaluateAuditReport(root, "bun", REPORT).passed).toBe(true);
  });
});

describe("one helper decides when lockfile data is required (N8)", () => {
  it.each<[Readonly<Record<string, unknown>>, boolean]>([
    [{ id: GHSA }, false],
    [{ id: GHSA, package: "zod" }, false],
    [{ id: GHSA, versions: "3.x" }, true],
    [{ id: GHSA, paths: [DEV_PATH] }, true],
  ])("%j → %s", (entry, expected) => {
    expect(requiresLockfileScope(entry)).toBe(expected);
  });
});

describe("the yarn lockfile parser loads on every supported Node (N1)", () => {
  it("never imports a named binding from the CommonJS @yarnpkg/lockfile", () => {
    // Node 22's CommonJS lexer cannot see `parse` on this webpack bundle, so a
    // named import crashes the module at load there (Node 24 tolerates it).
    const source = readFileSync("src/core/audit-lockfile.ts", "utf8");
    expect(source).not.toMatch(
      /import\s*\{[^}]*\}\s*from\s*"@yarnpkg\/lockfile"/u
    );
    expect(source).toMatch(
      /import\s*\*\s*as\s+\w+\s+from\s+"@yarnpkg\/lockfile"/u
    );
  });
});

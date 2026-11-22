/**
 * Doctor's view of exclusion scope matches the gate's (#4521 review).
 *
 * Covers what the gate now enforces and an operator should hear from doctor:
 * unknown fields fail B5 like they fail the gate; a missing lockfile behind a
 * scoped entry fails with the gate's own message; a package-only entry still
 * hides every copy; and a wide entry the gate sets aside because a narrower
 * one exists is explained rather than silently ignored.
 * Controlled fixtures only.
 * @module tests/unit/cli/doctor-audit-scope
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  auditExceptionObservations,
  auditExceptionViolations,
} from "../../../src/cli/doctor-readiness-audit-allowlist.js";
import * as lockfile from "../../../src/core/audit-lockfile.js";

// Doctor stays offline (#4509): wrap every process launcher so a test can
// prove no `npm audit`-style subprocess runs while doctor assesses scope.
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn(actual.spawn),
    spawnSync: vi.fn(actual.spawnSync),
    exec: vi.fn(actual.exec),
    execSync: vi.fn(actual.execSync),
    execFile: vi.fn(actual.execFile),
    execFileSync: vi.fn(actual.execFileSync),
  };
});
const childProcess = await import("node:child_process");

const GHSA = "GHSA-aaaa-bbbb-cccc";
const DEV_PATH = "lint-plugin/zod";
const SCOPED = {
  id: GHSA,
  package: "zod",
  versions: "3.x",
  paths: [DEV_PATH],
  reason: "Reviewed lint-time copy",
};
const roots: string[] = [];

/**
 * Write an isolated tree.
 * @param files - Exclusion documents keyed by file name
 * @param withLock - Whether to write a readable bun.lock
 * @returns The fixture root
 */
function tree(files: Record<string, unknown[]>, withLock = true): string {
  const root = mkdtempSync(join(tmpdir(), "lisa-doctor-audit-scope-"));
  roots.push(root);
  for (const [file, exclusions] of Object.entries(files))
    writeFileSync(join(root, file), JSON.stringify({ exclusions }));
  if (withLock)
    writeFileSync(
      join(root, "bun.lock"),
      JSON.stringify({
        packages: { zod: ["zod@4.6.7"], [DEV_PATH]: ["zod@3.25.76"] },
      })
    );
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("doctor audit scope", () => {
  it("fails B5 on a misspelled scope field, as the gate does", async () => {
    const root = tree({
      "audit.ignore.local.json": [{ id: GHSA, path: [DEV_PATH], reason: "r" }],
    });
    expect((await auditExceptionViolations(root)).join("\n")).toContain(
      'unknown field "path" (did you mean "paths"?)'
    );
  });

  it.each(["expires", "href", "ticket"])(
    "passes B5 but notes the ignored extra field %s",
    async key => {
      const root = tree({
        "audit.ignore.local.json": [{ ...SCOPED, [key]: "x" }],
      });
      expect(await auditExceptionViolations(root)).toEqual([]);
      expect((await auditExceptionObservations(root)).join("\n")).toContain(
        `unrecognized field \`${key}\`, which the audit ignores`
      );
    }
  );

  it("names the gate's own lockfile message when bun.lock is missing", async () => {
    const root = tree({ "audit.ignore.local.json": [SCOPED] }, false);
    writeFileSync(join(root, "bun.lockb"), "");
    expect((await auditExceptionViolations(root)).join("\n")).toContain(
      "Cannot evaluate scoped audit exclusions from bun.lock"
    );
  });

  it("observes a package-only entry, which still hides every copy", async () => {
    const root = tree({
      "audit.ignore.local.json": [{ id: GHSA, package: "zod", reason: "r" }],
    });
    expect(await auditExceptionViolations(root)).toEqual([]);
    expect((await auditExceptionObservations(root)).join("\n")).toContain(
      "every copy of `zod`"
    );
  });

  it("warns, without blocking, that an ID-only entry is unscoped (#4509)", async () => {
    const root = tree({
      "audit.ignore.local.json": [{ id: GHSA, reason: "legacy" }],
    });
    expect(await auditExceptionViolations(root)).toEqual([]);
    const text = (await auditExceptionObservations(root)).join("\n");
    expect(text).toContain(`the entry for \`${GHSA}\` names no package`);
    expect(text).toContain("hides this advisory for every copy");
  });

  it("raises no unscoped warning for a package+versions entry without paths (#4509)", async () => {
    const { paths: _paths, ...versionsOnly } = SCOPED;
    const root = tree({ "audit.ignore.local.json": [versionsOnly] });
    expect(await auditExceptionViolations(root)).toEqual([]);
    expect(await auditExceptionObservations(root)).toEqual([]);
  });

  it("assesses scope offline: no audit subprocess and no network call (#4509)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const launchers = [
      childProcess.spawn,
      childProcess.spawnSync,
      childProcess.exec,
      childProcess.execSync,
      childProcess.execFile,
      childProcess.execFileSync,
    ].map(launcher => vi.mocked(launcher));
    for (const launcher of launchers) launcher.mockClear();
    const root = tree({
      "audit.ignore.config.json": [{ id: GHSA, reason: "legacy" }],
      "audit.ignore.local.json": [SCOPED],
    });
    await auditExceptionViolations(root);
    await auditExceptionObservations(root);
    for (const launcher of launchers) expect(launcher).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("explains a wide entry set aside by a narrower one in the other file", async () => {
    const root = tree({
      "audit.ignore.config.json": [
        { id: GHSA, package: "zod", reason: "wide" },
      ],
      "audit.ignore.local.json": [SCOPED],
    });
    expect(await auditExceptionViolations(root)).toEqual([]);
    const text = (await auditExceptionObservations(root)).join("\n");
    expect(text).toContain(
      "`audit.ignore.local.json` lists the specific copies that were reviewed"
    );
    expect(text).toContain("ignores the wider one");
  });

  it("says a package-less wide entry is set aside only for the narrower entry's package", async () => {
    const root = tree({
      "audit.ignore.config.json": [{ id: GHSA, reason: "advisory-wide" }],
      "audit.ignore.local.json": [SCOPED],
    });
    const text = (await auditExceptionObservations(root)).join("\n");
    // The gate still lets the wide entry decide findings in other packages.
    expect(text).toContain("only for `zod`");
    expect(text).not.toContain(
      `excuses advisory \`${GHSA}\` for every copy, but`
    );
  });

  it("recognizes the same advisory when one entry names it by CVE", async () => {
    const CVE = "CVE-2026-4521";
    const root = tree({
      "audit.ignore.config.json": [
        { id: "GHSA-0000-0000-0000", cve: CVE, package: "zod", reason: "wide" },
      ],
      "audit.ignore.local.json": [{ ...SCOPED, id: CVE }],
    });
    expect((await auditExceptionObservations(root)).join("\n")).toContain(
      "ignores the wider one"
    );
  });

  it("reads the lockfile once per run however many scoped entries exist", async () => {
    const spy = vi.spyOn(lockfile, "readAuditCopies");
    const root = tree({
      "audit.ignore.config.json": [SCOPED],
      "audit.ignore.local.json": [
        SCOPED,
        { ...SCOPED, id: "GHSA-1111-2222-3333" },
      ],
    });
    expect(await auditExceptionViolations(root)).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

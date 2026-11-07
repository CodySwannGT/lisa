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

  it.each(["url", "title", "expires"])(
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

/**
 * PR #4693 review findings on the canonical audit (#4521).
 *
 * - The registry route picks its package manager with the same precedence as
 *   the pre-push hook's `lisa_detect_pm`: `packageManager`, then an engines
 *   `please-use-<pm>` sentinel, then lockfiles a sentinel does not forbid.
 * - An npm workspace's source entry (`packages/app`) is not an installed copy
 *   and must not fail every scoped exclusion in a monorepo.
 * Controlled fixtures only.
 * @module tests/unit/core/audit-review-4693
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  detectAuditManager,
  evaluateAuditReport,
} from "../../../src/core/audit.js";

const GHSA = "GHSA-aaaa-bbbb-cccc";
const roots: string[] = [];

/**
 * Write an isolated tree.
 * @param files - File name to content
 * @returns The fixture root
 */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "lisa-audit-review-"));
  roots.push(root);
  for (const [file, content] of Object.entries(files))
    writeFileSync(join(root, file), content);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("detectAuditManager follows the hook's lisa_detect_pm precedence", () => {
  const BOTH = { "bun.lock": "{}", "package-lock.json": "{}" };

  it("prefers the packageManager field over any lockfile", () => {
    const root = tree({
      ...BOTH,
      "package.json": JSON.stringify({ packageManager: "npm@10.9.0" }),
    });
    expect(detectAuditManager(root)).toBe("npm");
  });

  it("honors an engines please-use sentinel over a stray lockfile", () => {
    const root = tree({
      ...BOTH,
      "package.json": JSON.stringify({ engines: { bun: "please-use-npm" } }),
    });
    expect(detectAuditManager(root)).toBe("npm");
  });

  it("skips a lockfile whose manager the engines forbid", () => {
    const root = tree({
      ...BOTH,
      "package.json": JSON.stringify({ engines: { bun: "do-not-use" } }),
    });
    expect(detectAuditManager(root)).toBe("npm");
  });

  it("falls back to lockfile priority without package.json hints", () => {
    expect(detectAuditManager(tree(BOTH))).toBe("bun");
    expect(
      detectAuditManager(tree({ "yarn.lock": "", "package-lock.json": "{}" }))
    ).toBe("yarn");
  });

  it("refuses a selected manager the audit cannot run, rather than guessing", () => {
    const root = tree({
      ...BOTH,
      "package.json": JSON.stringify({ packageManager: "pnpm@9.0.0" }),
    });
    expect(() => detectAuditManager(root)).toThrow(/pnpm/u);
  });
});

describe("npm workspace source entries are not installed copies", () => {
  it("skips a versionless workspace source entry instead of failing", () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": { workspaces: ["packages/*"] },
        "packages/app": { name: "app" },
        "node_modules/app": { resolved: "packages/app", link: true },
        "node_modules/zod": { version: "4.6.7" },
        "node_modules/lint/node_modules/zod": { version: "3.25.76" },
      },
    });
    const report = JSON.stringify({
      vulnerabilities: {
        zod: {
          severity: "high",
          via: [
            {
              severity: "high",
              url: `https://github.com/advisories/${GHSA}`,
              name: "zod",
              range: "<4.6.6",
            },
          ],
        },
      },
    });
    const root = tree({
      "package-lock.json": lock,
      "audit.ignore.local.json": JSON.stringify({
        exclusions: [
          {
            id: GHSA,
            package: "zod",
            versions: "3.x",
            paths: ["node_modules/lint/node_modules/zod"],
            reason: "Controlled fixture",
          },
        ],
      }),
    });
    expect(evaluateAuditReport(root, "npm", report).passed).toBe(true);
  });
});

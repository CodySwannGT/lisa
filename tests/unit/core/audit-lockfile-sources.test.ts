/**
 * Non-registry lockfile entries never take the scoped audit down (#4521 review).
 *
 * A git, file, link, tarball, workspace or patch entry is not a copy a registry
 * advisory can describe. Treating it as unknown package data used to throw, so
 * any project with such an entry failed every scoped exclusion for a reason
 * unrelated to the advisory. Such entries are skipped; a registry identity that
 * genuinely cannot be parsed still fails closed.
 * Controlled fixtures only; no live advisory data.
 * @module tests/unit/core/audit-lockfile-sources
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { evaluateAuditReport } from "../../../src/core/audit.js";
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

describe("non-registry lockfile entries are not advisory copies (N2)", () => {
  it.each([
    ["git", "tool@git+https://example.invalid/tool.git#abc123"],
    ["git+ssh with user", "tool@git+ssh://git@example.invalid/tool.git#abc"],
    ["github", "tool@github:owner/tool#abc123"],
    ["file", "tool@file:../tool"],
    ["link", "tool@link:../tool"],
    ["tarball", "tool@https://example.invalid/tool-1.0.0.tgz"],
    ["root", "root@root:"],
    ["workspace", "@app/web@workspace:packages/web"],
  ])("bun %s entries are skipped, not fatal", (_, identity) => {
    const root = tree(
      { "audit.ignore.local.json": [SCOPED] },
      bunLock({ tool: [identity] })
    );
    expect(evaluateAuditReport(root, "bun", REPORT).passed).toBe(true);
  });

  it("bun still fails closed on a genuinely unparseable registry identity", () => {
    const root = tree(
      { "audit.ignore.local.json": [SCOPED] },
      bunLock({ tool: ["tool@not-a-version"] })
    );
    expect(() => evaluateAuditReport(root, "bun", REPORT)).toThrow(
      /Unknown lockfile package data at tool/u
    );
  });

  it.each([
    ["file", { version: "file:../tool" }],
    ["git", { version: "git+ssh://git@example.invalid/tool.git#abc" }],
    ["tarball", { version: "https://example.invalid/tool-1.0.0.tgz" }],
    [
      "git resolved without version",
      { resolved: "git+https://example.invalid/t.git" },
    ],
  ])("npm %s entries are skipped, not fatal", (_, entry) => {
    const npmReport = JSON.stringify({
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
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": {},
        "node_modules/zod": { version: "4.6.7" },
        "node_modules/lint-plugin/node_modules/zod": { version: "3.25.76" },
        "node_modules/tool": entry,
      },
    });
    const root = tree(
      {
        "audit.ignore.local.json": [
          { ...SCOPED, paths: ["node_modules/lint-plugin/node_modules/zod"] },
        ],
      },
      lock,
      "npm"
    );
    expect(evaluateAuditReport(root, "npm", npmReport).passed).toBe(true);
  });

  it.each([
    ["classic file", '"tool@file:../tool":\n  version "1.0.0"\n'],
    [
      "classic git",
      '"tool@git+https://example.invalid/tool.git#abc":\n  version "1.0.0"\n',
    ],
    [
      "classic tarball",
      '"tool@https://example.invalid/tool-1.0.0.tgz":\n  version "1.0.0"\n',
    ],
  ])("yarn %s entries are skipped, not fatal", (_, extra) => {
    const yarnReport = [
      {
        type: "auditAdvisory",
        data: {
          advisory: {
            severity: "high",
            url: `https://github.com/advisories/${GHSA}`,
            vulnerable_versions: "<4.6.6",
            module_name: "zod",
          },
        },
      },
      {
        type: "auditSummary",
        data: { vulnerabilities: { high: 1, critical: 0 } },
      },
    ]
      .map(value => JSON.stringify(value))
      .join("\n");
    const lock = `# yarn lockfile v1\n\nzod@^4.6.7:\n  version "4.6.7"\n\nzod@^3.22.4:\n  version "3.25.76"\n\n${extra}`;
    const root = tree(
      { "audit.ignore.local.json": [{ ...SCOPED, paths: ["zod@^3.22.4"] }] },
      lock,
      "yarn"
    );
    expect(evaluateAuditReport(root, "yarn", yarnReport).passed).toBe(true);
  });

  it("yarn berry workspace and patch entries are skipped, not fatal", () => {
    const lock = [
      "__metadata:",
      "  version: 8",
      '"zod@npm:^3":',
      "  version: 3.25.76",
      '  resolution: "zod@npm:3.25.76"',
      '"app@workspace:.":',
      "  version: 0.0.0-use.local",
      '  resolution: "app@workspace:."',
      '"tool@patch:tool@npm%3A1.0.0#./tool.patch::locator=app%40workspace%3A.":',
      "  version: 1.0.0",
      "",
    ].join("\n");
    const yarnReport = [
      {
        type: "auditAdvisory",
        data: {
          advisory: {
            severity: "high",
            url: `https://github.com/advisories/${GHSA}`,
            vulnerable_versions: "<4.6.6",
            module_name: "zod",
          },
        },
      },
      {
        type: "auditSummary",
        data: { vulnerabilities: { high: 1, critical: 0 } },
      },
    ]
      .map(value => JSON.stringify(value))
      .join("\n");
    const root = tree(
      { "audit.ignore.local.json": [{ ...SCOPED, paths: ["zod@npm:^3"] }] },
      lock,
      "yarn"
    );
    expect(evaluateAuditReport(root, "yarn", yarnReport).passed).toBe(true);
  });
});

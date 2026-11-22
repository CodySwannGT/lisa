/** Controlled npm/Yarn lockfile fixtures exercise real parsers and alias identities. */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateAuditReport } from "../../../src/core/audit.js";
import type { AuditManager } from "../../../src/core/audit.js";

const GHSA = "GHSA-aaaa-bbbb-cccc";
const roots: string[] = [];
const NPM_ALIAS_PATH = "node_modules/legacy-zod";

/**
 * Read a controlled report through the actual shared evaluator.
 * @param manager - Package manager whose report and lockfile are evaluated
 * @param lock - Controlled lockfile contents
 * @param paths - Exact listed lockfile keys in this controlled fixture
 * @param range - Allowed installed-version range in this controlled fixture
 * @returns The validated result described above
 */
function evaluate(
  manager: AuditManager,
  lock: string,
  paths: string[],
  range = "3.x"
) {
  const root = mkdtempSync(join(tmpdir(), "lisa-audit-locks-"));
  const file = manager === "npm" ? "package-lock.json" : "yarn.lock";
  const advisory = {
    severity: "high",
    url: `https://github.com/advisories/${GHSA}`,
    vulnerable_versions: "<4.6.6",
    name: "zod",
  };
  const report =
    manager === "npm"
      ? JSON.stringify({
          vulnerabilities: {
            zod: { severity: "high", via: [{ ...advisory, range: "<4.6.6" }] },
          },
        })
      : [
          {
            type: "auditAdvisory",
            data: { advisory: { ...advisory, module_name: "zod" } },
          },
          {
            type: "auditSummary",
            data: { vulnerabilities: { high: 1, critical: 0 } },
          },
        ]
          .map(value => JSON.stringify(value))
          .join("\n");
  roots.push(root);
  writeFileSync(join(root, file), lock);
  writeFileSync(
    join(root, "audit.ignore.local.json"),
    JSON.stringify({
      exclusions: [
        {
          id: GHSA,
          package: "zod",
          versions: range,
          paths,
          reason: "Controlled fixture",
        },
      ],
    })
  );
  return evaluateAuditReport(root, manager, report);
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("canonical audit lockfile formats", () => {
  it("npm resolves alias identities from packages names and exact versions", () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": {},
        "node_modules/lint/node_modules/zod": { version: "3.25.76" },
        "node_modules/legacy-zod": { name: "zod", version: "3.25.76" },
        "node_modules/zod": { version: "4.6.7" },
      },
    });
    const bad = evaluate("npm", lock, ["node_modules/lint/node_modules/zod"]);
    expect(bad.passed).toBe(false);
    expect(bad.messages.join("\n")).toContain(NPM_ALIAS_PATH);
    expect(
      evaluate("npm", lock, [
        "node_modules/lint/node_modules/zod",
        NPM_ALIAS_PATH,
      ]).passed
    ).toBe(true);
  });

  it("npm also understands the legacy npm: alias version representation", () => {
    const lock = JSON.stringify({
      packages: { "node_modules/legacy-zod": { version: "npm:zod@3.25.76" } },
    });
    expect(evaluate("npm", lock, [NPM_ALIAS_PATH]).passed).toBe(true);
  });

  it("Yarn classic keys preserve aliased selectors as paths", () => {
    const lock =
      '# yarn lockfile v1\n\nzod@^3.0.0:\n  version "3.25.76"\n\n"legacy-zod@npm:zod@^3":\n  version "3.25.76"\n';
    const bad = evaluate("yarn", lock, ["zod@^3.0.0"]);
    expect(bad.passed).toBe(false);
    expect(bad.messages.join("\n")).toContain("legacy-zod@npm:zod@^3");
    expect(
      evaluate("yarn", lock, ["zod@^3.0.0", "legacy-zod@npm:zod@^3"]).passed
    ).toBe(true);
  });

  it("Yarn Berry metadata can start at byte zero", () => {
    const lock =
      '__metadata:\n  version: 8\n"zod@npm:^3":\n  version: 3.25.76\n  resolution: "zod@npm:3.25.76"\n';
    expect(evaluate("yarn", lock, ["zod@npm:^3"]).passed).toBe(true);
  });

  it.each(["", "# yarn lockfile v1\n", "broken {{{"])(
    "Yarn cannot establish scoped coverage from %j",
    lock => {
      expect(() => evaluate("yarn", lock, ["zod@^3"])).toThrow(
        /Cannot evaluate scoped audit exclusions from yarn.lock/u
      );
    }
  );

  it("npm v1's missing packages map fails clearly rather than becoming id-wide", () => {
    expect(() =>
      evaluate("npm", '{"lockfileVersion":1,"dependencies":{}}', [
        "node_modules/zod",
      ])
    ).toThrow("packages map");
  });
});

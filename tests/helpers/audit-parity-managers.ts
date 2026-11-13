/**
 * Controlled per-manager lockfiles and reports for the audit-consumer parity
 * test (#4521). Every byte here is fixture data, never a live advisory
 * response; the consumers that read it are real.
 * @module tests/helpers/audit-parity-managers
 */
import type { AuditManager } from "../../src/core/audit.js";

export const PARITY_GHSA = "GHSA-aaaa-bbbb-cccc";
export const PARITY_VULNERABLE = "3.25.76";

/** zod 4.5.0 is still below the 4.6.6 fix, but outside a zod 3.x scope. */
export const PARITY_ZOD4 = "4.5.0";

/**
 * The version the reviewed dev-only copy resolves to for a scenario.
 * @param kind - Scope boundary scenario name; `zod4-*` puts zod 4.5.0 there
 * @returns The dev copy's resolved version
 */
const devVersion = (kind: string): string =>
  kind.startsWith("zod4-") ? PARITY_ZOD4 : PARITY_VULNERABLE;

const ADVISORY = {
  severity: "high",
  id: 123,
  url: `https://github.com/advisories/${PARITY_GHSA}`,
  vulnerable_versions: "<4.6.6",
};

/** Per-manager controlled lockfile, report, and the lockfile key of each copy. */
export const PARITY_MANAGERS = {
  bun: {
    lockfile: "bun.lock",
    devPath: "lint-plugin/zod",
    aliasPath: "legacy-zod",
    lock: (kind: string) =>
      JSON.stringify({
        packages: {
          zod: ["zod@4.6.7"],
          "lint-plugin/zod": [`zod@${devVersion(kind)}`],
          ...(kind === "alias"
            ? { "legacy-zod": [`zod@${PARITY_VULNERABLE}`] }
            : {}),
          ...(kind === "production" || kind === "shadowed"
            ? { "production/zod": [`zod@${PARITY_VULNERABLE}`] }
            : {}),
        },
      }),
    report: JSON.stringify({ zod: [ADVISORY] }),
  },
  npm: {
    lockfile: "package-lock.json",
    devPath: "node_modules/lint-plugin/node_modules/zod",
    aliasPath: "node_modules/legacy-zod",
    lock: (kind: string) =>
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": {},
          "node_modules/zod": { version: "4.6.7" },
          "node_modules/lint-plugin/node_modules/zod": {
            version: devVersion(kind),
          },
          ...(kind === "alias"
            ? {
                "node_modules/legacy-zod": {
                  name: "zod",
                  version: PARITY_VULNERABLE,
                },
              }
            : {}),
        },
      }),
    report: JSON.stringify({
      vulnerabilities: {
        zod: {
          severity: "high",
          via: [{ ...ADVISORY, name: "zod", range: "<4.6.6" }],
        },
      },
    }),
  },
  yarn: {
    lockfile: "yarn.lock",
    devPath: "zod@^3.22.4",
    aliasPath: "legacy-zod@npm:zod@^3",
    lock: (kind: string) =>
      `# yarn lockfile v1\n\nzod@^4.6.7:\n  version "4.6.7"\n\nzod@^3.22.4:\n  version "${devVersion(kind)}"\n${
        kind === "alias"
          ? `\n"legacy-zod@npm:zod@^3":\n  version "${PARITY_VULNERABLE}"\n`
          : ""
      }`,
    report: [
      {
        type: "auditAdvisory",
        data: { advisory: { ...ADVISORY, module_name: "zod" } },
      },
      {
        type: "auditSummary",
        data: { vulnerabilities: { high: 1, critical: 0 } },
      },
    ]
      .map(value => JSON.stringify(value))
      .join("\n"),
  },
} as const satisfies Record<AuditManager, unknown>;

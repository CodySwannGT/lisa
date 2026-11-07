/**
 * Isolated controlled reports exercise the actual hook, registry task and CI fallback.
 *
 * Every report below is controlled fixture data written by this test, never a
 * live advisory response. What is real is each consumer: the pre-push hook's
 * own package-manager dispatch (its bun, npm and yarn branches, extracted
 * unmodified), the resolved `dependency-vulnerability` registry command, the
 * CI action runner, and the exported helper. They must agree on one tree.
 * @module tests/integration/audit-consumer-parity
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveMoment } from "../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { evaluateAuditReport } from "../../src/core/audit.js";
import type { AuditManager } from "../../src/core/audit.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { createAuditActionCheckout } from "../helpers/audit-action-fixture.js";

useIoLatencyBudget();
const ROOT = process.cwd();
const GHSA = "GHSA-aaaa-bbbb-cccc";
const VULNERABLE = "3.25.76";
/** A package the advisory does not name: excluding it must not excuse zod. */
const OTHER_PACKAGE = "left-pad";
const PACKAGE_MISMATCH = `outside exclusion package ${OTHER_PACKAGE}`;
const PACKAGE_MISMATCH_KIND = "package-mismatch";
const roots: string[] = [];
const ADVISORY = {
  severity: "high",
  id: 123,
  url: `https://github.com/advisories/${GHSA}`,
  vulnerable_versions: "<4.6.6",
};

/** Per-manager controlled lockfile, report, and the lockfile key of each copy. */
const MANAGERS = {
  bun: {
    lockfile: "bun.lock",
    devPath: "lint-plugin/zod",
    aliasPath: "legacy-zod",
    lock: (kind: string) =>
      JSON.stringify({
        packages: {
          zod: ["zod@4.6.7"],
          "lint-plugin/zod": [`zod@${VULNERABLE}`],
          ...(kind === "alias" ? { "legacy-zod": [`zod@${VULNERABLE}`] } : {}),
          ...(kind === "production"
            ? { "production/zod": [`zod@${VULNERABLE}`] }
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
          "node_modules/lint-plugin/node_modules/zod": { version: VULNERABLE },
          ...(kind === "alias"
            ? {
                "node_modules/legacy-zod": { name: "zod", version: VULNERABLE },
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
      `# yarn lockfile v1\n\nzod@^4.6.7:\n  version "4.6.7"\n\nzod@^3.22.4:\n  version "${VULNERABLE}"\n${
        kind === "alias"
          ? `\n"legacy-zod@npm:zod@^3":\n  version "${VULNERABLE}"\n`
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

const SCRIPT = "node scripts/lisa-audit.mjs";
const SCRIPTS = {
  "security:audit": "$npm_execpath run security:audit:lisa",
  "security:audit:lisa": SCRIPT,
};
const CI_BODY = 'node "$LISA_AUDIT_ACTION_RUNNER"';
const HOOK = fs
  .readFileSync("typescript/copy-contents/.husky/pre-push", "utf8")
  .split("\n");
// The hook's own manager dispatch: `if npm|yarn … elif bun … fi`, unmodified.
const DISPATCH = HOOK.findIndex(line =>
  line.includes(
    'if [ "$PACKAGE_MANAGER" = "npm" ] || [ "$PACKAGE_MANAGER" = "yarn" ]; then'
  )
);
const END = HOOK.findIndex(
  (line, index) => index > DISPATCH && line.includes("✅ No high or critical")
);
const HOOK_BODY = HOOK.slice(DISPATCH, END + 2).join("\n");
/** The real npm, so a stubbed `npm` can still run the registry's `npm run`. */
const REAL_NPM = boundedSpawnSync({
  label: "locate npm",
  command: "bash",
  args: ["-c", "command -v npm"],
}).stdout.trim();

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

/**
 * Select one controlled exclusion boundary.
 * @param kind - Boundary scenario name
 * @param devPath - The manager's lockfile key for the reviewed dev-only copy
 * @returns The exact exclusion fields used by all consumers
 */
function fixtureEntry(kind: string, devPath: string) {
  const scoped = {
    id: GHSA,
    package: "zod",
    versions: "3.x",
    paths: [devPath],
    reason: "Controlled fixture: lint-time options",
  };
  if (kind === "legacy")
    return { id: GHSA, reason: "Controlled legacy decision" };
  if (kind === "empty-paths") return { ...scoped, paths: [] };
  if (kind === "version-mismatch") return { ...scoped, versions: "4.x" };
  if (kind === PACKAGE_MISMATCH_KIND)
    return { ...scoped, package: OTHER_PACKAGE };
  return scoped;
}

/**
 * Write the stub for the manager's audit command; every other subcommand is real.
 * @param root - Isolated applied-host root
 * @param manager - The package manager under test
 */
function writeManagerStub(root: string, manager: AuditManager): void {
  const passthrough = manager === "npm" ? 'exec "$LISA_REAL_NPM" "$@"\n' : "";
  fs.writeFileSync(
    path.join(root, "bin", manager),
    `#!/bin/sh\nif [ "$1" = audit ]; then cat "$AUDIT_FIXTURE_REPORT"; exit 1; fi\n${passthrough}exit 97\n`,
    { mode: 0o755 }
  );
}

/**
 * Build one applied-host layout with real package resolution and controlled report bytes.
 * @param kind - The scope boundary to exercise
 * @param manager - The package manager whose lockfile and report are written
 * @returns The isolated root containing exact inputs shared by every consumer
 */
function fixture(kind: string, manager: AuditManager = "bun"): string {
  const shape = MANAGERS[manager];
  const root = fs.mkdtempSync(path.join(tmpdir(), "lisa-audit-parity-"));
  const action = createAuditActionCheckout(root);
  roots.push(root);
  fs.writeFileSync(
    path.join(root, "action-runner.txt"),
    path.join(action, "run.mjs")
  );
  fs.mkdirSync(path.join(root, "scripts"));
  fs.mkdirSync(path.join(root, "bin"));
  fs.mkdirSync(path.join(root, "node_modules/@codyswann"), { recursive: true });
  fs.symlinkSync(ROOT, path.join(root, "node_modules/@codyswann/lisa"), "dir");
  fs.copyFileSync(
    "all/copy-overwrite/scripts/lisa-audit.mjs",
    path.join(root, "scripts/lisa-audit.mjs")
  );
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "controlled-audit-parity-fixture",
      type: "module",
      scripts: SCRIPTS,
    })
  );
  fs.writeFileSync(
    path.join(root, "audit.ignore.local.json"),
    JSON.stringify({ exclusions: [fixtureEntry(kind, shape.devPath)] })
  );
  fs.writeFileSync(path.join(root, "report.json"), shape.report);
  if (kind !== "missing-lock")
    fs.writeFileSync(
      path.join(root, shape.lockfile),
      kind === "malformed-lock" ? '{"packages": broken}' : shape.lock(kind)
    );
  writeManagerStub(root, manager);
  return root;
}

/**
 * Execute an actual consumer body against the same controlled tree.
 * @param root - Isolated applied-host root
 * @param body - Unmodified consumer shell body or resolved registry command
 * @param manager - The package manager the hook and CI action select
 * @returns Its exit status and observable output
 */
function observe(root: string, body: string, manager: AuditManager) {
  const result = boundedSpawnSync({
    label: "canonical audit consumer parity",
    command: "bash",
    args: ["-e", "-c", body],
    cwd: root,
    env: {
      ...process.env,
      PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
      PACKAGE_MANAGER: manager,
      GITHUB_WORKSPACE: root,
      LISA_AUDIT_ACTION_DIRECTORY: ".",
      LISA_AUDIT_ACTION_MANAGER: manager,
      LISA_AUDIT_ACTION_RUNNER: fs.readFileSync(
        path.join(root, "action-runner.txt"),
        "utf8"
      ),
      LISA_REAL_NPM: REAL_NPM,
      AUDIT_FIXTURE_REPORT: path.join(root, "report.json"),
      LISA_AUDIT_RETRY_DELAY: "0",
    },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/**
 * Evaluate the identical bytes through the exported project-prover helper.
 * @param root - Isolated applied-host root
 * @param manager - The package manager whose report is evaluated
 * @returns Its verdict and the same operator diagnostic as CLI consumers
 */
function observeHelper(root: string, manager: AuditManager) {
  try {
    const verdict = evaluateAuditReport(
      root,
      manager,
      MANAGERS[manager].report
    );
    return {
      status: verdict.passed ? 0 : 1,
      output: verdict.messages.join("\n"),
    };
  } catch (error) {
    return { status: 1, output: (error as Error).message };
  }
}

/**
 * Run all four consumers and assert one verdict and one named diagnostic.
 * @param kind - The scope boundary to exercise
 * @param manager - The package manager under test
 * @param status - The expected exit status for every consumer
 * @param message - Text every consumer's output must contain
 */
function expectParity(
  kind: string,
  manager: AuditManager,
  status: number,
  message: string
): void {
  const root = fixture(kind, manager);
  const [gate] = resolveMoment({
    gates: { "dependency-vulnerability": { push: "required" } },
    moment: "push",
    runner: "npm run",
    scripts: SCRIPTS,
  });
  const helper = observeHelper(root, manager);
  expect(gate?.mode).toBe("run");
  expect(gate?.command).toBe("npm run security:audit");
  expect(DISPATCH).toBeGreaterThan(-1);
  expect(END).toBeGreaterThan(DISPATCH);
  expect(helper.status, helper.output).toBe(status);
  for (const body of [HOOK_BODY, gate?.command ?? "exit 98", CI_BODY]) {
    const result = observe(root, body, manager);
    expect(result.status, result.output).toBe(status);
    expect(result.output).toContain(message);
  }
}

describe("audit-consumer parity on the identical tree", () => {
  const bun = MANAGERS.bun;
  it.each([
    ["covered", 0, `excluded ${GHSA} for ${bun.devPath}`],
    ["production", 1, "production/zod"],
    ["alias", 1, bun.aliasPath],
    ["legacy", 0, "No high or critical"],
    [PACKAGE_MISMATCH_KIND, 1, PACKAGE_MISMATCH],
    ["empty-paths", 1, "paths must be a non-empty array"],
    ["missing-lock", 1, "bun.lock"],
    ["malformed-lock", 1, "Cannot parse bun.lock"],
    ["version-mismatch", 1, bun.devPath],
  ] as const)(
    "%s: hook, registry and CI agree and name the measured result",
    (kind, status, message) => {
      expectParity(kind, "bun", status, message);
    }
  );
});

describe.each(["npm", "yarn"] as const)(
  "audit-consumer parity through the hook's %s branch",
  manager => {
    const shape = MANAGERS[manager];
    it.each([
      ["covered", 0, `excluded ${GHSA} for ${shape.devPath}`],
      ["alias", 1, shape.aliasPath],
      ["legacy", 0, "No high or critical"],
      [PACKAGE_MISMATCH_KIND, 1, PACKAGE_MISMATCH],
    ] as const)(
      "%s: hook, registry and CI agree and name the measured result",
      (kind, status, message) => {
        expectParity(kind, manager, status, message);
      }
    );
  }
);

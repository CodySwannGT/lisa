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
import {
  PARITY_GHSA,
  PARITY_MANAGERS,
} from "../helpers/audit-parity-managers.js";

useIoLatencyBudget();
const ROOT = process.cwd();
const GHSA = PARITY_GHSA;
const MANAGERS = PARITY_MANAGERS;
/** A package the advisory does not name: excluding it must not excuse zod. */
const OTHER_PACKAGE = "left-pad";
const PACKAGE_MISMATCH = `outside exclusion package ${OTHER_PACKAGE}`;
const PACKAGE_MISMATCH_KIND = "package-mismatch";
const CLEAN = "No high or critical";
const VERSION_MISMATCH = "version-mismatch";
const MISSING_LOCK = "missing-lock";
const MALFORMED_LOCK = "malformed-lock";
/** #4509: a package+versions scope with no `paths`, on the zod 3.x copy. */
const VERSIONS_ONLY = "versions-only";
/** #4509: the same versions-only scope, but that copy is zod 4.5.0. */
const ZOD4_VERSIONS_ONLY = "zod4-versions-only";
const roots: string[] = [];

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
// The dispatch ends after the bun branch hands its captured report to the
// canonical matcher: that `if … fi`, then the dispatch's own `fi`.
const END = HOOK.findIndex(
  (line, index) =>
    index > DISPATCH &&
    line.includes("node scripts/lisa-audit.mjs --manager bun --stdin")
);
const HOOK_BODY = HOOK.slice(DISPATCH, END + 4).join("\n");
/** The operator next step printed whenever a real finding fails the audit. */
const NEXT_STEP = "add its lockfile path to `paths` in audit.ignore.local.json";
/** The precise fail-closed diagnostic for a scoped entry without bun.lock. */
const NO_BUN_LOCK = "Cannot evaluate scoped audit exclusions from bun.lock";
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
  if (kind === VERSION_MISMATCH) return { ...scoped, versions: "4.x" };
  if (kind === VERSIONS_ONLY || kind === ZOD4_VERSIONS_ONLY) {
    const { paths: _paths, ...versionsOnly } = scoped;
    return versionsOnly;
  }
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
  if (kind === "shadowed")
    // A managed package-wide decision for the same advisory and package.
    fs.writeFileSync(
      path.join(root, "audit.ignore.config.json"),
      JSON.stringify({
        exclusions: [{ id: GHSA, package: "zod", reason: "Managed wide" }],
      })
    );
  fs.writeFileSync(path.join(root, "report.json"), shape.report);
  if (kind === "lockb-only")
    // Binary lockfile: selects bun, but cannot establish path coverage.
    fs.writeFileSync(path.join(root, "bun.lockb"), "");
  else if (kind !== MISSING_LOCK)
    fs.writeFileSync(
      path.join(root, shape.lockfile),
      kind === MALFORMED_LOCK ? '{"packages": broken}' : shape.lock(kind)
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
      threw: false,
    };
  } catch (error) {
    return { status: 1, output: (error as Error).message, threw: true };
  }
}

/**
 * Run all four consumers and assert one verdict and one named diagnostic.
 * @param kind - The scope boundary to exercise
 * @param manager - The package manager under test
 * @param status - The expected exit status for every consumer
 * @param message - Text every consumer's output must contain
 * @param registryMessage - What the registry task says instead, when it must
 *   first detect the manager from the lockfile the others are told about
 */
function expectParity(
  kind: string,
  manager: AuditManager,
  status: number,
  message: string,
  registryMessage = message
): void {
  const root = fixture(kind, manager);
  const [gate] = resolveMoment({
    gates: { "dependency-vulnerability": { push: "required" } },
    moment: "push",
    runner: "npm run",
    scripts: SCRIPTS,
  });
  const helper = observeHelper(root, manager);
  const registry = gate?.command ?? "exit 98";
  expect(gate?.mode).toBe("run");
  expect(gate?.command).toBe("npm run security:audit");
  expect(DISPATCH).toBeGreaterThan(-1);
  expect(END).toBeGreaterThan(DISPATCH);
  expect(helper.status, helper.output).toBe(status);
  // The helper returns verdict messages only; the CLI success line is not one.
  if (!(status === 0 && message === CLEAN))
    expect(helper.output).toContain(message);
  for (const body of [HOOK_BODY, registry, CI_BODY]) {
    const result = observe(root, body, manager);
    expect(result.status, result.output).toBe(status);
    expect(result.output).toContain(
      body === registry ? registryMessage : message
    );
    // A real finding (not a fail-closed input) always says what to do next.
    if (status === 1 && !helper.threw)
      expect(result.output).toContain(NEXT_STEP);
  }
}

describe("audit-consumer parity on the identical tree", () => {
  const bun = MANAGERS.bun;
  it.each([
    ["covered", 0, `excluded ${GHSA} for ${bun.devPath}`],
    ["production", 1, "production/zod"],
    ["alias", 1, bun.aliasPath],
    ["legacy", 0, CLEAN],
    [PACKAGE_MISMATCH_KIND, 1, PACKAGE_MISMATCH],
    ["shadowed", 1, "advisory-wide exclusion was not applied"],
    ["empty-paths", 1, "paths must be a non-empty array"],
    // With no lockfile at all the registry task cannot even pick a manager.
    [MISSING_LOCK, 1, NO_BUN_LOCK, "No supported audit lockfile found"],
    ["lockb-only", 1, NO_BUN_LOCK],
    [MALFORMED_LOCK, 1, "Cannot parse bun.lock"],
    [VERSION_MISMATCH, 1, bun.devPath],
    // Same advisory, same listed path, but zod 4.5.0 is outside the 3.x scope.
    ["zod4-on-listed-path", 1, `${bun.devPath} (zod@4.5.0)`],
    // #4509: package+versions with no paths accepts zod 3.x, rejects zod 4.5.0.
    [VERSIONS_ONLY, 0, `excluded ${GHSA} for ${bun.devPath}`],
    [ZOD4_VERSIONS_ONLY, 1, `${bun.devPath} (zod@4.5.0)`],
  ] as const)(
    "%s: hook, registry and CI agree and name the measured result",
    (kind, status, message, registryMessage?: string) => {
      expectParity(kind, "bun", status, message, registryMessage);
    }
  );
});

describe.each(["npm", "yarn"] as const)(
  "audit-consumer parity through the hook's %s branch",
  manager => {
    const shape = MANAGERS[manager];
    const unreadable = `Cannot evaluate scoped audit exclusions from ${shape.lockfile}`;
    it.each([
      ["covered", 0, `excluded ${GHSA} for ${shape.devPath}`],
      ["alias", 1, shape.aliasPath],
      ["legacy", 0, CLEAN],
      [PACKAGE_MISMATCH_KIND, 1, PACKAGE_MISMATCH],
      // With no lockfile at all the registry task cannot even pick a manager.
      [MISSING_LOCK, 1, unreadable, "No supported audit lockfile found"],
      [MALFORMED_LOCK, 1, unreadable],
      [VERSION_MISMATCH, 1, shape.devPath],
      [VERSIONS_ONLY, 0, `excluded ${GHSA} for ${shape.devPath}`],
      [ZOD4_VERSIONS_ONLY, 1, `${shape.devPath} (zod@4.5.0)`],
    ] as const)(
      "%s: hook, registry and CI agree and name the measured result",
      (kind, status, message, registryMessage?: string) => {
        expectParity(kind, manager, status, message, registryMessage);
      }
    );
  }
);

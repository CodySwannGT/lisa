/** Isolated controlled reports exercise the actual hook, registry task and CI fallback. */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveMoment } from "../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { evaluateAuditReport } from "../../src/core/audit.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { createAuditActionCheckout } from "../helpers/audit-action-fixture.js";

useIoLatencyBudget();
const ROOT = process.cwd();
const GHSA = "GHSA-aaaa-bbbb-cccc";
const DEV_PATH = "lint-plugin/zod";
const VULNERABLE_ZOD = "zod@3.25.76";
const roots: string[] = [];
const EXCLUSION = {
  id: GHSA,
  package: "zod",
  versions: "3.x",
  paths: [DEV_PATH],
  reason: "Controlled fixture: lint-time options",
};
const REPORT = JSON.stringify({
  zod: [
    {
      severity: "high",
      id: 123,
      url: `https://github.com/advisories/${GHSA}`,
      vulnerable_versions: "<4.6.6",
    },
  ],
});
const SCRIPT = "node scripts/lisa-audit.mjs";
const SCRIPTS = {
  "security:audit": "$npm_execpath run security:audit:lisa",
  "security:audit:lisa": SCRIPT,
};
const CI_BODY = 'node "$LISA_AUDIT_ACTION_RUNNER"';
const HOOK = fs
  .readFileSync("typescript/copy-contents/.husky/pre-push", "utf8")
  .split("\n");
const START = HOOK.findIndex(line => line.includes('AUDIT_OUTPUT="$('));
const END = HOOK.findIndex(
  (line, index) => index > START && line.includes("✅ No high or critical")
);
const HOOK_BODY = HOOK.slice(START, END + 1).join("\n");

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

/**
 * Select one controlled exclusion boundary.
 * @param kind - Boundary scenario name
 * @returns The exact exclusion fields used by all consumers
 */
function fixtureEntry(kind: string) {
  if (kind === "legacy")
    return { id: GHSA, reason: "Controlled legacy decision" };
  if (kind === "empty-paths") return { ...EXCLUSION, paths: [] };
  if (kind === "version-mismatch") return { ...EXCLUSION, versions: "4.x" };
  return EXCLUSION;
}

/**
 * Build one applied-host layout with real package resolution and controlled report bytes.
 * @param kind - The scope boundary to exercise
 * @returns The isolated root containing exact inputs shared by every consumer
 */
function fixture(kind: string): string {
  const root = fs.mkdtempSync(path.join(tmpdir(), "lisa-audit-parity-"));
  const action = createAuditActionCheckout(root);
  const packages = {
    zod: ["zod@4.6.7"],
    [DEV_PATH]: [VULNERABLE_ZOD],
    ...(kind === "alias" ? { "legacy-zod": [VULNERABLE_ZOD] } : {}),
    ...(kind === "production" ? { "production/zod": [VULNERABLE_ZOD] } : {}),
  };
  const entry = fixtureEntry(kind);
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
    JSON.stringify({ exclusions: [entry] })
  );
  fs.writeFileSync(path.join(root, "report.json"), REPORT);
  if (kind !== "missing-lock")
    fs.writeFileSync(
      path.join(root, "bun.lock"),
      kind === "malformed-lock"
        ? '{"packages": broken}'
        : JSON.stringify({ packages })
    );
  fs.writeFileSync(
    path.join(root, "bin/bun"),
    '#!/bin/sh\ncat "$AUDIT_FIXTURE_REPORT"\nexit 1\n',
    { mode: 0o755 }
  );
  return root;
}

/**
 * Execute an actual consumer body against the same controlled tree.
 * @param root - Isolated applied-host root
 * @param body - Unmodified consumer shell body or resolved registry command
 * @returns Its exit status and observable output
 */
function observe(root: string, body: string) {
  const result = boundedSpawnSync({
    label: "canonical audit consumer parity",
    command: "bash",
    args: ["-e", "-c", body],
    cwd: root,
    env: {
      ...process.env,
      PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
      PACKAGE_MANAGER: "bun",
      GITHUB_WORKSPACE: root,
      LISA_AUDIT_ACTION_DIRECTORY: ".",
      LISA_AUDIT_ACTION_MANAGER: "bun",
      LISA_AUDIT_ACTION_RUNNER: fs.readFileSync(
        path.join(root, "action-runner.txt"),
        "utf8"
      ),
      AUDIT_FIXTURE_REPORT: path.join(root, "report.json"),
      LISA_AUDIT_RETRY_DELAY: "0",
    },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/**
 * Evaluate the identical bytes through the exported project-prover helper.
 * @param root - Isolated applied-host root
 * @returns Its verdict and the same operator diagnostic as CLI consumers
 */
function observeHelper(root: string) {
  try {
    const verdict = evaluateAuditReport(root, "bun", REPORT);
    return {
      status: verdict.passed ? 0 : 1,
      output: verdict.messages.join("\n"),
    };
  } catch (error) {
    return { status: 1, output: (error as Error).message };
  }
}

describe("audit-consumer parity on the identical tree", () => {
  it.each([
    ["covered", 0, `excluded ${GHSA} for ${DEV_PATH}`],
    ["production", 1, "production/zod"],
    ["alias", 1, "legacy-zod"],
    ["legacy", 0, "No high or critical"],
    ["empty-paths", 1, "paths must be a non-empty array"],
    ["missing-lock", 1, "bun.lock"],
    ["malformed-lock", 1, "Cannot parse bun.lock"],
    ["version-mismatch", 1, DEV_PATH],
  ] as const)(
    "%s: hook, registry and CI agree and name the measured result",
    (kind, status, message) => {
      const root = fixture(kind);
      const [gate] = resolveMoment({
        gates: { "dependency-vulnerability": { push: "required" } },
        moment: "push",
        runner: "npm run",
        scripts: SCRIPTS,
      });
      expect(gate?.mode).toBe("run");
      expect(gate?.command).toBe("npm run security:audit");
      expect(START).toBeGreaterThan(-1);
      expect(END).toBeGreaterThan(START);
      expect(observeHelper(root).status).toBe(status);
      for (const body of [HOOK_BODY, gate?.command ?? "exit 98", CI_BODY]) {
        const result = observe(root, body);
        expect(result.status, result.output).toBe(status);
        expect(result.output).toContain(message);
      }
    }
  );
});

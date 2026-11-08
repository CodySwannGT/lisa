/**
 * The registry's dependency-vulnerability gate reports a real finding as a
 * FAILED verdict about the code, not as UNPROVABLE (#4521).
 *
 * The push was already blocked either way. What was wrong was the sentence the
 * operator read: "no recognised failure signature: Lisa could not read this
 * tool's output, so nothing here is a verdict about the code" — about an audit
 * that had read the lockfile, named the uncovered copy, and said so. That
 * sends an operator to re-run a check that measured exactly what it should.
 *
 * Runs the actual registry route (`runGates` → `npm run security:audit` →
 * scripts/lisa-audit.mjs → the canonical matcher) on a controlled tree whose
 * only fake is the package manager's `audit` subcommand.
 * @module tests/integration/audit-registry-verdict
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  runGates,
  STATE,
} from "../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import {
  PARITY_GHSA,
  PARITY_MANAGERS,
} from "../helpers/audit-parity-managers.js";

useIoLatencyBudget();
const ROOT = process.cwd();
const GATE = "dependency-vulnerability";
const UNREADABLE = "no recognised failure signature";
const BUN = PARITY_MANAGERS.bun;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

/**
 * An applied host with the governed audit task and a controlled tree.
 * @param lock - bun.lock text
 * @returns The fixture root
 */
function host(lock: string): string {
  const root = fs.mkdtempSync(path.join(tmpdir(), "lisa-audit-registry-"));
  roots.push(root);
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
      name: "controlled-audit-registry-fixture",
      type: "module",
      scripts: {
        "security:audit": "$npm_execpath run security:audit:lisa",
        "security:audit:lisa": "node scripts/lisa-audit.mjs",
      },
    })
  );
  fs.writeFileSync(
    path.join(root, "audit.ignore.local.json"),
    JSON.stringify({
      exclusions: [
        {
          id: PARITY_GHSA,
          package: "zod",
          versions: "3.x",
          paths: [BUN.devPath],
          reason: "Controlled fixture: lint-time options",
        },
      ],
    })
  );
  fs.writeFileSync(path.join(root, "report.json"), BUN.report);
  fs.writeFileSync(path.join(root, BUN.lockfile), lock);
  fs.writeFileSync(
    path.join(root, "bin/bun"),
    '#!/bin/sh\ncat "$AUDIT_FIXTURE_REPORT"\nexit 1\n',
    { mode: 0o755 }
  );
  return root;
}

/**
 * Run the registry's dependency-vulnerability gate at push in a host.
 * @param root - Fixture root
 * @returns The gate's recorded verdict
 */
function registryVerdict(root: string) {
  const exec = (command: string) => {
    const result = boundedSpawnSync({
      label: "registry dependency-vulnerability gate",
      command: "bash",
      args: ["-c", command],
      cwd: root,
      env: {
        ...process.env,
        PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
        AUDIT_FIXTURE_REPORT: path.join(root, "report.json"),
        LISA_AUDIT_RETRY_DELAY: "0",
      },
    });
    return { code: result.status, output: `${result.stdout}${result.stderr}` };
  };
  const run = runGates({
    gates: { [GATE]: { push: "required" } },
    moment: "push",
    runner: "npm run",
    exec,
    out: () => undefined,
    scripts: JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8")
    ).scripts,
    priorKills: [],
    recordKill: () => false,
    interrupted: () => null,
  });
  return run.results.find((entry: { id: string }) => entry.id === GATE);
}

describe("registry dependency-vulnerability verdicts", () => {
  it("reports an uncovered vulnerable copy as FAILED and names it", () => {
    const verdict = registryVerdict(host(BUN.lock("production")));
    expect(verdict?.state).toBe(STATE.FAILED);
    expect(verdict?.detail).not.toContain(UNREADABLE);
    const evidence = (verdict?.evidence ?? []).join("\n");
    expect(evidence).toContain("❌ High or critical vulnerabilities found");
  });

  it("reports a fail-closed audit input as FAILED with the audit's own line", () => {
    const verdict = registryVerdict(host('{"packages": broken}'));
    expect(verdict?.state).toBe(STATE.FAILED);
    expect(verdict?.detail).not.toContain(UNREADABLE);
    expect((verdict?.evidence ?? []).join("\n")).toContain(
      "Security audit failed closed"
    );
  });

  it("still passes a tree whose only vulnerable copy is covered", () => {
    expect(registryVerdict(host(BUN.lock("covered")))?.state).toBe(
      STATE.PASSED
    );
  });
});

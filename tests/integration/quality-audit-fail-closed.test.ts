/**
 * Execute the real `🔒 Run security audit` fallback against stub package
 * managers.
 *
 * The fallback is marked `unconditional` in lisa-gates.mjs, which lets a
 * mode-only `dependency-vulnerability` declaration delegate to it instead of
 * to the unshipped `security:audit` task (#3359). That flag is only honest
 * while an audit that never ran cannot pass, so each package-manager branch is
 * run here with no report, an error report, a clean report and a finding.
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { stepsIn } from "./quality-gate-facade-fixture.js";

useIoLatencyBudget();

const audit = stepsIn("npm_security_scan").find(
  step => step.name === "🔒 Run security audit"
);
// The step reads its exclusion list from a prior step's outputs; an empty
// list is the shape a project with no audit.ignore files produces.
const body = (audit?.run ?? "exit 99").replace(/\$\{\{[^}]*\}\}/gu, "");
const roots: string[] = [];
const NOT_RUN = "nothing was audited";
const CLEAN = "No high or critical vulnerabilities found";

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

// Replays `out-<n>` on the n-th call (falling back to `out`) and counts calls.
const STUB = [
  "#!/bin/bash",
  'n=$(( $(cat "$STUB_DIR/count" 2>/dev/null || echo 0) + 1 ))',
  'echo "$n" > "$STUB_DIR/count"',
  'f="$STUB_DIR/out-$n"; [ -f "$f" ] || f="$STUB_DIR/out"',
  '[ -f "$f" ] && cat "$f"',
  "exit 1",
].join("\n");

/**
 * Run the fallback for one package manager with scripted audit output.
 * @param manager - Value of PACKAGE_MANAGER
 * @param outputs - Stub output files, keyed `out` or `out-<attempt>`
 * @returns Exit status, combined output and audit invocation count
 */
function run(manager: string, outputs: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(tmpdir(), "lisa-audit-fail-closed-"));
  const bin = path.join(root, "bin");
  const stub = path.join(root, "stub");
  // The retry delay is real time in CI and dead time here.
  const executables = { [manager]: STUB, sleep: "#!/bin/sh\nexit 0\n" };
  roots.push(root);
  for (const dir of [bin, stub]) fs.mkdirSync(dir);
  for (const [name, contents] of Object.entries(executables))
    fs.writeFileSync(path.join(bin, name), contents, { mode: 0o755 });
  for (const [name, contents] of Object.entries(outputs))
    fs.writeFileSync(path.join(stub, name), contents);
  return observe(manager, root, stub);
}

/**
 * Execute the step body inside a prepared fixture.
 * @param manager - Value of PACKAGE_MANAGER
 * @param root - Fixture root holding `bin/` stubs
 * @param stub - Directory the stub reads its outputs from
 * @returns Exit status, combined output and audit invocation count
 */
function observe(manager: string, root: string, stub: string) {
  const result = boundedSpawnSync({
    label: `quality audit fallback (${manager})`,
    command: "bash",
    // GitHub runs `run:` bodies as `bash -e {0}`.
    args: ["-e", "-c", body],
    cwd: root,
    baseMs: 20_000,
    env: {
      PATH: `${path.join(root, "bin")}:${process.env.PATH ?? ""}`,
      BASH_ENV: "/dev/null",
      ENV: "/dev/null",
      TMPDIR: root,
      PACKAGE_MANAGER: manager,
      STUB_DIR: stub,
    },
  });
  const count = Number(
    fs.readFileSync(path.join(stub, "count"), "utf8").trim()
  );
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    count,
  };
}

const HIGH_GHSA = "GHSA-aaaa-bbbb-cccc";
const reports = {
  npm: {
    clean: JSON.stringify({ auditReportVersion: 2, vulnerabilities: {} }),
    error: JSON.stringify({ error: { code: "ENOTFOUND" } }),
    high: JSON.stringify({
      vulnerabilities: {
        pkg: {
          severity: "high",
          via: [{ url: `https://github.com/advisories/${HIGH_GHSA}` }],
        },
      },
    }),
  },
  yarn: {
    clean: `${JSON.stringify({ type: "auditSummary", data: {} })}\n`,
    error: `${JSON.stringify({ type: "error", data: "request failed" })}\n`,
    high: [
      {
        type: "auditAdvisory",
        data: {
          advisory: {
            severity: "high",
            github_advisory_id: HIGH_GHSA,
            cves: [],
          },
        },
      },
      { type: "auditSummary", data: {} },
    ]
      .map(line => JSON.stringify(line))
      .join("\n"),
  },
  bun: {
    clean: "{}",
    error: "error: audit request failed",
    high: JSON.stringify({
      pkg: [
        {
          id: 1,
          severity: "high",
          url: `https://github.com/advisories/${HIGH_GHSA}`,
        },
      ],
    }),
  },
} as const;

describe.each(["npm", "yarn", "bun"] as const)(
  "the %s built-in audit fails closed",
  manager => {
    const report = reports[manager];

    it("fails, after retrying, when the audit prints nothing", () => {
      const result = run(manager, {});
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain(NOT_RUN);
      expect(result.output).not.toContain(CLEAN);
      expect(result.count).toBe(3);
    });

    it("fails when the audit prints something other than a report", () => {
      const result = run(manager, { out: report.error });
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain(NOT_RUN);
      expect(result.output).not.toContain(CLEAN);
    });

    it("passes a clean report even though the audit exited non-zero", () => {
      const result = run(manager, { out: report.clean });
      expect(result.status, result.output).toBe(0);
      expect(result.output).toContain(CLEAN);
      expect(result.count).toBe(1);
    });

    it("passes when a retry recovers from a transient empty report", () => {
      const result = run(manager, { "out-1": "", out: report.clean });
      expect(result.status, result.output).toBe(0);
      expect(result.output).toContain(CLEAN);
      expect(result.count).toBe(2);
    });

    it("fails on a high advisory as a finding, not as an unrun audit", () => {
      const result = run(manager, { out: report.high });
      expect(result.status, result.output).toBe(1);
      expect(result.output).not.toContain(NOT_RUN);
      expect(result.output).toContain("high or critical vulnerabilities");
    });
  }
);

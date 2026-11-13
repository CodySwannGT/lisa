#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Resolve the current Lisa package's canonical audit implementation. */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

try {
  const root = process.cwd();
  const manifest = JSON.parse(
    readFileSync(resolve(root, "package.json"), "utf8")
  );
  const source =
    manifest.name === "@codyswann/lisa"
      ? pathToFileURL(resolve(root, "dist/core/audit.js")).href
      : "@codyswann/lisa/audit";
  const { evaluateAuditReport, runDependencyAudit, detectAuditManager } =
    await import(source);
  const managerIndex = process.argv.indexOf("--manager");
  const manager =
    managerIndex < 0
      ? detectAuditManager(root)
      : process.argv[managerIndex + 1];
  if (!["bun", "npm", "yarn"].includes(manager))
    throw new Error("Unsupported audit package manager");
  const verdict = process.argv.includes("--stdin")
    ? evaluateAuditReport(root, manager, readFileSync(0, "utf8"))
    : await runDependencyAudit(root, manager, {
        attempts: process.env.LISA_AUDIT_ATTEMPTS,
        retryDelay: process.env.LISA_AUDIT_RETRY_DELAY,
      });
  for (const message of verdict.messages) console.log(message);
  console.log(
    verdict.passed
      ? "✅ No high or critical vulnerabilities found in production dependencies (excluding documented exceptions)"
      : "❌ High or critical vulnerabilities found in production dependencies"
  );
  if (!verdict.passed)
    console.log(
      "   Next step: follow the lisa-security-audit-handling skill — upgrade or override the named copy; if it is dev-only and reviewed, add its lockfile path to `paths` in audit.ignore.local.json; if it affects the project and cannot be fixed, stop for a human. Never bypass this hook. See https://github.com/CodySwannGT/lisa/blob/main/docs/dependency-audit-exclusions.md"
    );
  process.exitCode = verdict.passed ? 0 : 1;
} catch (error) {
  // Two different failures, worded so a gate runner can tell them apart. A
  // capture that produced no usable report audited nothing: re-run it. Any
  // other error is the project's own exclusion or lockfile input, which no
  // re-run will fix, so it is reported as an invalid configuration.
  console.error(
    error?.name === "AuditCaptureError" ||
      ["ERR_MODULE_NOT_FOUND", "ERR_PACKAGE_PATH_NOT_EXPORTED"].includes(
        error?.code
      )
      ? `❌ Security audit failed closed: ${error.message}`
      : `❌ Security audit configuration invalid: ${error.message}`
  );
  process.exitCode = 1;
}

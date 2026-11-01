#!/usr/bin/env node
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
  process.exitCode = verdict.passed ? 0 : 1;
} catch (error) {
  console.error(`❌ Security audit failed closed: ${error.message}`);
  process.exitCode = 1;
}

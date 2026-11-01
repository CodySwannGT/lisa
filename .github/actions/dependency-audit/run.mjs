/**
 * The reusable workflow owns this action and the source beside it at one
 * immutable revision. A caller may have an older Lisa without ./audit or the
 * adapter script; neither can choose or replace the matcher used here.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { builtinModules } from "node:module";
import { build } from "esbuild";

const actionRoot = dirname(fileURLToPath(import.meta.url));
const source = resolve(actionRoot, "../../../src/core/audit.ts");
const workspace = resolve(process.env.GITHUB_WORKSPACE ?? process.cwd());
const root = resolve(workspace, process.env.LISA_AUDIT_ACTION_DIRECTORY ?? ".");
const manager = process.env.LISA_AUDIT_ACTION_MANAGER;
const scratch = mkdtempSync(join(tmpdir(), "lisa-audit-action-"));
const output = join(scratch, "audit.mjs");

try {
  if (!["bun", "npm", "yarn"].includes(manager)) {
    throw new Error("Unsupported audit package manager");
  }
  const bundled = await build({
    entryPoints: [source],
    outfile: output,
    absWorkingDir: actionRoot,
    nodePaths: [join(actionRoot, "node_modules")],
    bundle: true,
    platform: "node",
    // jsonc-parser's UMD main passes require as a parameter. Prefer its ESM
    // entry so internal relative loads are statically bundled, not deferred.
    mainFields: ["module", "main"],
    format: "esm",
    target: "node20",
    metafile: true,
    // Bundled CJS dependencies still require Node builtins at runtime.
    banner: {
      js: 'import { createRequire as actionCreateRequire } from "node:module"; const require = actionCreateRequire(import.meta.url);',
    },
  });
  const imports = Object.values(bundled.metafile.outputs).flatMap(
    value => value.imports
  );
  if (
    imports.some(
      value => !builtinModules.includes(value.path.replace(/^node:/u, ""))
    )
  ) {
    throw new Error(
      "Audit bundle retained an external dependency instead of the isolated action runtime"
    );
  }
  const { runDependencyAudit } = await import(pathToFileURL(output).href);
  const verdict = await runDependencyAudit(root, manager, {
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
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

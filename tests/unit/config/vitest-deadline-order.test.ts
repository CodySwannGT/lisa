/** Real Vitest must execute both physical-deadline suites before the bulk group. */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const FIXTURES = [
  ["integration/enforcement-fallback-freshness-deadline", "deadline"],
  ["integration/enforcement-fallback-freshness-anchor-startup", "anchor"],
  ["unit/bulk", "bulk"],
] as const;

/**
 * Materialize three actual suites and reuse the local config's scheduling plugin.
 * The fixture has no timing assertions: its append-only trace observes execution.
 * @param root - This case's disposable fixture root
 * @returns Native child configuration and execution trace paths
 */
function writeFixture(root: string): { config: string; trace: string } {
  const trace = path.join(root, "order.jsonl");
  const config = path.join(root, "vitest.config.ts");
  fs.symlinkSync(
    path.join(REPO_ROOT, "node_modules"),
    path.join(root, "node_modules"),
    "dir"
  );
  fs.writeFileSync(
    config,
    `import local from ${JSON.stringify(path.join(REPO_ROOT, "vitest.config.local.ts"))};\n` +
      `export default { plugins: local.plugins, test: { root: ${JSON.stringify(root)},\n` +
      `include: ['tests/**/*.test.ts'], exclude: [], isolate: true, maxWorkers: 2,\n` +
      `projects: local.test.projects, env: { ORDER_TRACE: ${JSON.stringify(trace)} } } };\n`
  );
  for (const [relative, label] of FIXTURES) {
    const file = path.join(root, "tests", `${relative}.test.ts`);
    const entry = JSON.stringify(`${label}\n`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      `import { test } from 'vitest';\nimport { appendFileSync } from 'node:fs';\n` +
        `test(${JSON.stringify(label)}, () => appendFileSync(process.env.ORDER_TRACE, ${entry}));\n`
    );
  }
  return { config, trace };
}

describe("native Vitest deadline scheduling", () => {
  it("executes both canonical deadline paths before any bulk suite", () => {
    const root = fs.mkdtempSync(path.join(tmpdir(), "lisa-vitest-order-"));
    try {
      const { config, trace } = writeFixture(root);
      const result = boundedSpawnSync({
        label: "real Vitest deadline-group ordering",
        command: process.execPath,
        args: [
          path.join(REPO_ROOT, "node_modules/vitest/vitest.mjs"),
          "run",
          "--config",
          config,
        ],
        cwd: root,
        env: { ...process.env, TMPDIR: root, TMP: root, TEMP: root },
      });
      const diagnostic = `${result.stdout}\n${result.stderr}`;
      expect(result.status, diagnostic).toBe(0);
      const order = fs.readFileSync(trace, "utf8").trim().split("\n");
      expect(
        [...order].sort((left, right) => left.localeCompare(right)),
        diagnostic
      ).toEqual(["anchor", "bulk", "deadline"]);
      expect(
        order,
        `Actual native execution order: ${order.join(", ")}`
      ).toEqual([...order.filter(label => label !== "bulk"), "bulk"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      expect(fs.existsSync(root)).toBe(false);
    }
  });
});

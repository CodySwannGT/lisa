/**
 * The managed declaration must survive the formatter a host already uses.
 * Keep a locked, monorepo-only 3.9 test alias alongside Lisa's unchanged 3.8
 * formatter. Running both genuine CLIs catches the reported version skew
 * without a per-test package download or a source-spelling oracle.
 */
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  boundedExecFileSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";

useIoLatencyBudget();

const ROOT = path.resolve(__dirname, "../..");
const DECLARATION = path.join(
  ROOT,
  "all/copy-overwrite/scripts/lib/usage-effectiveness.d.mts"
);
const require = createRequire(import.meta.url);
const FORMATTERS = [
  { packageJson: require.resolve("prettier/package.json"), version: "3.8.0" },
  {
    packageJson: require.resolve("prettier-compat-3-9/package.json"),
    version: "3.9.10",
  },
] as const;

describe("managed usage-effectiveness declaration formatter compatibility", () => {
  for (const formatter of FORMATTERS) {
    it(`passes the actual Prettier ${formatter.version} CLI without changing bytes`, () => {
      const packageRoot = path.dirname(formatter.packageJson);
      const cli = path.join(packageRoot, "bin/prettier.cjs");
      const run = (args: readonly string[]): string =>
        boundedExecFileSync({
          label: `Prettier ${formatter.version}`,
          command: process.execPath,
          args: [cli, ...args],
          baseMs: 30_000,
          cwd: ROOT,
        });

      expect(run(["--version"]).trim()).toBe(formatter.version);
      const before = fs.readFileSync(DECLARATION);
      const result = run([
        "--check",
        "--config",
        path.join(ROOT, ".prettierrc.json"),
        DECLARATION,
      ]);

      expect(result).toContain("All matched files use Prettier code style!");
      expect(fs.readFileSync(DECLARATION)).toEqual(before);
    });
  }
});

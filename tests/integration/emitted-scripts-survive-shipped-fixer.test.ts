/**
 * Proof that everything Lisa WRITES into a host survives what Lisa RUNS in that
 * host's pre-commit hook.
 *
 * Background (CodySwannGT/lisa#2788). `.lintstagedrc.json` — Lisa-managed —
 * runs `oxlint --fix` over staged `*.{js,mjs,ts,tsx,jsx}` using `.oxlintrc.json`
 * — also Lisa-managed. Seven scripts Lisa emits contained constructs that
 * ruleset auto-fixes, so committing rewrote them and the next `lisa apply`
 * wrote the original form back. Both directions are Lisa's, and a host has no
 * override surface to settle it, so a repo tracking those files could never be
 * apply-clean. Nothing broke at runtime; what broke is the signal. "The working
 * tree is clean after an apply" stops meaning anything once it can never be
 * true, and a check that can never pass is one people learn to ignore.
 *
 * The assertion is idempotence, not style: emit the files, run the fixer over
 * them, and require the bytes back unchanged. A test that only inspected the
 * emitted source for one banned construct would have passed before the fix and
 * after it, and would have pinned nothing — it would not have caught the second
 * rule (`unicorn/prefer-string-starts-ends-with`) that this one found in two
 * `copy-overwrite` scripts nobody had reported.
 *
 * Silence is not evidence here. The rules involved are `correctness`-category
 * at `warn`, oxlint exits 0 on warnings, and `--fix` rewrites the file before
 * reporting. The pre-fix run printed "Found 0 warnings and 0 errors" while
 * having just changed seven files. Only the byte comparison sees it.
 *
 * The shipped set is DISCOVERED from disk, never listed, so a new emitted
 * script — on any agent surface, in any stack template — inherits this
 * assertion without anyone remembering to add it.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import type { ProjectType } from "../../src/core/config.js";
import { SilentLogger } from "../../src/logging/silent-logger.js";
import { EnsureOxlintBaseConfigsMigration } from "../../src/migrations/ensure-oxlint-base-configs.js";
import {
  boundedExecFileSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";

// The bounded children below are handed a base that only fits under a case
// budget scaling with the same machine they do. Without this call the case
// budget is the flat one from `vitest.config.local.ts`, and the child's bound
// overtakes it from a slowdown of 4.0x up — a range measured on this box, in
// this tree, in the run that fixed CodySwannGT/lisa#3202.
useIoLatencyBudget();

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OXLINT_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "oxlint");

/** Stacks that ship a managed `.oxlintrc.json`, and so a managed fixer. */
const STACKS = [
  "typescript",
  "cdk",
  "expo",
  "nestjs",
  "phaser",
  "harper-fabric",
] as const;

/**
 * Trees whose scripts reach every host regardless of stack.
 *
 * `plugins/` covers all six agent surfaces at once: `plugins/src` is authored,
 * and `build-plugins.sh` copies it to the Claude, Codex, Cursor, Antigravity
 * and Copilot plugin trees, which the installers then write into `.claude/`,
 * `.codex/`, `.opencode/`, `.cursor/`, `.agy/` and `.github/`. Walking the
 * whole directory is what makes "fixed on one surface only" impossible.
 */
const UNIVERSAL_TREES = ["plugins", "all/copy-overwrite"] as const;

/** Extensions `.lintstagedrc.json` routes through `oxlint --fix`. */
const LINTED = new Set([".js", ".mjs", ".cjs"]);

/**
 * Every file beneath a directory that lint-staged would hand to oxlint.
 * @param dir - Absolute directory to walk; a missing one contributes nothing
 * @returns Absolute paths, in directory order
 */
function walkLintedScripts(dir: string): readonly string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkLintedScripts(full);
    return entry.isFile() && LINTED.has(path.extname(entry.name)) ? [full] : [];
  });
}

/**
 * The scripts Lisa installs into a host of a given stack, repo-relative.
 * @param stack - Stack template whose `copy-overwrite` tree also ships
 * @returns Repo-relative paths of every script that lands in the host
 */
function shippedScripts(stack: string): readonly string[] {
  return [...UNIVERSAL_TREES, `${stack}/copy-overwrite`]
    .flatMap(tree => walkLintedScripts(path.join(REPO_ROOT, tree)))
    .map(absolute => path.relative(REPO_ROOT, absolute));
}

/**
 * Materialize the shipped scripts alongside the `.oxlintrc.json` Lisa merges
 * into that stack, exactly as a host carries both.
 * @param stack - Stack template to build the host for
 * @param files - Repo-relative script paths to place
 * @returns Absolute path of the fixture directory
 */
async function buildHost(
  stack: string,
  files: readonly string[]
): Promise<string> {
  const host = fs.mkdtempSync(path.join(os.tmpdir(), `lisa-fixer-${stack}-`));
  for (const rel of files) {
    const dest = path.join(host, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, rel), dest);
  }
  fs.copyFileSync(
    path.join(REPO_ROOT, stack, "merge", ".oxlintrc.json"),
    path.join(host, ".oxlintrc.json")
  );
  // Vendors `oxlint/*.json` into `.lisa/lisa-oxlint/` and repoints `extends`,
  // which is what makes the host config resolvable without `node_modules`.
  await new EnsureOxlintBaseConfigsMigration().apply({
    projectDir: host,
    lisaDir: REPO_ROOT,
    detectedTypes: [stack as ProjectType],
    dryRun: false,
    logger: new SilentLogger(),
  });
  return host;
}

/**
 * Run the fixer the way the pre-commit hook does, over the whole tree.
 *
 * A non-zero exit means unfixable errors remain, which this test does not
 * judge — it only cares whether bytes moved.
 * @param cwd - Fixture directory to lint in place
 */
function runFixer(cwd: string): void {
  try {
    boundedExecFileSync({
      label: "oxlint --fix over the fixture",
      command: OXLINT_BIN,
      args: ["--fix", "--no-error-on-unmatched-pattern", "."],
      baseMs: 30_000,
      cwd,
      stdio: "pipe",
    });
  } catch {
    // Exit code is not the signal; the byte comparison below is.
  }
}

/**
 * First differing line between emitted and fixed content, for the failure text.
 * @param emitted - Bytes Lisa wrote
 * @param fixed - Bytes the fixer left behind
 * @returns A one-line before/after summary
 */
function firstDrift(emitted: string, fixed: string): string {
  const before = emitted.split("\n");
  const after = fixed.split("\n");
  const index = before.findIndex((line, i) => line !== after[i]);
  return `emitted: ${before[index]?.trim()} -> fixed: ${after[index]?.trim()}`;
}

describe("Lisa's emitted scripts are a fixed point of Lisa's shipped fixer (#2788)", () => {
  for (const stack of STACKS) {
    it(`${stack}: oxlint --fix rewrites nothing lisa apply emits`, async () => {
      const files = shippedScripts(stack);
      // Guards against a silent pass if the trees ever move and the walk finds
      // nothing to lint.
      expect(files.length).toBeGreaterThan(50);

      const host = await buildHost(stack, files);
      const emitted = new Map(
        files.map(rel => [rel, fs.readFileSync(path.join(host, rel), "utf8")])
      );
      runFixer(host);

      const rewritten = files
        .filter(
          rel =>
            fs.readFileSync(path.join(host, rel), "utf8") !== emitted.get(rel)
        )
        .map(
          rel =>
            `${rel} — ${firstDrift(
              emitted.get(rel) ?? "",
              fs.readFileSync(path.join(host, rel), "utf8")
            )}`
        );
      fs.rmSync(host, { recursive: true, force: true });

      expect(rewritten).toEqual([]);
    });
  }
});

/**
 * The cleanup sweep finishes in under five seconds on a crowded temp
 * directory (CodySwannGT/lisa#4597).
 *
 * A BENCHMARK, not a contract test: it seeds 10,000 real entries in a private
 * root — a mix of stale Lisa folders it must remove, fresh Lisa folders and
 * foreign names it must keep — and times one sweep of that root. The
 * 5,000 ms budget is the ticket's; only machine load widens it, through the
 * filesystem-scaled helper, never the corpus shrinking.
 *
 * Excluded from `test:cov:unit:push`, like
 * `measure-tmpdir-growth-performance.test.ts`: building and deleting a
 * 10,000-entry corpus on every push is a load spike every concurrent lane
 * pays for. Run it with
 * `bun run test:unit -- tests/unit/scripts/lisa-cleanup-sweep-performance`.
 * @module tests/unit/scripts/lisa-cleanup-sweep-performance
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { sweep } from "../../../all/copy-overwrite/scripts/lib/lisa-cleanup-sweep.mjs";
import {
  fsBudgetDerivation,
  fsLatencyBudgetMs,
} from "../../helpers/fs-latency-budget.js";

const ENTRY_COUNT = 10_000;
const STALE_COUNT = 2_000;
const FRESH_LISA_COUNT = 2_000;
const SWEEP_BUDGET_BASE_MS = 5_000;
/** Room for seeding and deleting the corpus itself, not the sweep. */
const CORPUS_BASE_MS = 120_000;
const HOUR_MS = 60 * 60 * 1000;
const NOW = Date.now();
const roots: string[] = [];

/**
 * Seed the corpus: stale Lisa, fresh Lisa, and foreign entries.
 * @param root - Private root
 */
function seed(root: string): void {
  const stale = new Date(NOW - 48 * HOUR_MS);
  for (let index = 0; index < ENTRY_COUNT; index += 1) {
    const isStale = index < STALE_COUNT;
    const isLisa = index < STALE_COUNT + FRESH_LISA_COUNT;
    const name = isLisa ? `lisa-perf-${index}` : `foreign-perf-${index}`;
    const entry = path.join(root, name);
    // 0700, as `mkdtemp` makes it: the sweep skips anything group or other can open.
    fs.mkdirSync(entry, { mode: 0o700 });
    if (isStale) fs.utimesSync(entry, stale, stale);
  }
}

afterAll(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
}, fsLatencyBudgetMs(CORPUS_BASE_MS));

describe("cleanup sweep performance", () => {
  it(
    "sweeps a 10,000-entry temp directory in under 5 seconds",
    async () => {
      const root = fs.mkdtempSync(path.join(tmpdir(), "lisa-sweep-perf-"));
      roots.push(root);
      seed(root);
      const started = performance.now();
      const result = await sweep({ root, now: NOW, orphans: false });
      const elapsedMs = performance.now() - started;
      const budgetMs = fsLatencyBudgetMs(SWEEP_BUDGET_BASE_MS);
      expect(result.errors).toEqual([]);
      expect(result.removed).toHaveLength(STALE_COUNT);
      expect(fs.readdirSync(root)).toHaveLength(ENTRY_COUNT - STALE_COUNT);
      expect(
        elapsedMs,
        `sweep took ${elapsedMs.toFixed(0)} ms against ${budgetMs} ms (${fsBudgetDerivation()})`
      ).toBeLessThan(budgetMs);
    },
    fsLatencyBudgetMs(CORPUS_BASE_MS)
  );
});

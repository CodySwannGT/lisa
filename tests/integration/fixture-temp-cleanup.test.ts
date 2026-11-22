/**
 * Fixture helpers remove the temp folders they create (CodySwannGT/lisa#5095).
 *
 * The suite's contract since CodySwannGT/lisa#4602 is that each test removes
 * what it creates; nothing global audits it. Shared fixtures broke it quietly.
 * Each made a fresh `mkdtemp` folder per call and nothing removed it. On
 * 2026-11-20 one machine held 122,618 entries in `/private/tmp`, 13,701 of them
 * from one helper.
 *
 * One case per fixed helper, and one per traced test file that makes its own
 * folders. Each runs one suite in a real child Vitest, with `TMPDIR` pointed
 * at a private folder, and requires that folder to be EMPTY afterwards. Node's
 * compile cache is switched off in the child so the only writers left are the
 * suite and the code it drives. The helper's own suite proves
 * `useOwnedTempDirs` cleans up; the per-file cases prove each traced file
 * still routes through it, so putting a raw `mkdtemp` back in one of them
 * fails its own case.
 * @module tests/integration/fixture-temp-cleanup
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

/**
 * Each fixed helper or traced file, and one suite that drives its temp-folder
 * path. Each suite was chosen because it leaves folders behind when its
 * cleanup is removed; a suite that never reaches the path would pass either
 * way.
 */
const CASES = [
  ["owned-temp-dirs", "tests/unit/helpers/owned-temp-dirs.test.ts"],
  ["BackupService init", "tests/unit/transaction/backup.test.ts"],
  ["direct-issue-create", "tests/unit/hooks/block-direct-issue-create.test.ts"],
  ["auto-update-fixture", "tests/unit/hooks/auto-update.test.ts"],
  [
    "inject-resolved-config-harness",
    "tests/unit/hooks/inject-resolved-config-completeness.test.ts",
  ],
  [
    "maestro-leg-order-harness",
    "tests/integration/maestro-leg-order-wait.test.ts",
  ],
  ["host-name-guard-fixture", "tests/unit/hooks/block-host-name-leak.test.ts"],
  ["gate-report-fixtures", "tests/unit/cli/doctor-declared-contexts.test.ts"],
  ["blind-automerge", "tests/unit/hooks/block-blind-automerge.test.ts"],
  [
    "filing-parity",
    "tests/unit/opencode/block-direct-issue-create-cross-repo-parity.test.ts",
  ],
  [
    "required-check-promotions-helpers",
    "tests/unit/scripts/required-check-promotions.legs.test.ts",
  ],
  ["work-item-cli", "tests/unit/scripts/work-item-contract-version.test.ts"],
  [
    "executed-script-reach",
    "tests/unit/hooks/block-managed-file-edits-host-stack.test.ts",
  ],
  [
    "enforcement-vintage-harness",
    "tests/unit/hooks/enforcement-vintage.test.ts",
  ],
  // Traced test files that make their own folders through the helper.
  ["state-classification", "tests/unit/scripts/state-classification.test.ts"],
  [
    "vacuous-required-checks-wiring",
    "tests/unit/scripts/vacuous-required-checks-wiring.test.ts",
  ],
  [
    "discharge-work-item-gates",
    "tests/unit/hooks/discharge-work-item-gates.test.ts",
  ],
  [
    "failure-signature-index",
    "tests/unit/hooks/failure-signature-index.test.ts",
  ],
  [
    "failure-signature-discrimination",
    "tests/unit/hooks/failure-signature-discrimination.test.ts",
  ],
] as const;

/**
 * Quiet-box budget for one child run. The slowest case measured 6.5 s
 * (2026-11-20, `ps aux | grep -c '[v]itest'` = 2, 1-minute load 9.4 on 18
 * cores); 24 s leaves the child about four times that.
 */
const CHILD_RUN_BASE_MS = 24_000;

// Each case must outlast its child at the 8x slowdown ceiling with 2.5x to
// spare (24,000 x 8 x 2.5), so the bounded child always dies first and
// reports by name.
useIoLatencyBudget(480_000);

describe("fixture helpers and the temp root", () => {
  it.each(CASES)("%s leaves the temp root empty (%s)", (_helper, suite) => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync(tmpdir()), "lisa-leakcheck-")
    );
    try {
      const result = boundedSpawnSync({
        label: `${suite} under a private TMPDIR`,
        command: process.execPath,
        args: [
          path.join(REPO_ROOT, "dist/cli/lisa-test-run.js"),
          "--profile",
          "lisa",
          "--adapter",
          "vitest",
          "--",
          process.execPath,
          path.join(REPO_ROOT, "node_modules/vitest/vitest.mjs"),
          "run",
          suite,
        ],
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          TMPDIR: root,
          TMP: root,
          TEMP: root,
          LISA_ADMISSION: "off",
          NODE_DISABLE_COMPILE_CACHE: "1",
        },
        baseMs: CHILD_RUN_BASE_MS,
      });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(fs.readdirSync(root)).toEqual([]);
    } finally {
      fs.rmSync(root, { force: true, maxRetries: 10, recursive: true });
    }
  });
});

/**
 * Fixture suites remove the temp folders they create (CodySwannGT/lisa#5095).
 *
 * The suite's contract since CodySwannGT/lisa#4602 is that each test removes
 * what it creates; nothing global audits it. These fixtures broke it quietly.
 * Each made a fresh `mkdtemp` folder per call and nothing removed it. On
 * 2026-11-20 one machine held 122,618 entries in `/private/tmp`, 13,701 of them
 * from one helper. One normal run of the 60 files that use these fixtures left
 * 887 folders behind before the fix and none after it.
 *
 * This runs one suite per fixed fixture in a real child Vitest, with `TMPDIR`
 * pointed at a private folder, and fails if any per-call folder is still there
 * afterwards. "Per-call" is the `mkdtemp` shape: a name ending in six random
 * characters after a dash. Fixed-name caches a run reuses rather than mints,
 * such as Node's `node-compile-cache` and the hooks' per-user
 * `lisa-guard-memo-<uid>`, do not grow per run, and the shape leaves them out
 * without naming them.
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

/** One suite for each fixture or test file that used to leak. */
const SUITES = [
  "tests/unit/hooks/block-direct-issue-create.test.ts",
  "tests/unit/hooks/auto-update.test.ts",
  "tests/unit/hooks/auto-update-attention.test.ts",
  "tests/unit/hooks/auto-update-session.test.ts",
  "tests/unit/hooks/inject-resolved-config-completeness.test.ts",
  "tests/integration/maestro-leg-order-wait.test.ts",
  "tests/integration/maestro-native-flake-classification.test.ts",
  "tests/integration/maestro-pre-suite-exports.test.ts",
  "tests/integration/maestro-pre-suite-seam.test.ts",
  "tests/integration/maestro-run-id.test.ts",
  "tests/unit/hooks/block-host-name-launchers.test.ts",
  "tests/unit/cli/gate-report-executors.test.ts",
  "tests/unit/hooks/block-blind-automerge.test.ts",
  "tests/unit/opencode/block-direct-issue-create-cross-repo-parity.test.ts",
  "tests/unit/scripts/required-check-promotions.legs.test.ts",
  "tests/unit/hooks/discharge-work-item-gates.test.ts",
  "tests/unit/hooks/failure-signature-discrimination.test.ts",
  "tests/unit/hooks/failure-signature-index.test.ts",
  "tests/unit/scripts/lisa-work-item-pending-update.test.ts",
  "tests/unit/scripts/skipped-required-checks-wiring.test.ts",
  "tests/unit/scripts/skipped-required-outcomes.test.ts",
  "tests/unit/scripts/state-classification.test.ts",
  "tests/unit/scripts/vacuous-required-checks-wiring.test.ts",
] as const;

/** A folder `mkdtemp` minted: a prefix ending in a dash, then six characters. */
const PER_CALL_FOLDER = /-[A-Za-z0-9]{6}$/u;

/**
 * Quiet-box budget for the child run. Measured at 6.0-6.5 s for the case
 * (2026-11-20, `ps aux | grep -c '[v]itest'` = 2, 1-minute load 9.4 on 18
 * cores); 24 s leaves the child about four times that.
 */
const CHILD_RUN_BASE_MS = 24_000;

// The case must outlast the child at the 8x slowdown ceiling with 2.5x to
// spare (24,000 x 8 x 2.5), so the bounded child always dies first and
// reports by name.
useIoLatencyBudget(480_000);

describe("fixture suites and the temp root", () => {
  it("leave no per-call temp folder behind after a normal run", () => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync(tmpdir()), "lisa-leakcheck-")
    );
    try {
      const result = boundedSpawnSync({
        label: "fixture suites under a private TMPDIR",
        command: process.execPath,
        args: [
          path.join(REPO_ROOT, "node_modules/vitest/vitest.mjs"),
          "run",
          ...SUITES,
        ],
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          TMPDIR: root,
          TMP: root,
          TEMP: root,
          LISA_ADMISSION: "off",
        },
        baseMs: CHILD_RUN_BASE_MS,
      });
      const diagnostic = `${result.stdout}\n${result.stderr}`;
      expect(result.status, diagnostic).toBe(0);

      const leftovers = fs
        .readdirSync(root)
        .filter(name => PER_CALL_FOLDER.test(name));
      expect(leftovers).toEqual([]);
    } finally {
      fs.rmSync(root, { force: true, maxRetries: 10, recursive: true });
    }
  });
});

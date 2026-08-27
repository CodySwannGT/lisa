/**
 * Every Stryker config this repository ships states its own timeout budgets.
 *
 * ## Why an omitted key is a defect and not a default
 *
 * Stryker supplies 5000ms per mutant and a 5-minute dry run to any config that
 * declares neither. Nobody here chose those numbers, and in the suites Lisa
 * ships them into they behave as performance assertions rather than liveness
 * bounds: a dry run measured at 159s on an idle box has under 2x margin against
 * the 5-minute cap and none at all on a loaded laptop.
 *
 * The failure shape is what makes it worth a test. A blown budget arrives as a
 * nonzero exit from the same gate a weak test suite fails, so it was reported
 * as a mutation score — telling a developer on smaller hardware their tests are
 * weak when in fact nothing was measured. The gate now separates the two (see
 * `tests/unit/scripts/lisa-mutation-gate`), and this file keeps the other half
 * true: the budgets it names in that message are values a human wrote down.
 *
 * Enumerated from the index rather than listed, so a stack template added later
 * is covered the day it lands instead of the day somebody remembers this file.
 * @module tests/unit/templates/stryker-timeout-budgets
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { resolveGit } from "../../support/git-executable.js";

const ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * Pinned git binary — resolving `git` via $PATH trips
 * no-os-command-from-path, and naming `/usr/bin/git` pins Apple's `xcrun`
 * dispatcher, whose maximum under load is ~20s against 11ms for the real
 * binary. {@link resolveGit} finds a real one.
 */
const GIT_BIN = resolveGit();

/** Stryker's own per-mutant budget when a config declares none, in ms. */
const STRYKER_DEFAULT_TIMEOUT_MS = 5000;

/** Stryker's own dry-run budget when a config declares none, in minutes. */
const STRYKER_DEFAULT_DRY_RUN_TIMEOUT_MINUTES = 5;

/** The two options a shipped config must decide for itself. */
const REQUIRED_BUDGETS = [
  { key: "timeoutMS", floor: STRYKER_DEFAULT_TIMEOUT_MS },
  {
    key: "dryRunTimeoutMinutes",
    floor: STRYKER_DEFAULT_DRY_RUN_TIMEOUT_MINUTES,
  },
] as const;

/**
 * Every tracked `stryker.conf.json`, from the index.
 * @returns Repository-relative paths
 */
const trackedConfigs = (): string[] =>
  boundedExecFileSync({
    label: "git ls-files *stryker.conf.json",
    command: GIT_BIN,
    args: ["ls-files", "*stryker.conf.json"],
    cwd: ROOT,
  })
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

describe("shipped Stryker timeout budgets", () => {
  const configs = trackedConfigs();

  it("finds the configs it is meant to be checking", () => {
    // A glob that stopped matching would make every assertion below vacuous —
    // zero files, zero failures, green forever. The two consumer templates are
    // named because those are the ones a project actually receives.
    expect(configs).toContain("typescript/create-only/stryker.conf.json");
    expect(configs).toContain("expo/create-only/stryker.conf.json");
  });

  for (const relative of configs) {
    describe(relative, () => {
      const conf = JSON.parse(
        fs.readFileSync(path.join(ROOT, relative), "utf8")
      ) as Record<string, unknown>;

      for (const { key, floor } of REQUIRED_BUDGETS) {
        it(`declares ${key} rather than inheriting it`, () => {
          expect(typeof conf[key], `${relative} must declare ${key}`).toBe(
            "number"
          );
        });

        it(`sets ${key} above Stryker's default of ${floor}`, () => {
          // Re-declaring Stryker's own number would satisfy the letter of
          // "states its budgets" while shipping the exact budget that fails
          // first. The point is a liveness bound, so it has to be looser.
          expect(conf[key]).toBeGreaterThan(floor);
        });

        it(`says in a comment what ${key} bounds`, () => {
          const comment = conf[`_${key}Comment`];
          expect(typeof comment, `${relative} must explain ${key}`).toBe(
            "string"
          );
          expect(String(comment)).toContain(key);
        });
      }

      it("uses the measured four-worker concurrency calibration", () => {
        expect(conf["concurrency"], `${relative} must pin concurrency`).toBe(4);
      });

      it("records why mutation concurrency is a correctness control", () => {
        const comment = conf["_concurrencyComment"];
        expect(typeof comment, `${relative} must explain concurrency`).toBe(
          "string"
        );
        expect(String(comment)).toContain("serial dry-run");
        expect(String(comment)).toContain("53 timeouts");
        expect(String(comment)).toContain("41");
        expect(String(comment)).toContain("real survivors");
      });
    });
  }
});

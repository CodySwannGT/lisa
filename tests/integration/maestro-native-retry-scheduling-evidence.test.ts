/** Actual workflow retry Bash and gate: scheduling evidence cases. */
import { describe, expect, it } from "vitest";
import { reading, rows } from "./support/maestro-android-retry-fixtures.js";
import {
  evidenceHarness,
  FAILED_MODE,
  NO_DEVICE_MODE,
  NO_REPORT_MODE,
  FAILED_AGAIN_MESSAGE,
  attempts,
  attemptRow,
  flowRow,
  FAILED,
  UNKNOWN,
  NOT_EXECUTED,
  UNKNOWN_COUNTER,
  NOT_EXECUTED_COUNTER,
} from "./support/maestro-retry-evidence-assertions.js";

describe.each(["android", "ios"] as const)(
  "Maestro %s retry execution evidence (actual workflow Bash)",
  platform => {
    const { run } = evidenceHarness(platform);

    it.each([
      { mode: FAILED_MODE, category: FAILED },
      { mode: NO_DEVICE_MODE, category: NOT_EXECUTED },
      { mode: NO_REPORT_MODE, category: UNKNOWN },
    ])(
      "clears unresolved counters but retains $category history after later recovery",
      async ({ mode, category }) => {
        const { driver, gate } = await run({
          mode,
          attempts: "2",
          recoverNextRetry: true,
        });
        expect(driver.status).toBe(0);
        expect(driver.attempts).toBe(3);
        expect(reading(driver.ledger, "recovered")).toBe("1");
        expect(reading(driver.ledger, FAILED)).toBe("0");
        expect(reading(driver.ledger, NOT_EXECUTED_COUNTER)).toBe("0");
        expect(reading(driver.ledger, UNKNOWN_COUNTER)).toBe("0");
        expect(attempts(driver.ledger)).toEqual([
          attemptRow(2, category),
          attemptRow(3, "recovered"),
        ]);
        expect(rows(driver.ledger)).toEqual([flowRow(3, "recovered")]);
        expect(gate.status).toBe(0);
      }
    );

    it.each([
      {
        mode: FAILED_MODE,
        category: FAILED,
        counter: FAILED,
      },
      {
        mode: NO_DEVICE_MODE,
        category: NOT_EXECUTED,
        counter: NOT_EXECUTED_COUNTER,
      },
      {
        mode: NO_REPORT_MODE,
        category: UNKNOWN,
        counter: UNKNOWN_COUNTER,
      },
    ])(
      "retains completed $category evidence when a later retry lacks time",
      async ({ mode, category, counter }) => {
        const { driver, gate } = await run({
          mode,
          attempts: "3",
          deadlineSeconds: 300,
          clockAdvanceSeconds: 200,
        });
        expect(driver.status).toBe(1);
        expect(driver.attempts).toBe(2);
        expect(reading(driver.ledger, "time_declined")).toBe("1");
        expect(reading(driver.ledger, counter)).toBe("1");
        expect(reading(driver.ledger, FAILED)).toBe(
          counter === FAILED ? "1" : "0"
        );
        expect(attempts(driver.ledger)).toContain(attemptRow(2, category));
        expect(rows(driver.ledger)).toEqual([flowRow(2, "time-budget")]);
        expect(gate.status).toBe(1);
        expect(gate.summary).toContain(category);
        if (counter !== FAILED)
          expect(gate.output).not.toContain(FAILED_AGAIN_MESSAGE);
      }
    );

    it.each([
      {
        mode: FAILED_MODE,
        category: FAILED,
        counter: FAILED,
      },
      {
        mode: NO_DEVICE_MODE,
        category: NOT_EXECUTED,
        counter: NOT_EXECUTED_COUNTER,
      },
      {
        mode: NO_REPORT_MODE,
        category: UNKNOWN,
        counter: UNKNOWN_COUNTER,
      },
    ])(
      "retains completed $category evidence when the next retry is interrupted",
      async ({ mode, category, counter }) => {
        const { driver, gate } = await run({
          mode,
          attempts: "2",
          interruptNextRetry: true,
        });
        expect(driver.status).not.toBe(0);
        expect(driver.attempts).toBe(3);
        expect(reading(driver.ledger, "retried")).toBe("1");
        expect(reading(driver.ledger, counter)).toBe("1");
        expect(reading(driver.ledger, FAILED)).toBe(
          counter === FAILED ? "1" : "0"
        );
        expect(attempts(driver.ledger)).toContain(attemptRow(2, category));
        expect(driver.ledger).toContain(
          "active_retry=.maestro/flows/flow-07.yaml"
        );
        expect(driver.summary).toContain("attempt 3");
        expect(gate.status).toBe(1);
        expect(gate.summary).toContain(category);
      }
    );
  }
);

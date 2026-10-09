/** Actual workflow retry Bash and gate: execution evidence cases. */
import { describe, expect, it } from "vitest";
import {
  reading,
  rows,
  type CommandEvidence,
} from "./support/maestro-android-retry-fixtures.js";
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
  EXECUTED_MESSAGE,
  UNKNOWN_MESSAGE,
  NO_EVIDENCE_MESSAGE,
} from "./support/maestro-retry-evidence-assertions.js";

describe.each(["android", "ios"] as const)(
  "Maestro %s retry execution evidence (actual workflow Bash)",
  platform => {
    const { run, expectUnknown } = evidenceHarness(platform);

    it("reports a no-device retry as not executed and retains the original red", async () => {
      const { driver: result, gate } = await run({
        platform,
        mode: NO_DEVICE_MODE,
      });

      expect(result.status).toBe(1);
      expect(result.attempts).toBe(2);
      expect(result.output).toContain("You have 0 devices connected");
      expect.soft(rows(result.ledger)).toEqual([flowRow(2, NOT_EXECUTED)]);
      expect.soft(reading(result.ledger, NOT_EXECUTED_COUNTER)).toBe("1");
      expect.soft(reading(result.ledger, FAILED)).toBe("0");
      expect(gate.status).toBe(1);
      expect.soft(gate.output).toContain(NO_EVIDENCE_MESSAGE);
      expect.soft(gate.output).not.toContain(FAILED_AGAIN_MESSAGE);
      expect
        .soft(gate.output)
        .not.toContain("removes ordering and host contention");
    });

    it("reports missing retry execution evidence as unknown and retains the original red", async () => {
      const { driver: result, gate } = await run({
        platform,
        mode: NO_REPORT_MODE,
      });

      expect(result.status).toBe(1);
      expect(result.attempts).toBe(2);
      expect.soft(rows(result.ledger)).toEqual([flowRow(2, UNKNOWN)]);
      expect.soft(reading(result.ledger, UNKNOWN_COUNTER)).toBe("1");
      expect.soft(reading(result.ledger, FAILED)).toBe("0");
      expect(gate.status).toBe(1);
      expect.soft(gate.output).toContain(UNKNOWN_MESSAGE);
      expect.soft(gate.output).not.toContain(FAILED_AGAIN_MESSAGE);
    });

    it("does not promote a matching failed JUnit testcase alone to executed failure", async () => {
      await expectUnknown({ mode: FAILED_MODE, commandEvidence: "none" });
    });

    it.each(["legacy", "modern"] as const)(
      "retains positively evidenced executed failure from %s Maestro command wrappers",
      async debugLayout => {
        const { driver, gate } = await run({
          mode: FAILED_MODE,
          debugLayout,
        });
        expect(driver.status).toBe(1);
        expect(reading(driver.ledger, FAILED)).toBe("1");
        expect(reading(driver.ledger, UNKNOWN_COUNTER)).toBe("0");
        expect(rows(driver.ledger)).toEqual([flowRow(2, FAILED)]);
        expect(attempts(driver.ledger)).toContain(attemptRow(2, FAILED));
        expect(gate.status).toBe(1);
        expect(gate.output).toContain(EXECUTED_MESSAGE);
        expect(gate.output).not.toContain("most credible real-failure signal");
        expect(gate.output).not.toContain(
          "removes ordering and host contention"
        );
      }
    );

    it.each<CommandEvidence>([
      "pending",
      "skipped",
      "configuration",
      "variables",
      "empty",
      "no-command",
      "unknown-command",
      "malformed",
      "missing-timestamp",
      "invalid-timestamp",
      "zero-timestamp",
    ])(
      "does not accept %s commands as real executed-step evidence",
      async evidence => {
        await expectUnknown({ mode: FAILED_MODE, commandEvidence: evidence });
      }
    );

    it.each(["legacy", "modern"] as const)(
      "does not borrow another target's %s command evidence",
      async debugLayout => {
        await expectUnknown({
          mode: FAILED_MODE,
          debugLayout,
          wrongTarget: true,
        });
      }
    );

    it("does not borrow a previous suite's positive command evidence", async () => {
      const { driver } = await expectUnknown({
        mode: FAILED_MODE,
        staleSuiteEvidence: true,
      });
      expect(driver.debugRoots[1]).not.toBe(driver.debugRoots[0]);
    });

    it("does not borrow the previous retry's steps for a later JUnit-only failure", async () => {
      const { driver, gate } = await run({
        mode: FAILED_MODE,
        attempts: "2",
        evidenceOnlyFirstRetry: true,
      });
      expect(driver.status).toBe(1);
      expect(driver.attempts).toBe(3);
      expect(new Set(driver.debugRoots).size).toBe(3);
      expect(reading(driver.ledger, FAILED)).toBe("1");
      expect(reading(driver.ledger, UNKNOWN_COUNTER)).toBe("1");
      expect(attempts(driver.ledger)).toEqual([
        attemptRow(2, FAILED),
        attemptRow(3, UNKNOWN),
      ]);
      expect(rows(driver.ledger)).toEqual([flowRow(3, UNKNOWN)]);
      expect(gate.status).toBe(1);
      expect(gate.output).toContain(UNKNOWN_MESSAGE);
    });

    it("reports contradictory no-device and real-step evidence as unknown", async () => {
      const { driver } = await expectUnknown({
        mode: "retry-no-device-conflict",
      });
      expect(reading(driver.ledger, NOT_EXECUTED_COUNTER)).toBe("0");
    });

    it("reports a missing retry launcher as not executed without an extra stub invocation", async () => {
      const { driver, gate } = await run({ mode: "retry-launcher-missing" });
      expect(driver.status).toBe(1);
      expect(driver.attempts).toBe(1);
      expect(reading(driver.ledger, "retried")).toBe("1");
      expect(reading(driver.ledger, NOT_EXECUTED_COUNTER)).toBe("1");
      expect(reading(driver.ledger, FAILED)).toBe("0");
      expect(attempts(driver.ledger)).toContain(attemptRow(2, NOT_EXECUTED));
      expect(driver.output).toContain("LISA_MAESTRO_RETRY_STARTUP_UNAVAILABLE");
      expect(gate.status).toBe(1);
      expect(gate.output).toContain(NO_EVIDENCE_MESSAGE);
      expect(gate.output).not.toContain(EXECUTED_MESSAGE);
    });

    it("retains the passing nonempty retry control", async () => {
      const { driver, gate } = await run({ mode: "retry-passes" });
      expect(driver.status).toBe(0);
      expect(reading(driver.ledger, "recovered")).toBe("1");
      expect(reading(driver.ledger, FAILED)).toBe("0");
      expect(gate.status).toBe(0);
    });

    it("retains the vacuous retry control with a red final gate", async () => {
      const { driver, gate } = await run({ mode: "retry-executes-nothing" });
      expect(driver.status).toBe(1);
      expect(rows(driver.ledger)).toEqual([flowRow(2, "vacuous")]);
      expect(reading(driver.ledger, FAILED)).toBe("0");
      expect(gate.status).toBe(1);
      expect(gate.output).not.toContain(FAILED_AGAIN_MESSAGE);
    });
  }
);

/** Actual workflow retry Bash and gate: names evidence cases. */
import { describe, expect, it } from "vitest";
import { reading, rows } from "./support/maestro-android-retry-fixtures.js";
import {
  evidenceHarness,
  FAILED_MODE,
  flowRow,
  FAILED,
  UNKNOWN,
  UNKNOWN_COUNTER,
  EXECUTED_MESSAGE,
  UNKNOWN_MESSAGE,
  CUSTOM_NAME,
  SELECTED_NAME,
  FOREIGN_NAME,
} from "./support/maestro-retry-evidence-assertions.js";

describe.each(["android", "ios"] as const)(
  "Maestro %s retry execution evidence (actual workflow Bash)",
  platform => {
    const { run, expectUnknown } = evidenceHarness(platform);

    it("recognizes selected-flow name-only JUnit with fresh executed-step evidence", async () => {
      const { driver, gate } = await run({
        mode: FAILED_MODE,
        nameOnlyReport: true,
      });
      expect(driver.status).toBe(1);
      expect(reading(driver.ledger, FAILED)).toBe("1");
      expect(reading(driver.ledger, UNKNOWN_COUNTER)).toBe("0");
      expect(gate.status).toBe(1);
      expect(gate.output).toContain(EXECUTED_MESSAGE);
    });

    it.each(["legacy", "modern"] as const)(
      "recognizes quoted configured flow names in %s evidence and name-only reports",
      async debugLayout => {
        const { driver, gate } = await run({
          mode: FAILED_MODE,
          nameOnlyReport: true,
          flowName: CUSTOM_NAME,
          debugLayout,
        });
        expect(driver.status).toBe(1);
        expect(reading(driver.ledger, FAILED)).toBe("1");
        expect(reading(driver.ledger, UNKNOWN_COUNTER)).toBe("0");
        expect(gate.status).toBe(1);
        expect(gate.output).toContain(EXECUTED_MESSAGE);
      }
    );

    it("recognizes the selected configured flow in a modern shard folder", async () => {
      const { driver } = await run({
        mode: FAILED_MODE,
        nameOnlyReport: true,
        flowName: CUSTOM_NAME,
        shardDirectory: true,
      });
      expect(reading(driver.ledger, FAILED)).toBe("1");
      expect(reading(driver.ledger, UNKNOWN_COUNTER)).toBe("0");
    });

    it("does not attribute a shared configured name to the selected flow", async () => {
      await expectUnknown({
        mode: FAILED_MODE,
        nameOnlyReport: true,
        flowName: CUSTOM_NAME,
        flowNameCollision: true,
      });
    });

    it("cannot recover a selected failure from a successful foreign-flow report", async () => {
      await expectUnknown({ mode: "retry-foreign-success" });
    });

    it("does not replace the selected top-level flow name with nested env.name", async () => {
      const { driver, gate } = await run({
        mode: FAILED_MODE,
        flowName: SELECTED_NAME,
        nestedEnvName: FOREIGN_NAME,
      });
      expect(driver.status).toBe(1);
      expect.soft(reading(driver.ledger, FAILED)).toBe("1");
      expect.soft(reading(driver.ledger, UNKNOWN_COUNTER)).toBe("0");
      expect.soft(rows(driver.ledger)).toEqual([flowRow(2, FAILED)]);
      expect(gate.status).toBe(1);
      expect.soft(gate.output).toContain(EXECUTED_MESSAGE);
    });

    it("cannot recover from a foreign name-only success matching nested env.name", async () => {
      const { driver, gate } = await run({
        mode: "retry-foreign-name-success",
        flowName: SELECTED_NAME,
        nestedEnvName: FOREIGN_NAME,
      });
      expect.soft(driver.status).toBe(1);
      expect.soft(reading(driver.ledger, "recovered")).toBe("0");
      expect.soft(reading(driver.ledger, UNKNOWN_COUNTER)).toBe("1");
      expect.soft(rows(driver.ledger)).toEqual([flowRow(2, UNKNOWN)]);
      expect.soft(gate.status).toBe(1);
      expect.soft(gate.output).toContain(UNKNOWN_MESSAGE);
    });

    it("prefers the original selected-file observed name over an unresolved raw header", async () => {
      // Observed producer output is authoritative here. This fixture makes no
      // claim about which Maestro versions interpolate source header names.
      const { driver, gate } = await run({
        mode: FAILED_MODE,
        flowName: "Resolved flow",
        rawHeaderName: "${NAME}",
      });
      expect(driver.status).toBe(1);
      expect.soft(reading(driver.ledger, FAILED)).toBe("1");
      expect.soft(reading(driver.ledger, UNKNOWN_COUNTER)).toBe("0");
      expect.soft(rows(driver.ledger)).toEqual([flowRow(2, FAILED)]);
      expect(gate.status).toBe(1);
      expect.soft(gate.output).toContain(EXECUTED_MESSAGE);
    });
  }
);

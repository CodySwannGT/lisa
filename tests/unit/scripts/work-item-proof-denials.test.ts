/** Each unusable proof reaches both real production entry points. */
import { readFileSync } from "node:fs";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import {
  cleanupFixtures,
  cleanupTemplates,
} from "../../support/work-item-cli.js";
import {
  proofFixture,
  attachRecord,
  proofCli,
  PROOF_REF,
} from "../../support/work-item-proof-fixture.js";
import { DENIALS } from "../../support/work-item-proof-denials.js";

useIoLatencyBudget();
afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

describe.each(["direct", "applying sweep"])(
  "unusable completion proof: %s",
  route => {
    it.each(DENIALS)("rejects $name before any terminal mutation", scenario => {
      const fixture = proofFixture();
      scenario.change(fixture);
      attachRecord(fixture);
      scenario.afterAttach?.(fixture);
      const args =
        route === "direct"
          ? ["complete", "--ref", PROOF_REF]
          : ["sweep", "--apply", "--since", fixture.before, "--branch", "main"];
      const result = proofCli(fixture, args);
      const writes = readFileSync(fixture.env.FAKE_GH_WRITES_FILE!, "utf8");
      const unhandled = readFileSync(
        fixture.env.FAKE_GH_UNHANDLED_FILE!,
        "utf8"
      );
      console.log(
        JSON.stringify({
          name: `${route}: ${scenario.name}`,
          command: ["node", "scripts/lisa-work-item.mjs", ...args],
          exit_code: result.status,
          stdout: result.stdout,
          stderr: result.stderr,
          expectedCategory: scenario.category,
          providerWrites: writes,
          unhandledProviderCalls: unhandled,
          controlledProvider: true,
          realTrackerWriteExecuted: false,
        })
      );
      expect(unhandled).toBe("");
      expect(writes).toBe("");
      expect(result.stderr).toBe("");
      expect(result.status).toBe(
        route === "direct" && scenario.category !== "pending-proof" ? 1 : 0
      );
      expect(result.stdout).toContain(`[${scenario.category}]`);
      expect(result.stdout).not.toContain("work-item completed:");
      expect(result.stdout).toMatch(
        /proof|evidence|verification|conformance|claim|usage|source|requirement/i
      );
      expect(
        JSON.parse(readFileSync(fixture.env.FAKE_GH_STATE_FILE!, "utf8")).state
      ).toBe("OPEN");
    });
  }
);

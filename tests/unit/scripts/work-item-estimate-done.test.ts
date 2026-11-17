/**
 * The token-estimate done gate inside completion (CodySwannGT/lisa#4956): with
 * `workItem.estimate.required` at its default, `lisa-work-item complete`
 * refuses an item whose estimate does not show the actual from its usage
 * ledger, accepts it once tallied, and ignores the gate when the project turns
 * it off. Driven through the real CLI against the controlled provider.
 * @module tests/unit/scripts/work-item-estimate-done
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import {
  cleanupFixtures,
  cleanupTemplates,
} from "../../support/work-item-cli.js";
import {
  attachRecord,
  proofCli,
  proofFixture,
  proofUsage,
  PROOF_REF,
  SPEC,
} from "../../support/work-item-proof-fixture.js";
import { editProofState } from "../../support/work-item-proof-history.js";

vi.mock("node:child_process", async original =>
  (await import("../../support/work-item-inprocess-gh.js")).routeFakeGh(
    await original()
  )
);

useIoLatencyBudget();
afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

const complete = (fixture: ReturnType<typeof proofFixture>): string =>
  proofCli(fixture, ["complete", "--ref", PROOF_REF]).stdout;

/**
 * A fixture whose item carries the usage ledger but no tallied estimate.
 * @returns Fixture with the accepted proof attached.
 */
function untallied(): ReturnType<typeof proofFixture> {
  const fixture = proofFixture();
  attachRecord(fixture);
  editProofState(fixture, state => {
    state.body = SPEC + proofUsage(PROOF_REF);
  });
  return fixture;
}

describe("token-estimate done gate in completion", () => {
  it("completes an item whose estimate shows its tallied actual", () => {
    const fixture = proofFixture();
    attachRecord(fixture);
    expect(complete(fixture)).toContain("work-item completed:");
  });

  it("refuses, as pending, an item whose actual is not tallied", () => {
    const output = complete(untallied());
    expect(output).toContain("work-item pending-proof: acme/code#42");
    expect(output).toMatch(/does not yet show the actual tokens and cost/);
  });

  it("does not gate completion when the project turns the requirement off", () => {
    const fixture = untallied();
    const configFile = path.join(fixture.root, ".lisa.config.json");
    const config = JSON.parse(readFileSync(configFile, "utf8"));
    writeFileSync(
      configFile,
      JSON.stringify({
        ...config,
        workItem: { ...config.workItem, estimate: { required: false } },
      })
    );
    expect(complete(fixture)).toContain("work-item completed:");
  });
});

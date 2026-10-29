/** Provider changes during slow source reads must precede the final decision. */
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
  setApi,
  SPEC,
} from "../../support/work-item-proof-fixture.js";

useIoLatencyBudget();
afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

describe("immediate authoritative completion reread", () => {
  it.each([
    "Verify usage",
    "primary backlink",
    "locator",
    "owner and labels",
    "abandoned state",
  ])("observes late %s changes after slow source comparison", change => {
    const fixture = proofFixture();
    attachRecord(fixture);
    const state = JSON.parse(
      readFileSync(fixture.env.FAKE_GH_STATE_FILE!, "utf8")
    );
    const patch =
      change === "Verify usage"
        ? { body: SPEC }
        : change === "primary backlink"
          ? {
              comments: state.comments.filter(
                (row: { id: number }) => row.id !== 1
              ),
            }
          : change === "locator"
            ? {
                comments: state.comments.filter(
                  (row: { id: number }) => row.id !== 2
                ),
              }
            : change === "abandoned state"
              ? { state: "CLOSED", stateReason: "NOT_PLANNED" }
              : {
                  assignees: [{ login: "new-owner" }],
                  labels: [
                    { name: "status:blocked" },
                    { name: "component:new" },
                  ],
                };
    setApi(fixture, ["api", "repos/acme/code/branches/main"], {
      sequence: [
        { json: { commit: { sha: fixture.merge } } },
        { json: { commit: { sha: fixture.merge } }, concurrentState: patch },
      ],
    });
    const result = proofCli(fixture, ["complete", "--ref", PROOF_REF]);
    console.log(
      JSON.stringify({
        name: `late ${change}`,
        command: [
          "node",
          "scripts/lisa-work-item.mjs",
          "complete",
          "--ref",
          PROOF_REF,
        ],
        exit_code: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        controlledConcurrentNativeChange: true,
      })
    );
    expect(readFileSync(fixture.env.FAKE_GH_UNHANDLED_FILE!, "utf8")).toBe("");
    const writes = readFileSync(fixture.env.FAKE_GH_WRITES_FILE!, "utf8");
    if (change === "owner and labels") {
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("work-item completed:");
      expect(writes).toContain("status:blocked");
      expect(writes).not.toContain("status:in-progress");
      const after = JSON.parse(
        readFileSync(fixture.env.FAKE_GH_STATE_FILE!, "utf8")
      );
      expect(after.assignees).toEqual([{ login: "new-owner" }]);
      expect(after.labels).toContainEqual({ name: "component:new" });
    } else {
      expect(writes).toBe("");
      expect(result.stdout).not.toContain("work-item completed:");
    }
  });
});

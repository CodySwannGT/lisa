/**
 * The applying sweep completes an item on either side of gh's escape-sequence
 * check, and a genuine read failure names itself in the run summary
 * (CodySwannGT/lisa#4773). Runs the actual canonical CLI against the
 * controlled provider; tracker data is local.
 * @module tests/unit/scripts/work-item-proof-gh-versions
 */
import { readFileSync } from "node:fs";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import {
  cleanupFixtures,
  cleanupTemplates,
} from "../../support/work-item-cli.js";
import {
  proofFixture,
  attachRecord,
  proofCli,
  proofCliSpawned,
  setApi,
} from "../../support/work-item-proof-fixture.js";

// The controlled provider answers in-process (work-item-inprocess-gh.ts), so a
// case no longer starts a Node process per provider call. The cases on
// proofCliSpawned keep the guard and provider as real processes, which is this
// suite's real-boundary proof (CodySwannGT/lisa#4616, audit unit row 57).
vi.mock("node:child_process", async original =>
  (await import("../../support/work-item-inprocess-gh.js")).routeFakeGh(
    await original()
  )
);

const FAKE_TOKEN = `ghs_${"Z9y8X7w6".repeat(4)}`;

useIoLatencyBudget();
afterEach(cleanupFixtures);
afterAll(cleanupTemplates);

/**
 * Run the applying sweep the terminal-transition workflow runs.
 * @param fixture - Owned disposable repository and controlled provider.
 * @param run - In-process by default; the real-boundary case spawns.
 * @returns The actual CLI result.
 */
function sweep(
  fixture: ReturnType<typeof proofFixture>,
  run: typeof proofCli | typeof proofCliSpawned = proofCli
) {
  return run(fixture, [
    "sweep",
    "--apply",
    "--since",
    fixture.before,
    "--branch",
    "main",
  ]);
}

describe("terminal sweep across gh escape-sequence behaviours", () => {
  it.each([
    ["gh >= 2.97, which refuses raw bodies without the flag", "refuse-escapes"],
    ["gh < 2.97, which rejects the flag", "unknown-flag"],
  ])("completes an item with accepted proof on %s", (_label, mode) => {
    const fixture = proofFixture();
    fixture.env.FAKE_GH_ESCAPE_MODE = mode;
    attachRecord(fixture);
    const result = sweep(
      fixture,
      mode === "refuse-escapes" ? proofCliSpawned : proofCli
    );
    expect(result.stdout).not.toContain("[read-error]");
    expect(result.stdout).toContain("work-item completed:");
    expect(result.status).toBe(0);
    expect(readFileSync(fixture.env.FAKE_GH_UNHANDLED_FILE!, "utf8")).toBe("");
    expect(
      JSON.parse(readFileSync(fixture.env.FAKE_GH_STATE_FILE!, "utf8")).state
    ).toBe("CLOSED");
  });

  it("names the failed read, its path and status in the sweep summary without leaking a token", () => {
    const fixture = proofFixture();
    attachRecord(fixture);
    setApi(fixture, ["api", "repos/acme/code/branches/main"], {
      failure: `gh: Resource not accessible by integration (HTTP 403) ${FAKE_TOKEN}\n`,
    });
    const result = sweep(fixture);
    expect(result.stdout).toContain(
      "work-item NOT completed: acme/code#42 [read-error]"
    );
    expect(result.stdout).toContain("branch");
    expect(result.stdout).toContain("branches/main");
    expect(result.stdout).toContain("HTTP 403");
    expect(result.stdout).toContain("exit 1");
    expect(result.stdout).not.toContain(FAKE_TOKEN);
    expect(result.stdout).toContain(
      "Run canonical Verify/evidence, publish the accepted completion proof, then retry completion."
    );
    expect(readFileSync(fixture.env.FAKE_GH_WRITES_FILE!, "utf8")).toBe("");
  });
});

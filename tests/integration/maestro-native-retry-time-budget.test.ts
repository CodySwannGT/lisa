import { describe, expect, it } from "vitest";

import {
  loadWorkflow,
  runSuiteDriver,
} from "./support/maestro-android-retry-harness.js";
import {
  buildReport,
  reading,
  rows,
} from "./support/maestro-android-retry-fixtures.js";

describe.each(["android", "ios"] as const)("%s retry time budget", platform => {
  it("declines a retry that cannot finish and retains the original failure", async () => {
    const result = await runSuiteDriver(await loadWorkflow(), {
      platform,
      deadlineSeconds: 10,
    });
    expect(result.status).not.toBe(0);
    expect(result.attempts).toBe(1);
    expect(reading(result.ledger, "retried")).toBe("0");
    expect(reading(result.ledger, "time_declined")).toBe("1");
    expect(rows(result.ledger)).toContain(
      "flow|.maestro/flows/flow-07.yaml|1|time-budget"
    );
    expect(result.summary).toContain("FAIL .maestro/flows/flow-07.yaml");
  });

  it.each([
    { path: ".maestro/flows/flow-07.yaml", sibling: true, expected: 2 },
    { path: "./.maestro/flows/flow-07.yaml", sibling: true, expected: 2 },
    { path: "flow-07.yaml", sibling: false, expected: 2 },
    { path: "flow-07.yaml", sibling: true, expected: 1 },
  ])(
    "matches duration to the intended flow: %j",
    async ({ path, sibling, expected }) => {
      const report = buildReport(["flow-07"])
        .replace('file=".maestro/flows/flow-07.yaml"', `file="${path}"`)
        .replace(
          "</testsuite>",
          `${sibling ? '<testcase file="profile/flow-07.yaml" time="1000"/>' : ""}</testsuite>`
        );
      const result = await runSuiteDriver(await loadWorkflow(), {
        platform,
        report,
        deadlineSeconds: 400,
      });
      expect(result.attempts).toBe(expected);
      expect(result.status === 0).toBe(expected === 2);
    }
  );

  it("still retries and recovers when enough job time remains", async () => {
    const result = await runSuiteDriver(await loadWorkflow(), {
      platform,
      deadlineSeconds: 3600,
    });
    expect(result.status).toBe(0);
    expect(result.attempts).toBe(2);
    expect(reading(result.ledger, "recovered")).toBe("1");
  });

  it("does not guess when job timing is unavailable", async () => {
    const result = await runSuiteDriver(await loadWorkflow(), {
      platform,
      deadlineSeconds: null,
    });
    expect(result.status).not.toBe(0);
    expect(result.attempts).toBe(1);
    expect(result.output).toContain("retry time budget");
  });

  it("retains failures when the flow report has no measured duration", async () => {
    const result = await runSuiteDriver(await loadWorkflow(), {
      platform,
      missingDuration: true,
    });
    expect(result.status).not.toBe(0);
    expect(result.attempts).toBe(1);
    expect(reading(result.ledger, "time_declined")).toBe("1");
  });

  it("checks the remaining job time again before a further retry", async () => {
    const result = await runSuiteDriver(await loadWorkflow(), {
      platform,
      deadlineSeconds: 300,
      clockAdvanceSeconds: 200,
      mode: "retry-fails",
      attempts: "3",
    });
    expect(result.status).not.toBe(0);
    expect(result.attempts).toBe(2);
    expect(reading(result.ledger, "time_declined")).toBe("1");
    expect(reading(result.ledger, "retried")).toBe("1");
    expect(reading(result.ledger, "unrecovered")).toBe("1");
  });

  it("publishes known outcomes and the active retry before the driver is killed", async () => {
    const result = await runSuiteDriver(await loadWorkflow(), {
      platform,
      mode: "retry-kills-driver",
    });
    expect(result.status).not.toBe(0);
    expect(result.attempts).toBe(2);
    expect(result.summary).toContain("PASS .maestro/flows/flow-00.yaml");
    expect(result.summary).toContain("FAIL .maestro/flows/flow-07.yaml");
    expect(result.summary).toContain(
      "Retry in progress: .maestro/flows/flow-07.yaml"
    );
    expect(result.ledger).toContain("active_retry=.maestro/flows/flow-07.yaml");
  });
});

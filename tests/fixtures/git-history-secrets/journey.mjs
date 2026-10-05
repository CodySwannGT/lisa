/**
 * @file journey.mjs
 * @description Actual synthetic history journey boundary witnesses.
 * @module history-secrets-fixtures
 */
import { existsSync, rmSync } from "node:fs";
import { createHarness } from "./harness.mjs";
import { emitArtifacts } from "./package.mjs";
import { graphCases } from "./graphs.mjs";
import { errorCases } from "./errors.mjs";
import { nativePushCases } from "./native-push.mjs";
import { reportModeCase } from "./report-mode.mjs";
const harness = createHarness(process.argv.slice(2));
const { outputs, values, requireFact, observations, scratch } = harness;
try {
  emitArtifacts(harness);
  const fixture = graphCases(harness);
  reportModeCase(harness, fixture);
  errorCases(harness, fixture);
  nativePushCases(harness);
  for (const output of outputs)
    for (const value of values)
      requireFact(
        !output.includes(value),
        "Captured outward output contains a matched synthetic value; proof withheld."
      );
  console.log(
    JSON.stringify(
      {
        scanner: "Gitleaks 8.30.1",
        observations,
        redaction: true,
        cleanup: "all owned fixture repositories/processes removed on exit",
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Journey failed; raw proof withheld."
  );
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
  requireFact(!existsSync(scratch), "Positive scratch cleanup failed.");
}

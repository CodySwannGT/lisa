/**
 * @file evidence-scans.mjs
 * @description Run the journey's selected evidence scans two at a time.
 * @module history-secrets-fixtures
 */
import { runTwoWorkers } from "./errors.mjs";
import { nativeScannerReport } from "./package.mjs";

/**
 * Exercise the same emitted CLI, Git input, detectors and verdict assertions.
 * @param harness - Existing owned fixture authority and native command recorder.
 * @param requests - Original selected scan roster with actual Git coordinates.
 * @returns Original ordered redacted observations.
 */
export async function runEvidenceScans(harness, requests) {
  return runTwoWorkers(
    requests.map(request => async () => {
      const { name, argv, cwd, input } = request;
      const run = harness.commandAsync;
      const result = await run(process.execPath, argv, cwd, input);
      if (result.status !== request.expected)
        throw new Error(`${name}: verdict mismatch; raw proof withheld.`);
      const report = nativeScannerReport(result.stdout);
      harness.requireFact(
        report.version === "8.30.1" &&
          report.commits === request.commits &&
          Array.isArray(report.findings) &&
          (request.expected === 0
            ? report.findings.length === 0
            : report.findings.length > 0),
        `${name}: actual default scanner attribution missing.`
      );
      if (request.name === "digest-other-default-rule")
        harness.requireFact(
          report.findings.some(finding => finding.rule === "aws-access-token"),
          "Other default detector attribution missing."
        );
      const { commits, preimageVerified } = request;
      return { name, exit: result.status, commits, preimageVerified };
    })
  );
}

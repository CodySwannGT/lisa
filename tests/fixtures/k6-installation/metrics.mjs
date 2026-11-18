/**
 * Judge actual k6 legacy summary-export counters, accepting modern values envelopes too.
 * @param summary Actual exported metrics.
 * @param serverLog Independent fixture-owned server request log.
 * @param exitCode Actual k6 process exit.
 * @param expected Frozen independent count requirements.
 * @returns Exact observed counters, or throws on any missing or extra execution.
 */
export function judgeMetrics(summary, serverLog, exitCode, expected) {
  const metric = name =>
    summary.metrics?.[name]?.values ?? summary.metrics?.[name];
  const actual = {
    httpRequests: metric("http_reqs")?.count,
    iterations: metric("iterations")?.count,
    checksPass: metric("checks")?.passes,
    checksFail: metric("checks")?.fails,
    loopbackExit: exitCode,
    serverRequests: (
      serverLog.match(/"GET \/health HTTP\/1\.[01]" 200/gu) ?? []
    ).length,
  };
  const failures = Object.entries(actual).filter(
    ([key, value]) => value !== expected[key]
  );
  if (failures.length)
    throw new Error(`Counted loopback mismatch: ${JSON.stringify(actual)}`);
  return actual;
}

export declare const TEST_TIMINGS_DIRECTORY: "tmp/test-timings";
export declare const TEST_TIMINGS_SCOPES: readonly ["unit", "integration"];
export declare function testTimingsScope(
  env: Readonly<Record<string, string | undefined>>
): "unit" | "integration" | undefined;
export declare function declaredTestScope(
  env: Readonly<Record<string, string | undefined>>
): "unit" | "integration" | undefined;
export declare function testTimingsReporter(
  env: Readonly<Record<string, string | undefined>>,
  root: string
): ["json", { outputFile: string }] | undefined;
export declare function withTestTimingsReporter<T>(
  reporters: readonly T[],
  env: Readonly<Record<string, string | undefined>>,
  root: string
): readonly (T | ["json", { outputFile: string }])[];

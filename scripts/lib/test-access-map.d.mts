type Env = Readonly<Record<string, string | undefined>>;
type AccessMap = Readonly<Record<string, readonly string[]>>;
export interface TestAccessMapReporter {
  readonly lisaTestAccessMap: true;
  readonly onTestRunEnd: (
    testModules: readonly {
      readonly moduleId: string;
      readonly state: () => string;
    }[]
  ) => void;
}
export declare const TEST_ACCESS_MAP_DIRECTORY: "tmp/test-access-map";
export declare const TEST_ACCESS_MAP_TRACER_VERSION: number;
export declare const TEST_ACCESS_MAP_SETUP_FILE: string;
export declare const ACCESS_MAP_ENV: Readonly<{
  enabled: "LISA_ACCESS_MAP";
  directory: "LISA_ACCESS_MAP_DIR";
  root: "LISA_ACCESS_MAP_ROOT";
  testFile: "LISA_ACCESS_MAP_TEST_FILE";
  owner: "LISA_ACCESS_MAP_OWNER_PID";
}>;
export declare function testAccessMapEnabled(env: Env): boolean;
export declare function testAccessMapScope(
  env: Env
): "unit" | "integration" | undefined;
export declare function repositoryFile(
  root: string,
  file: string
): string | undefined;
export declare function mergeAccessRecords(input: {
  readonly root: string;
  readonly lines: readonly string[];
  readonly testFiles: readonly string[];
}): AccessMap;
export declare function accessMapMetadata(
  env: Env,
  scope: string,
  now: Date,
  triggers?: readonly string[]
): Readonly<Record<string, unknown>>;
export declare function configuredTriggers(
  root: string,
  config: {
    readonly forceRerunTriggers?: unknown;
    readonly setupFiles?: unknown;
    readonly globalSetup?: unknown;
  }
): readonly string[];
export declare function accessMapWanted(root: string): boolean;
export declare function armTestAccessMap(
  env: Record<string, string | undefined>,
  root: string
): string | undefined;
export declare function testAccessMapReporter(input: {
  readonly root: string;
  readonly directory: string;
  readonly env: Env;
  readonly triggers?: readonly string[];
}): TestAccessMapReporter;
export declare function withTestAccessMapReporter<T>(
  reporters: readonly T[],
  reporter: TestAccessMapReporter
): readonly (T | TestAccessMapReporter)[];
export declare function testAccessMapSetupFiles(env: Env): readonly string[];
export declare function testAccessMapPlugin(
  env?: Record<string, string | undefined>
): {
  readonly name: string;
  readonly configureVitest: (context: {
    readonly vitest: { config: { root: string; reporters: unknown[] } };
  }) => void;
};

/** Process-local platform-temp control for synchronous filesystem unit tests. */

/** Environment keys Node consults when resolving the platform temp root. */
const TEMP_KEYS = ["TMPDIR", "TMP", "TEMP"] as const;

/** Guard against overlapping environment mutations inside one test worker. */
const guard = { active: false };

/**
 * Run one synchronous test after selecting its logical platform temp root.
 * Production still calls `os.tmpdir()` and performs every uid/mode/inode and
 * no-follow check; this helper supplies only the process-start-style temp env.
 * @param root - Existing platform-temp fixture root
 * @param operation - Synchronous test operation
 * @returns Test result
 */
export function withProcessPlatformTempRoot<T>(
  root: string,
  operation: () => T
): T {
  if (guard.active)
    throw new Error("Platform-temp test controls must not overlap");
  // eslint-disable-next-line functional/immutable-data -- restored in this synchronous operation's finally block
  guard.active = true;
  // eslint-disable-next-line no-restricted-syntax -- unit-only platform process input, restored below
  const testEnvironment = process.env;
  const previous = TEMP_KEYS.map(key => [key, testEnvironment[key]] as const);
  for (const key of TEMP_KEYS) {
    // eslint-disable-next-line functional/immutable-data -- restored in the finally block below
    testEnvironment[key] = root;
  }
  try {
    const result = operation();
    if (result instanceof Promise) {
      throw new Error("Platform-temp test controls must remain synchronous");
    }
    return result;
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        // eslint-disable-next-line functional/immutable-data -- restores the absent process input
        delete testEnvironment[key];
      } else {
        // eslint-disable-next-line functional/immutable-data -- restores the captured process input
        testEnvironment[key] = value;
      }
    }
    // eslint-disable-next-line functional/immutable-data -- paired with the guarded acquisition above
    guard.active = false;
  }
}

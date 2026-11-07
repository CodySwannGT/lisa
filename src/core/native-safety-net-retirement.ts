/** Invoke the same target-only retirement used by package installation. */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const retirementScript = fileURLToPath(
  new URL("../../scripts/retire-native-safety-net.mjs", import.meta.url)
);

/** One reported handler decision, without interpreting custom operator files. */
export interface SafetyNetRetirementDecision {
  readonly path: string;
  readonly status: string;
}

/**
 * Retire hash-proven handlers without entering template application.
 * @param projectDir - Target project root
 * @param dryRun - Report without any writes
 * @returns Decisions from the common executable reconciler
 */
export async function retireNativeSafetyNet(
  projectDir: string,
  dryRun: boolean
): Promise<readonly SafetyNetRetirementDecision[]> {
  const { stdout } = await run(
    process.execPath,
    [
      retirementScript,
      path.resolve(projectDir),
      "--json",
      ...(dryRun ? ["--dry-run"] : []),
    ],
    { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }
  );
  return JSON.parse(stdout) as SafetyNetRetirementDecision[];
}

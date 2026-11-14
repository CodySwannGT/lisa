/** Paths for tests that launch the `lisa-test-run` CLI from source. */
import * as path from "node:path";

export const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
export const TEST_RUN_ENTRY = path.join(REPO_ROOT, "src/cli/lisa-test-run.ts");

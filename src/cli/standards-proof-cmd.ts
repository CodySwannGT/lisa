/** CLI adapter for explicit standards-conformance proof capture. */
import path from "node:path";
import { captureStandardsProof } from "../standards/capture.js";

/**
 * Run every applicable standards command and publish a current proof.
 * @param projectPath - Optional project path
 * @param cwd - Injectable process working directory
 */
export async function runStandardsProofCli(
  projectPath: string | undefined,
  cwd: string = process.cwd()
): Promise<void> {
  const root = path.resolve(cwd, projectPath ?? ".");
  const proof = await captureStandardsProof(root);
  process.stdout.write(
    `standards-proof: PASS ${proof.repository.identity}@${proof.repository.head} (${proof.results.length} checks)\n`
  );
}

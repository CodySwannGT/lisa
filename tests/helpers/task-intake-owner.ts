/** One literal supported owner command, containing no credential/body or arbitrary argv. */
import path from "node:path";
import { taskFixture } from "./task-readiness-fixture.js";
/** Build the exact protocol request for an existing fixed read operation.
 * @param f - Isolated installed owner.
 * @param operation - Fixed read name.
 * @param value - Existing issue/PR number or thread ID.
 * @returns Native Bash command for the owner.
 */
export function intakeOwnerCommand(
  f: ReturnType<typeof taskFixture>,
  operation: string,
  value = "1"
) {
  return `node '${path.join(f.plugin, "skills/lisa-secrets-access/scripts/preflight-secrets.mjs")}' --intake-read --ref fixture/project#1 --read ${operation} --${operation === "thread-comments" ? "thread" : "number"} ${value}`;
}

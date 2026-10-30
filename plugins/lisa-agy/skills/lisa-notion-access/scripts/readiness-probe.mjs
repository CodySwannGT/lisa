/** Fixed existing Notion owner's read-only token path, pinned to its API version. */
import { execFileSync } from "node:child_process";
import { notionId } from "../../lisa-secrets-access/scripts/task-native-contract.mjs";
const denied = code => ({
  outcome: "DENIED",
  established: false,
  code,
  tool: "curl",
});
function read(token, path) {
  const input = `url = ${JSON.stringify(`https://api.notion.com/v1/${path}`)}\nheader = ${JSON.stringify(`Authorization: Bearer ${token}`)}\nheader = "Notion-Version: 2022-06-28"\nfail\nsilent\nmax-time = 5\nmax-filesize = 1048576\n`;
  return JSON.parse(
    execFileSync("curl", ["--config", "-"], {
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 6000,
      maxBuffer: 1048576,
    })
  );
}
/** Values enter only the fixed child stdin, never its argv, diagnostics or state. */
export function notionPrimary(cfg, requirement, candidate) {
  if (!candidate?.available) return null;
  const token = candidate.value,
    anchor = cfg.effective?.notion?.workspaceId;
  if (
    typeof token !== "string" ||
    [...token].some(c => c.charCodeAt(0) < 32) ||
    !anchor ||
    !notionId(requirement.resource)
  )
    return denied("config-invalid");
  let me, database;
  try {
    me = read(token, "users/me");
  } catch (error) {
    return {
      primary_unavailable: true,
      primary_available: false,
      primary_code:
        error.code === "ENOENT" ? "tool-missing" : "capability-unreachable",
    };
  }
  if (!me || typeof me !== "object") return denied("identity-mismatch");
  const identity = notionId(anchor)
    ? me.bot?.workspace_id
    : me.bot?.workspace_name;
  if (
    me.object !== "user" ||
    me.type !== "bot" ||
    typeof me.id !== "string" ||
    !me.id ||
    (notionId(anchor)
      ? notionId(identity) !== notionId(anchor)
      : identity !== anchor)
  )
    return denied("identity-mismatch");
  try {
    database = read(token, `databases/${requirement.resource}`);
  } catch (error) {
    return {
      primary_unavailable: true,
      primary_available: false,
      primary_code:
        error.code === "ENOENT" ? "tool-missing" : "capability-unreachable",
    };
  }
  if (
    !database ||
    database.object !== "database" ||
    notionId(database.id) !== notionId(requirement.resource)
  )
    return denied("identity-mismatch");
  return {
    outcome: "ESTABLISHED",
    established: true,
    code: "ok",
    source: "notion-api",
    credential_source: candidate.source,
    provider_health: candidate.provider_health,
  };
}

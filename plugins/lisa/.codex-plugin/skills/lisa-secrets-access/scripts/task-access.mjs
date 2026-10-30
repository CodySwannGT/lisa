/** Fixed access-owner probes. No executable, URL or success status comes from a header. */
import { execFileSync } from "node:child_process";
import { AccessFailure } from "./config-layers.mjs";
import { githubAccess } from "./task-github.mjs";
import { notionPrimary } from "../../lisa-notion-access/scripts/readiness-probe.mjs";
export { githubAccess };

export const ESTABLISHED = "ESTABLISHED";
export const DENIED = "DENIED";
export const NATIVE_OWNER_REQUIRED = "NATIVE_OWNER_REQUIRED";
const denied = code => ({ outcome: DENIED, established: false, code });
const established = source => ({
  outcome: ESTABLISHED,
  established: true,
  code: "ok",
  source,
});
const owners = {
  notion: "lisa-notion-access",
  linear: "lisa-linear-access",
  atlassian: "lisa-atlassian-access",
  sentry: "lisa-sentry-access",
  posthog: "lisa-posthog-access",
  jam: "lisa-jam-access",
  sonarcloud: "lisa-sonarcloud-access",
};
export const nativeOwner = layer =>
  Object.hasOwn(owners, layer) ? owners[layer] : null;

/** Cheapest authenticated token/resource read, where no GitGuardian access skill exists.
 * API authority: https://api.gitguardian.com/docs (GET /v1/api_tokens/self).
 * Token is supplied only on curl stdin, never argv, diagnostics or disk.
 */
function gitguardianAccess(cfg, requirement, candidates) {
  const anchor = cfg.effective?.gitguardian?.workspaceId;
  if (
    !anchor ||
    String(anchor) !== requirement.resource ||
    requirement.operation !== "token-read"
  )
    throw new AccessFailure("requirements-stale");
  const candidate = candidates.get("GITGUARDIAN_API_KEY");
  if (!candidate?.available)
    return denied(candidate?.code ?? "credential-missing");
  if (/[\r\n\x00-\x1f]/.test(candidate.value))
    return denied("credential-missing");
  let response;
  try {
    response = JSON.parse(
      execFileSync("curl", ["--config", "-"], {
        input: `url = "https://api.gitguardian.com/v1/api_tokens/self"\nheader = ${JSON.stringify(`Authorization: Token ${candidate.value}`)}\nfail\nsilent\nmax-time = 5\nmax-filesize = 1048576\n`,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 6000,
        maxBuffer: 1024 * 1024,
      })
    );
  } catch (error) {
    return {
      ...denied(
        error.code === "ENOENT" ? "tool-missing" : "capability-unreachable"
      ),
      tool: "curl",
      provider_health: candidate.provider_health,
    };
  }
  if (
    String(response.workspace_id) !== String(anchor) ||
    response.status !== "active" ||
    !Array.isArray(response.scopes)
  )
    return {
      ...denied("identity-mismatch"),
      tool: "curl",
      provider_health: candidate.provider_health,
    };
  return {
    ...established("gitguardian-api"),
    provider_health: candidate.provider_health,
    credential_source: candidate.source,
  };
}

/** Validate known configured anchors before handing an opaque route to its owner. */
export function capabilityAccess(cfg, requirement, candidates = new Map()) {
  if (
    requirement.access_layer === "github" &&
    requirement.operation === "repository-read"
  )
    return githubAccess(cfg, requirement, candidates.get("GH_TOKEN"));
  if (
    requirement.access_layer === "gitguardian" &&
    requirement.operation === "token-read"
  )
    return gitguardianAccess(cfg, requirement, candidates);
  const anchors = {
    github:
      cfg.effective?.github &&
      `${cfg.effective.github.org}/${cfg.effective.github.repo}`,
    gitguardian:
      cfg.effective?.gitguardian?.workspaceId &&
      String(cfg.effective.gitguardian.workspaceId),
    notion: cfg.effective?.notion?.prdDatabaseId,
    linear: cfg.effective?.linear?.teamKey,
    atlassian:
      requirement.operation === "issue-type-metadata"
        ? cfg.effective?.jira?.project
        : cfg.effective?.atlassian?.cloudId,
    sentry:
      cfg.effective?.sentry &&
      `${cfg.effective.sentry.org}/${cfg.effective.sentry.project}`,
  };
  if (
    requirement.access_layer === "atlassian" &&
    (!cfg.effective?.atlassian?.cloudId || !cfg.effective?.atlassian?.site)
  )
    throw new AccessFailure("config-invalid");
  if (
    Object.hasOwn(anchors, requirement.access_layer) &&
    (!anchors[requirement.access_layer] ||
      anchors[requirement.access_layer] !== requirement.resource)
  )
    throw new AccessFailure("requirements-stale");
  // Metadata can represent other vendors without inventing a connector for them.
  // GitGuardian has no documented native alternative here. Unsupported operations
  // must stop until an actual supported adapter exists; they are not malformed input.
  const owner = nativeOwner(requirement.access_layer);
  const primary =
    requirement.access_layer === "notion" &&
    requirement.operation === "database-read"
      ? notionPrimary(cfg, requirement, candidates.get("NOTION_API_TOKEN"))
      : null;
  if (primary && !primary.primary_unavailable) return primary;
  if (!owner)
    return {
      ...denied("adapter-unsupported"),
      provider_health: [...candidates.values()].map(c => c.provider_health),
    };
  // Only these existing documented native owners can receive an opaque handoff.
  return {
    outcome: NATIVE_OWNER_REQUIRED,
    established: false,
    code: "native-proof-needed",
    owner,
    source_available: [...candidates.values()].some(
      candidate => candidate.available
    ),
    primary_available:
      !primary?.primary_unavailable &&
      [...candidates.values()].some(candidate => candidate.available),
    provider_health: [...candidates.values()].map(c => c.provider_health),
  };
}

/** Notion's documented native-owner flow boundary, for an immediate operation.
 * Functions are trusted runtime adapters, never serialized header fields.
 * A native fetch of the configured database is the access skill's workspace anchor.
 * This exported flow can be qualified with synthetic adapters; that is not an agent execution.
 */
export async function notionOwnerContinuation(cfg, requirement, adapters) {
  if (
    requirement.access_layer !== "notion" ||
    requirement.operation !== "database-read" ||
    requirement.resource !== cfg.effective?.notion?.prdDatabaseId
  )
    return denied("requirements-stale");
  let response;
  let source = "native-owner-primary";
  let primary_health = "not-observed";
  if (adapters.credential?.available) {
    try {
      response = await adapters.primaryProbe();
      primary_health = "reachable";
    } catch {
      response = null;
      primary_health = "unreachable";
    }
    if (
      response &&
      ((response.me?.bot?.workspace_name ?? response.me?.bot?.workspace_id) !==
        cfg.effective.notion.workspaceId ||
        response.database?.id !== requirement.resource)
    )
      return denied("identity-mismatch");
  }
  if (!response) {
    source = "native-owner-connector";
    try {
      response = { database: await adapters.connectorProbe() };
    } catch {
      return denied("provider-unreachable");
    }
  }
  if (
    response.database?.object !== "database" ||
    response.database?.id !== requirement.resource
  )
    return denied("identity-mismatch");
  await adapters.continueAction();
  return {
    ...established(source),
    primary_health,
    provider_health: adapters.credential?.provider_health ?? "not-observed",
  };
}

/** Task decision owner: availability, scoped proof, and opaque native handoff stay distinct. */
import { AccessFailure } from "./config-layers.mjs";
import { readinessProvider } from "./providers.mjs";
import { readMaterialized } from "./resolve-secret.mjs";
import { readConfig } from "./surfaces.mjs";
import { readTaskRequirements } from "./task-requirements.mjs";
import { routingFloor, routingCapabilityMatches } from "./routing-floor.mjs";
import {
  capabilityAccess,
  githubAccess,
  ESTABLISHED,
  DENIED,
  NATIVE_OWNER_REQUIRED,
} from "./task-access.mjs";

const actions = {
  "credential-missing":
    "Grant the named credential through this project's supported source, then check access again.",
  "provider-unreachable":
    "Restore the named provider connection, then check access again. No credential absence was established.",
  "capability-unreachable":
    "Restore the integration API connection using the named tool, then repeat its scoped read. The credential source was reached; this is not a missing vault record.",
  "bootstrap-missing":
    "Restore the named provider sign-in through lisa-secrets-access, then check access again.",
  "tool-missing": "Install the named documented tool, then check access again.",
  "config-invalid":
    "Correct the project configuration, then refresh task requirements.",
  "config-unreadable":
    "Restore read access to the project configuration, then refresh task requirements.",
  "config-undiscovered":
    "Open the actual project folder or supply its documented project hint, then refresh task requirements.",
  "config-unknown":
    "Select a supported project configuration, then refresh task requirements.",
  "identity-mismatch":
    "Use the intended project identity and resource, then check access again. Do not use the mismatched account.",
  "adapter-unsupported":
    "No supported adapter or documented native alternative implements this operation. Establish its documented authenticated access path before affected work.",
  "requirements-stale":
    "Have the input resolver refresh the complete task requirements for this worktree, then check access again.",
  "native-proof-needed":
    "The ordinary action is withheld. Load the named access owner, use the supported primary first, then the fixed native identity and exact-resource probes. Retry the identical action only after every required scope is proved.",
  "native-response-unrepresented":
    "The ordinary action is withheld. This native response, call identity or trusted connection mapping cannot be verified. Use the documented access owner and its supported primary route; do not supply a passed field or reuse an earlier result.",
};
/** Public credential identifiers use the same bounded schema as requirements. */
const publicCredential = name =>
  typeof name === "string" && /^[A-Z_][A-Z0-9_]{0,127}$/.test(name);
const tools = {
  env: "environment",
  bitwarden: "bws",
  doppler: "doppler",
  "1password": "op",
  aws: "aws",
  vault: "vault",
};
const ownerNames = new Set([
  "lisa-notion-access",
  "lisa-linear-access",
  "lisa-atlassian-access",
  "lisa-sentry-access",
  "lisa-posthog-access",
  "lisa-jam-access",
  "lisa-sonarcloud-access",
]);
const safeDetails = ({ requirementIndex, name, cfg, owner, tool } = {}) => ({
  requirement_index:
    Number.isInteger(requirementIndex) &&
    requirementIndex >= 1 &&
    requirementIndex <= 100
      ? requirementIndex
      : null,
  requirement:
    Number.isInteger(requirementIndex) &&
    requirementIndex >= 1 &&
    requirementIndex <= 100
      ? `requirement-${requirementIndex}`
      : "configuration-access",
  credential: publicCredential(name) ? name : "task-credential",
  provider: Object.hasOwn(tools, cfg?.provider) ? cfg.provider : "unknown",
  tool: ["gh", "curl"].includes(tool)
    ? tool
    : Object.hasOwn(tools, cfg?.provider)
      ? tools[cfg.provider]
      : "documented-tool",
  ...(ownerNames.has(owner) ? { owner } : {}),
});
export const failure = (code, details = {}) => {
  const safe = safeDetails(details);
  code = Object.hasOwn(actions, code) ? code : "config-invalid";
  return {
    outcome: DENIED,
    allowed: false,
    code,
    ...safe,
    action: `${safe.requirement}; ${safe.credential}; ${safe.provider} (${safe.tool})${safe.owner ? `; ${safe.owner}` : ""}: ${actions[code]}`,
  };
};
const present = value => typeof value === "string" && value.trim().length > 0;

/** Internal memory-only candidate; values never leave this module's decision path. */
export function candidate(
  cfg,
  name,
  {
    env = process.env,
    materialized = readMaterialized,
    provider = readinessProvider,
  } = {}
) {
  if (present(env[name]))
    return {
      available: true,
      value: env[name],
      source: "environment",
      provider_health: "not-observed",
    };
  if (
    cfg.require !== null &&
    cfg.require !== undefined &&
    !cfg.require.includes(name)
  )
    throw new AccessFailure("config-invalid");
  if (cfg.capabilities?.materialized) {
    try {
      const value = materialized(cfg).get(name);
      if (present(value))
        return {
          available: true,
          value,
          source: "materialized",
          provider_health: "not-observed",
        };
    } catch {
      /* The configured provider remains authoritative. */
    }
  }
  const value = provider(cfg).get(name)?.value;
  return present(value)
    ? {
        available: true,
        value,
        source: "provider",
        provider_health: "reachable",
      }
    : {
        available: false,
        source: "provider",
        code: "credential-missing",
        provider_health: "reachable",
      };
}

/** Preserve get() precedence without returning a credential value. */
export function credentialAvailability(cfg, name, options = {}) {
  const { value, ...safe } = candidate(cfg, name, options);
  return safe;
}

/** Fresh task decision. Import-only adapters are not header-controlled code.
 * @param {{root?: string, ref?: string, tracker?: string, cfg?: object, requirements?: object, binding?: object|null, env?: object, provider?: Function, materialized?: Function, capability?: Function}} [options] Trusted runtime/test inputs.
 * @returns {{outcome: string, allowed: boolean|null, code: string, action?: string, checked_scope?: string, credentials?: object[], capabilities?: object[], requirement?: string, credential?: string, provider?: string, tool?: string, owner?: string}} Safe values-free result.
 */
export function taskReadiness(options = {}) {
  try {
    const {
      root = process.cwd(),
      ref,
      tracker,
      cfg = readConfig(root),
      requirements,
      binding,
      env = process.env,
      provider,
      materialized,
      capability = capabilityAccess,
    } = options;
    const header =
      requirements ??
      readTaskRequirements(cfg, {
        ref,
        tracker,
        ...(binding === undefined ? {} : { binding }),
      });
    if (!header)
      return {
        outcome: ESTABLISHED,
        allowed: true,
        code: "no-active-task",
        checked_scope: "orientation",
      };
    const credentials = [],
      capabilities = [],
      pending = [];
    const resolved = new Map();
    const sourceOptions = {
      env,
      ...(provider ? { provider } : {}),
      ...(materialized ? { materialized } : {}),
    };
    // A routing-floor credential is a proxy for its routed capability. When
    // every route implying it has a matching task capability, that capability
    // must establish access or hand off to its documented native owner below.
    // Explicit assertions remain independent even when they name the same key.
    const routingAssertions = (cfg.requiredFloor ?? []).filter(name => {
      const routes = Object.entries(cfg.routing ?? {}).filter(([role, route]) =>
        routingFloor({ [role]: route }).includes(name)
      );
      return (
        !routes.length ||
        routes.some(
          ([, route]) =>
            !header.required_access.some(
              r =>
                r.kind === "capability" &&
                routingCapabilityMatches(route, r) &&
                r.credential_names.includes(name)
            )
        )
      );
    });
    const mandatory = [
      ...routingAssertions,
      ...(cfg.require ?? []),
      ...header.required_access
        .filter(r => r.kind === "credential")
        .flatMap(r => r.credential_names),
    ];
    for (const name of new Set(mandatory)) {
      const requirement = header.required_access.find(r =>
        r.credential_names.includes(name)
      );
      const requirementIndex = requirement
        ? header.required_access.indexOf(requirement) + 1
        : undefined;
      if (name === "GH_TOKEN" && cfg.effective?.github) {
        const proof = githubAccess(cfg, {
          operation: "repository-read",
          resource: `${cfg.effective.github.org}/${cfg.effective.github.repo}`,
        });
        if (proof.code === "identity-mismatch")
          return failure(proof.code, { cfg, name, requirementIndex });
        if (proof.established) {
          credentials.push({ source: "native-github" });
          continue;
        }
      }
      let result;
      try {
        result = candidate(cfg, name, sourceOptions);
      } catch (error) {
        return failure(
          error instanceof AccessFailure ? error.code : "provider-unreachable",
          { cfg, name, requirementIndex }
        );
      }
      if (!result.available)
        return failure(result.code, { cfg, name, requirementIndex });
      resolved.set(name, result);
      const { value, ...safe } = result;
      credentials.push(safe);
    }
    for (const requirement of header.required_access.filter(
      r => r.kind === "capability"
    )) {
      const candidates = new Map();
      let result =
        requirement.access_layer === "github"
          ? capability(cfg, requirement, candidates)
          : null;
      if (!result || result.code === "capability-unreachable")
        for (const name of requirement.credential_names) {
          try {
            candidates.set(
              name,
              resolved.get(name) ?? candidate(cfg, name, sourceOptions)
            );
          } catch (error) {
            const code =
              error instanceof AccessFailure
                ? error.code
                : "provider-unreachable";
            candidates.set(name, {
              available: false,
              code,
              provider_health: code,
            });
          }
        }
      if (!result || result.code === "capability-unreachable") {
        const source = candidates.get("GH_TOKEN");
        result =
          requirement.access_layer === "github" && !source?.available
            ? {
                established: false,
                code: source?.code ?? "credential-missing",
                provider_health: source?.provider_health ?? "not-observed",
                tool: "gh",
              }
            : capability(cfg, requirement, candidates);
      }
      const detail = {
        cfg,
        requirementIndex: header.required_access.indexOf(requirement) + 1,
        name: requirement.credential_names[0],
        owner: result.owner,
        tool: result.tool,
      };
      if (result.outcome === NATIVE_OWNER_REQUIRED) {
        const handoff = {
          ...failure("native-proof-needed", detail),
          outcome: NATIVE_OWNER_REQUIRED,
          allowed: null,
          provider_health: result.provider_health,
          primary_available: result.primary_available === true,
          source_available: result.source_available === true,
          checked_scope: "native-flow-duty",
        };
        pending.push(handoff);
      } else if (!result.established)
        return {
          ...failure(result.code, detail),
          provider_health:
            result.provider_health ??
            [...candidates.values()].map(c => c.provider_health),
        };
      else
        capabilities.push({
          ...result,
          provider_health: result.provider_health ?? "not-observed",
        });
    }
    if (pending.length)
      return { ...pending[0], pending, credentials, capabilities };
    return {
      outcome: ESTABLISHED,
      allowed: true,
      code: "ok",
      checked_scope: "current-task",
      credentials,
      capabilities,
    };
  } catch (error) {
    return failure(
      error instanceof AccessFailure ? error.code : "config-invalid"
    );
  }
}

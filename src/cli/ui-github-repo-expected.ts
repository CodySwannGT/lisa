/**
 * Expected labels and secrets for the GitHub repository live-status panel.
 * @module cli/ui-github-repo-expected
 */
import type { JsonObject, JsonValue } from "../sync/json-path.js";

/** One config-expected lifecycle label. */
export interface ExpectedLabel {
  readonly name: string;
  readonly role: string;
}

/** One workflow-expected repository secret (presence only). */
export interface ExpectedSecret {
  readonly name: string;
  readonly purpose: string;
}

/**
 * Secrets Lisa creates or expects workflows to consume.
 * Presence is checked via `gh secret list`; values are never read.
 */
export const EXPECTED_GITHUB_SECRETS: readonly ExpectedSecret[] = [
  {
    name: "DEPLOY_KEY",
    purpose:
      "Write deploy key so CI can push version bumps through ruleset bypass",
  },
  {
    name: "CLAUDE_CODE_OAUTH_TOKEN",
    purpose:
      "Claude Code Action workflows (nightly, review response, auto-fix)",
  },
  {
    name: "AWS_ACCOUNT_ID_DEV",
    purpose: "Per-environment AWS account for dev deploys",
  },
  {
    name: "AWS_ACCOUNT_ID_STAGING",
    purpose: "Per-environment AWS account for staging deploys",
  },
  {
    name: "AWS_ACCOUNT_ID_PRODUCTION",
    purpose: "Per-environment AWS account for production deploys",
  },
  {
    name: "GITGUARDIAN_API_KEY",
    purpose: "Secret scanning check",
  },
  {
    name: "SONAR_TOKEN",
    purpose: "SonarCloud SAST",
  },
  {
    name: "SNYK_TOKEN",
    purpose: "Snyk dependency scan",
  },
  {
    name: "FOSSA_API_KEY",
    purpose: "License compliance",
  },
  {
    name: "SENTRY_AUTH_TOKEN",
    purpose: "Sentry releases and sourcemaps",
  },
  {
    name: "SENTRY_ORG",
    purpose: "Sentry organization slug",
  },
  {
    name: "SENTRY_PROJECT",
    purpose: "Sentry project slug",
  },
  {
    name: "EXPO_TOKEN",
    purpose: "EAS builds",
  },
  {
    name: "MAESTRO_API_KEY",
    purpose: "Maestro Cloud mobile E2E",
  },
  {
    name: "MAESTRO_SECRET_ENV",
    purpose:
      "Native Maestro e2e — newline-separated KEY=VALUE secrets forwarded to flows",
  },
];

/**
 * Walk a nested labels object into role-path entries.
 * @param value - Nested label map or leaf string
 * @param pathParts - Role segments accumulated so far
 * @returns Flattened labels under this node
 */
function walkLabels(
  value: JsonValue,
  pathParts: readonly string[]
): readonly ExpectedLabel[] {
  if (typeof value === "string" && value.trim().length > 0) {
    return [{ name: value, role: pathParts.join(" · ") }];
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    walkLabels(child as JsonValue, [...pathParts, key])
  );
}

/**
 * Flatten `github.labels` from merged config into expected label rows.
 * @param config - Merged Lisa project config
 * @returns Expected labels with human-readable role paths
 */
export function expectedLabelsFromConfig(
  config: JsonObject
): readonly ExpectedLabel[] {
  const github = config.github;
  if (github === null || typeof github !== "object" || Array.isArray(github)) {
    return [];
  }
  const labels = Reflect.get(github, "labels");
  if (labels === null || typeof labels !== "object" || Array.isArray(labels)) {
    return [];
  }
  return walkLabels(labels as JsonValue, []);
}

/**
 * Read configured github.org / github.repo when both are non-empty strings.
 * @param config - Merged Lisa project config
 * @returns Owner and repo, or undefined when either is missing
 */
export function configuredGithubRepo(
  config: JsonObject
): { readonly owner: string; readonly repo: string } | undefined {
  const github = config.github;
  if (github === null || typeof github !== "object" || Array.isArray(github)) {
    return undefined;
  }
  const owner = Reflect.get(github, "org");
  const repo = Reflect.get(github, "repo");
  if (
    typeof owner !== "string" ||
    owner.trim().length === 0 ||
    typeof repo !== "string" ||
    repo.trim().length === 0
  ) {
    return undefined;
  }
  return { owner: owner.trim(), repo: repo.trim() };
}
